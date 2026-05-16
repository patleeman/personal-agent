import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDurableSessionsDir } from '@personal-agent/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as conversationModelPreferences from './conversationModelPreferences.js';
import {
  abortSession,
  appendDetachedUserMessage,
  appendVisibleCustomMessage,
  cancelQueuedPrompt,
  compactSession,
  destroySession,
  ensureSessionFileExists,
  exportSessionHtml,
  getLiveSessionForkEntries,
  getLiveSessions,
  getSessionContextUsage,
  getSessionStats,
  isLive,
  isPlaceholderConversationTitle,
  listQueuedPromptPreviews,
  manageParallelPromptJob,
  markConversationAutoModeContinueRequested,
  patchSessionManagerPersistence,
  promptSession,
  queuePromptContext,
  readLiveSessionAutoModeState,
  refreshAllLiveSessionModelRegistries,
  registry,
  reloadAllLiveSessionAuth,
  reloadSessionResources,
  renameSession,
  repairLiveSessionTranscriptTail,
  requestConversationAutoModeContinuationTurn,
  requestConversationAutoModeTurn,
  requestConversationWorkingDirectoryChange,
  resolveLastCompletedConversationEntryId,
  resolvePersistentSessionDir,
  resolveStableForkEntryId,
  resolveStableSessionTitle,
  restoreQueuedMessage,
  resumeSession,
  setLiveSessionAutoModeState,
  type SseEvent,
  submitPromptSession,
  subscribe,
  takeOverSessionControl,
  toSse,
  updateLiveSessionModelPreferences,
} from './liveSessions.js';
import { buildFallbackTitleFromContent } from './liveSessionTitle.js';
import { clearSessionCaches } from './sessions.js';

const tempDirs: string[] = [];
type LiveRegistryEntry = Parameters<typeof registry.set>[1];
type AgentSessionEvent = Parameters<typeof toSse>[0];
type PersistedSessionManager = Parameters<typeof ensureSessionFileExists>[0];

function setLiveEntry(sessionId: string, entry: Omit<Partial<LiveRegistryEntry>, 'session'> & { session: unknown }) {
  const session = entry.session as Record<string, unknown>;
  if (!('agent' in session)) {
    session.agent = {};
  }
  if (!('modelRegistry' in session)) {
    session.modelRegistry = {};
  }

  registry.set(sessionId, {
    sessionId,
    cwd: entry.cwd ?? '',
    listeners: entry.listeners ?? new Set(),
    title: entry.title ?? '',
    autoTitleRequested: entry.autoTitleRequested ?? false,
    lastContextUsageJson: entry.lastContextUsageJson ?? null,
    lastQueueStateJson: entry.lastQueueStateJson ?? null,
    lastParallelStateJson: entry.lastParallelStateJson ?? null,
    queuedStaleTurnCustomTypes: entry.queuedStaleTurnCustomTypes ?? [],
    activeStaleTurnCustomType: entry.activeStaleTurnCustomType ?? null,
    pendingAutoCompactionReason: entry.pendingAutoCompactionReason ?? null,
    lastCompactionSummaryTitle: entry.lastCompactionSummaryTitle ?? null,
    parallelJobs: entry.parallelJobs ?? [],
    importingParallelJobs: entry.importingParallelJobs ?? false,
    ...(entry.lastDurableRunState ? { lastDurableRunState: entry.lastDurableRunState } : {}),
    ...(entry.contextUsageTimer ? { contextUsageTimer: entry.contextUsageTimer } : {}),
    session: session as LiveRegistryEntry['session'],
  });
}

function asAgentSessionEvent(event: unknown): AgentSessionEvent {
  return event as AgentSessionEvent;
}

function asPersistedSessionManager(sessionManager: unknown): PersistedSessionManager {
  return sessionManager as PersistedSessionManager;
}

afterEach(() => {
  registry.clear();
  clearSessionCaches();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveLastCompletedConversationEntryId', () => {
  it('returns the latest completed assistant entry when the transcript ends on an assistant turn', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-last-assistant.jsonl');
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: 'session', id: 'session-last-assistant', timestamp: '2026-03-13T18:00:00.000Z', cwd: '/tmp/workspace' }),
        JSON.stringify({
          type: 'message',
          id: 'user-1',
          parentId: null,
          timestamp: '2026-03-13T18:00:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'First prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-1',
          parentId: 'user-1',
          timestamp: '2026-03-13T18:00:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] },
        }),
        '',
      ].join('\n'),
    );

    expect(resolveLastCompletedConversationEntryId(sessionFile)).toBe('assistant-1');
  });

  it('falls back to the latest completed user turn when the active assistant turn only has tool results persisted so far', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-last-user.jsonl');
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: 'session', id: 'session-last-user', timestamp: '2026-03-13T18:00:00.000Z', cwd: '/tmp/workspace' }),
        JSON.stringify({
          type: 'message',
          id: 'user-1',
          parentId: null,
          timestamp: '2026-03-13T18:00:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Find the issue' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'tool-1',
          parentId: 'user-1',
          timestamp: '2026-03-13T18:00:02.000Z',
          message: { role: 'toolResult', content: [{ type: 'text', text: 'partial tool output' }] },
        }),
        '',
      ].join('\n'),
    );

    expect(resolveLastCompletedConversationEntryId(sessionFile)).toBe('user-1');
  });

  it('returns null when the durable transcript does not contain a completed user or assistant turn', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-no-completed-turn.jsonl');
    writeFileSync(
      sessionFile,
      [
        'not json at all',
        JSON.stringify({
          type: 'session',
          id: 'session-no-completed-turn',
          timestamp: '2026-03-13T18:00:00.000Z',
          cwd: '/tmp/workspace',
        }),
        JSON.stringify({
          type: 'message',
          id: 'tool-1',
          parentId: null,
          timestamp: '2026-03-13T18:00:01.000Z',
          message: { role: 'toolResult', content: [{ type: 'text', text: 'tool-only transcript' }] },
        }),
        '',
      ].join('\n'),
    );

    expect(resolveLastCompletedConversationEntryId(sessionFile)).toBeNull();
  });
});

describe('resolveStableForkEntryId', () => {
  it('forks from visible injected context while a user turn is in progress', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-stable-fork-visible-turn.jsonl');
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: 'session',
          id: 'session-stable-fork-visible-turn',
          timestamp: '2026-03-13T18:00:00.000Z',
          cwd: '/tmp/workspace',
        }),
        JSON.stringify({
          type: 'message',
          id: 'user-1',
          parentId: null,
          timestamp: '2026-03-13T18:00:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'First prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-1',
          parentId: 'user-1',
          timestamp: '2026-03-13T18:00:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }], stopReason: 'stop' },
        }),
        JSON.stringify({
          type: 'custom_message',
          id: 'ctx-1',
          parentId: 'assistant-1',
          timestamp: '2026-03-13T18:00:03.000Z',
          customType: 'referenced_context',
          content: [{ type: 'text', text: 'Internal context for the next turn.' }],
          display: false,
        }),
        JSON.stringify({
          type: 'message',
          id: 'user-2',
          parentId: 'ctx-1',
          timestamp: '2026-03-13T18:00:04.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Current prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-tool-2',
          parentId: 'user-2',
          timestamp: '2026-03-13T18:00:05.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Using a tool…' }], stopReason: 'toolUse' },
        }),
        JSON.stringify({
          type: 'message',
          id: 'tool-2',
          parentId: 'assistant-tool-2',
          timestamp: '2026-03-13T18:00:06.000Z',
          message: { role: 'toolResult', content: [{ type: 'text', text: 'partial tool output' }] },
        }),
        '',
      ].join('\n'),
    );

    expect(resolveStableForkEntryId(sessionFile, { activeTurnInProgress: true })).toBe('ctx-1');
  });

  it('treats legacy hidden custom entries as visible fork targets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-stable-fork-stale-turn.jsonl');
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: 'session',
          id: 'session-stable-fork-stale-turn',
          timestamp: '2026-03-13T18:00:00.000Z',
          cwd: '/tmp/workspace',
        }),
        JSON.stringify({
          type: 'message',
          id: 'user-1',
          parentId: null,
          timestamp: '2026-03-13T18:00:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Visible prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-1',
          parentId: 'user-1',
          timestamp: '2026-03-13T18:00:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Visible answer' }], stopReason: 'stop' },
        }),
        JSON.stringify({
          type: 'custom_message',
          id: 'stale-turn-1',
          parentId: 'assistant-1',
          timestamp: '2026-03-13T18:00:03.000Z',
          customType: 'conversation_automation_post_turn_review',
          content: [{ type: 'text', text: 'Legacy review prompt.' }],
          display: false,
        }),
        '',
      ].join('\n'),
    );

    expect(resolveStableForkEntryId(sessionFile, { activeTurnInProgress: true })).toBe('stale-turn-1');
  });
});

describe('repairLiveSessionTranscriptTail', () => {
  it('branches away from an assistant error tail with a visible recovery summary', () => {
    const branchWithSummary = vi.fn();
    const branch = vi.fn();
    const resetLeaf = vi.fn();
    const buildSessionContext = vi.fn(() => ({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Retry the request.' }] }],
      thinkingLevel: 'off',
      model: null,
    }));
    const send = vi.fn();
    const state = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'boom' }],
          stopReason: 'error',
          errorMessage: 'Codex error: upstream overloaded',
        },
      ],
      streamingMessage: null,
    };

    setLiveEntry('session-error-tail', {
      sessionId: 'session-error-tail',
      cwd: '/tmp/workspace',
      listeners: new Set([{ tailBlocks: undefined, send }]),
      title: 'Error tail',
      session: {
        state,
        isStreaming: false,
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              id: 'user-1',
              parentId: null,
              timestamp: '2026-04-20T10:00:00.000Z',
              message: { role: 'user', content: [{ type: 'text', text: 'Retry the request.' }] },
            },
            {
              type: 'message',
              id: 'assistant-error-1',
              parentId: 'user-1',
              timestamp: '2026-04-20T10:00:01.000Z',
              message: {
                role: 'assistant',
                content: [{ type: 'thinking', thinking: 'Trying again…' }],
                stopReason: 'error',
                errorMessage: 'Codex error: upstream overloaded',
              },
            },
          ],
          getEntry: (id: string) =>
            (
              ({
                'user-1': {
                  type: 'message',
                  id: 'user-1',
                  parentId: null,
                  timestamp: '2026-04-20T10:00:00.000Z',
                  message: { role: 'user', content: [{ type: 'text', text: 'Retry the request.' }] },
                },
              }) as Record<string, unknown>
            )[id],
          branch,
          branchWithSummary,
          resetLeaf,
          buildSessionContext,
        },
        getContextUsage: () => null,
      },
    });
    const recoveredEntry = registry.get('session-error-tail');
    if (recoveredEntry) {
      recoveredEntry.currentTurnError = 'Codex error: upstream overloaded';
    }

    const result = repairLiveSessionTranscriptTail('session-error-tail');

    expect(result).toMatchObject({
      recoverable: true,
      repaired: true,
      reason: 'assistant_error',
    });
    expect(branchWithSummary).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('Recovered from a failed tail'),
      expect.objectContaining({
        source: 'conversation-recovery',
        reason: 'assistant_error',
        errorMessage: 'Codex error: upstream overloaded',
      }),
    );
    expect(branch).not.toHaveBeenCalled();
    expect(resetLeaf).not.toHaveBeenCalled();
    expect(state.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Retry the request.' }] }]);
    expect(registry.get('session-error-tail')?.currentTurnError).toBeNull();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'snapshot' }));
  });

  it('reports recoverable dangling tool-call tails even when summaries are unavailable', () => {
    const state = {
      messages: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'README.md' } }] }],
      streamingMessage: null,
    };

    setLiveEntry('session-dangling-tail', {
      sessionId: 'session-dangling-tail',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Dangling tail',
      session: {
        state,
        isStreaming: false,
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              id: 'user-1',
              parentId: null,
              timestamp: '2026-04-20T10:01:00.000Z',
              message: { role: 'user', content: [{ type: 'text', text: 'Check the file.' }] },
            },
            {
              type: 'message',
              id: 'assistant-1',
              parentId: 'user-1',
              timestamp: '2026-04-20T10:01:01.000Z',
              message: {
                role: 'assistant',
                content: [{ type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'README.md' } }],
                stopReason: 'toolUse',
              },
            },
          ],
          getEntry: (id: string) =>
            (
              ({
                'user-1': {
                  type: 'message',
                  id: 'user-1',
                  parentId: null,
                  timestamp: '2026-04-20T10:01:00.000Z',
                  message: { role: 'user', content: [{ type: 'text', text: 'Check the file.' }] },
                },
              }) as Record<string, unknown>
            )[id],
        },
      },
    });

    const result = repairLiveSessionTranscriptTail('session-dangling-tail');

    expect(result).toEqual({
      recoverable: true,
      repaired: false,
      reason: 'dangling_tool_call',
      summary: 'Recovered from an unfinished tool-use tail so the conversation can continue from the last stable point.',
    });
  });
});

describe('parallel prompt job management', () => {
  it('imports a completed parallel job immediately even when an older running job is still queued', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-parallel-parent.jsonl');
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        type: 'session',
        id: 'session-parallel-parent',
        timestamp: '2026-04-17T00:00:00.000Z',
        cwd: '/tmp/workspace',
      })}\n`,
    );

    const runningJob = {
      id: 'parallel-running',
      prompt: 'Keep scanning',
      childConversationId: 'child-running',
      childSessionFile: join(dir, 'child-running.jsonl'),
      status: 'running' as const,
      createdAt: '2026-04-17T00:00:01.000Z',
      updatedAt: '2026-04-17T00:00:01.000Z',
      imageCount: 0,
      attachmentRefs: [],
      touchedFiles: [],
      parentTouchedFiles: [],
      overlapFiles: [],
      sideEffects: [],
      worktreeDirtyPathsAtStart: [],
    };
    const readyJob = {
      id: 'parallel-ready',
      prompt: 'Check the docs',
      childConversationId: 'child-ready',
      childSessionFile: join(dir, 'child-ready.jsonl'),
      status: 'ready' as const,
      createdAt: '2026-04-17T00:00:02.000Z',
      updatedAt: '2026-04-17T00:00:03.000Z',
      imageCount: 1,
      attachmentRefs: ['diagram (rev 2)'],
      touchedFiles: ['src/app.ts'],
      parentTouchedFiles: ['src/app.ts'],
      overlapFiles: ['src/app.ts'],
      sideEffects: ['Saved checkpoint abc1234 Keep the docs fix.'],
      worktreeDirtyPathsAtStart: [],
      resultText: 'The docs already cover this case.',
    };
    const jobsFile = `${sessionFile}.parallel.json`;
    writeFileSync(jobsFile, `${JSON.stringify([runningJob, readyJob], null, 2)}\n`);

    const sendCustomMessage = vi.fn(async () => {});
    const appendMessage = vi.fn();
    setLiveEntry('session-parallel-parent', {
      sessionId: 'session-parallel-parent',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Parallel parent',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      parallelJobs: [runningJob, readyJob],
      session: {
        sessionFile,
        isStreaming: false,
        sessionManager: { appendMessage },
        state: {
          messages: [],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        sendCustomMessage,
      },
    });

    await expect(
      manageParallelPromptJob('session-parallel-parent', {
        jobId: 'parallel-ready',
        action: 'importNow',
      }),
    ).resolves.toEqual({ ok: true, status: 'imported' });

    expect(sendCustomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: 'parallel_result',
        details: expect.objectContaining({ childConversationId: 'child-ready', status: 'complete' }),
      }),
    );
    const importedMessages = registry.get('session-parallel-parent')?.session.state.messages ?? [];
    expect(importedMessages).toEqual([expect.objectContaining({ role: 'user' })]);
    expect(importedMessages[0].content[0].text).toContain('diagram (rev 2)');
    expect(importedMessages[0].content[0].text).toContain('src/app.ts');
    expect(importedMessages[0].content[0].text).toContain('Saved checkpoint abc1234 Keep the docs fix.');
    expect(appendMessage).toHaveBeenCalledWith(importedMessages[0]);
    expect(registry.get('session-parallel-parent')?.parallelJobs).toEqual([
      expect.objectContaining({ id: 'parallel-running', status: 'running' }),
    ]);
    expect(JSON.parse(readFileSync(jobsFile, 'utf-8'))).toEqual([expect.objectContaining({ id: 'parallel-running', status: 'running' })]);
    expect(isLive('child-ready')).toBe(false);
  });

  it('cancels a running parallel job and removes it from the durable queue', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-parallel-cancel.jsonl');
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        type: 'session',
        id: 'session-parallel-cancel',
        timestamp: '2026-04-17T00:00:00.000Z',
        cwd: '/tmp/workspace',
      })}\n`,
    );

    const runningJob = {
      id: 'parallel-running',
      prompt: 'Keep scanning',
      childConversationId: 'child-running',
      childSessionFile: join(dir, 'child-running.jsonl'),
      status: 'running' as const,
      createdAt: '2026-04-17T00:00:01.000Z',
      updatedAt: '2026-04-17T00:00:01.000Z',
      imageCount: 0,
      attachmentRefs: [],
      touchedFiles: [],
      parentTouchedFiles: [],
      overlapFiles: [],
      sideEffects: [],
      worktreeDirtyPathsAtStart: [],
    };
    const jobsFile = `${sessionFile}.parallel.json`;
    writeFileSync(jobsFile, `${JSON.stringify([runningJob], null, 2)}\n`);

    const abort = vi.fn(async () => {});
    setLiveEntry('child-running', {
      sessionId: 'child-running',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Child running',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile: runningJob.childSessionFile,
        isStreaming: true,
        abort,
        dispose: vi.fn(),
      },
    });

    setLiveEntry('session-parallel-cancel', {
      sessionId: 'session-parallel-cancel',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Parallel parent',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      parallelJobs: [runningJob],
      session: {
        sessionFile,
        isStreaming: false,
        state: {
          messages: [],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
      },
    });

    await expect(
      manageParallelPromptJob('session-parallel-cancel', {
        jobId: 'parallel-running',
        action: 'cancel',
      }),
    ).resolves.toEqual({ ok: true, status: 'cancelled' });

    expect(abort).toHaveBeenCalledTimes(1);
    expect(registry.get('session-parallel-cancel')?.parallelJobs).toEqual([]);
    expect(isLive('child-running')).toBe(false);
    expect(existsSync(jobsFile)).toBe(false);
  });

  it('ignores stale auto-mode markers when reporting streaming sessions', () => {
    setLiveEntry('session-hidden-auto-running', {
      sessionId: 'session-hidden-auto-running',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Stale auto marker',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      queuedStaleTurnCustomTypes: [],
      activeStaleTurnCustomType: 'conversation_automation_post_turn_review',
      session: {
        sessionFile: '/tmp/session-hidden-auto-running.jsonl',
        isStreaming: true,
      },
    });

    expect(getLiveSessions()).toContainEqual(
      expect.objectContaining({
        id: 'session-hidden-auto-running',
        isStreaming: true,
        hasStaleTurnState: false,
      }),
    );
  });
});

describe('requestConversationWorkingDirectoryChange', () => {
  it('returns unchanged when the requested cwd matches the live session', async () => {
    setLiveEntry('session-same-cwd', {
      sessionId: 'session-same-cwd',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Same cwd',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        isStreaming: true,
        sessionFile: '/tmp/session-same-cwd.jsonl',
      },
    });

    await expect(
      requestConversationWorkingDirectoryChange({
        conversationId: 'session-same-cwd',
        cwd: '/tmp/workspace',
      }),
    ).resolves.toEqual({
      conversationId: 'session-same-cwd',
      cwd: '/tmp/workspace',
      queued: false,
      unchanged: true,
    });
  });

  it('queues a cwd change for a live session', async () => {
    setLiveEntry('session-next-cwd', {
      sessionId: 'session-next-cwd',
      cwd: '/tmp/workspace-a',
      listeners: new Set(),
      title: 'Next cwd',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        isStreaming: true,
        sessionFile: '/tmp/session-next-cwd.jsonl',
      },
    });

    await expect(
      requestConversationWorkingDirectoryChange({
        conversationId: 'session-next-cwd',
        cwd: '/tmp/workspace-b',
        continuePrompt: 'Continue in the other repo.',
      }),
    ).resolves.toEqual({
      conversationId: 'session-next-cwd',
      cwd: '/tmp/workspace-b',
      queued: true,
    });
  });
});

describe('live session registry helpers', () => {
  it('reports live registry membership, titles, stale turn state, and fork entries', () => {
    const forkEntries = [{ id: 'user-1' }];

    setLiveEntry('session-helper', {
      sessionId: 'session-helper',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'New Conversation',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      activeStaleTurnCustomType: 'conversation_automation_post_turn_review',
      session: {
        sessionFile: '/tmp/session-helper.jsonl',
        sessionName: 'Persisted title',
        isStreaming: false,
        getUserMessagesForForking: () => forkEntries,
      },
    });

    expect(isLive('session-helper')).toBe(true);
    expect(isLive('missing-session')).toBe(false);
    expect(getLiveSessions()).toContainEqual({
      id: 'session-helper',
      cwd: '/tmp/workspace',
      sessionFile: '/tmp/session-helper.jsonl',
      title: 'Persisted title',
      running: false,
      isStreaming: false,
      hasStaleTurnState: false,
    });
    expect(getLiveSessionForkEntries('session-helper')).toBe(forkEntries);
    expect(getLiveSessionForkEntries('missing-session')).toBeNull();
  });

  it('short-circuits resumeSession when the session file is already live', async () => {
    setLiveEntry('session-resume-short-circuit', {
      sessionId: 'session-resume-short-circuit',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Already live',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile: '/tmp/already-live.jsonl',
        isStreaming: false,
      },
    });

    await expect(resumeSession('/tmp/already-live.jsonl')).resolves.toEqual({
      id: 'session-resume-short-circuit',
    });
  });
});

describe('working directory change validation', () => {
  it('rejects invalid working directory change requests before queueing them', async () => {
    await expect(
      requestConversationWorkingDirectoryChange({
        conversationId: '   ',
        cwd: '/tmp/workspace',
      }),
    ).rejects.toThrow('conversationId is required.');

    await expect(
      requestConversationWorkingDirectoryChange({
        conversationId: 'session-missing-cwd',
        cwd: '   ',
      }),
    ).rejects.toThrow('cwd is required.');

    await expect(
      requestConversationWorkingDirectoryChange({
        conversationId: 'missing-session',
        cwd: '/tmp/workspace',
      }),
    ).rejects.toThrow('Session missing-session is not live.');

    setLiveEntry('session-no-session-file', {
      sessionId: 'session-no-session-file',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'No file',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile: '   ',
        isStreaming: false,
      },
    });

    await expect(
      requestConversationWorkingDirectoryChange({
        conversationId: 'session-no-session-file',
        cwd: '/tmp/next-workspace',
      }),
    ).rejects.toThrow('Conversation working directory changes require a persisted session file.');
  });
});

describe('session stats and context usage', () => {
  it('returns null for missing or failing session stats lookups', () => {
    expect(getSessionStats('missing-session')).toBeNull();

    setLiveEntry('session-stats-error', {
      sessionId: 'session-stats-error',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Stats error',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        getSessionStats: () => {
          throw new Error('stats unavailable');
        },
      },
    });

    expect(getSessionStats('session-stats-error')).toBeNull();
  });

  it('reads session stats and enriches live context usage with model metadata', () => {
    setLiveEntry('session-usage', {
      sessionId: 'session-usage',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Usage',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        getSessionStats: () => ({
          tokens: { input: 4, output: 6, total: 10 },
          cost: 0.25,
        }),
        getContextUsage: () => ({
          tokens: 12,
          contextWindow: 96,
          percent: 12.5,
        }),
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Count the context tokens.' }],
          },
        ],
        model: { id: 'gpt-5' },
      },
    });

    expect(getSessionStats('session-usage')).toEqual({
      tokens: { input: 4, output: 6, total: 10 },
      cost: 0.25,
    });
    expect(getSessionContextUsage('missing-session')).toBeNull();
    expect(getSessionContextUsage('session-usage')).toEqual(
      expect.objectContaining({
        tokens: 12,
        contextWindow: 96,
        percent: 12.5,
        modelId: 'gpt-5',
        segments: expect.arrayContaining([expect.objectContaining({ key: 'user', label: 'user' })]),
      }),
    );
  });
});

describe('reloadAllLiveSessionAuth', () => {
  it('reloads auth storage for every live session that exposes a model registry', () => {
    const firstReload = vi.fn();
    const secondReload = vi.fn();

    setLiveEntry('session-1', {
      sessionId: 'session-1',
      cwd: '/tmp/workspace-a',
      listeners: new Set(),
      title: 'First',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        modelRegistry: {
          authStorage: {
            reload: firstReload,
          },
        },
      },
    });

    setLiveEntry('session-2', {
      sessionId: 'session-2',
      cwd: '/tmp/workspace-b',
      listeners: new Set(),
      title: 'Second',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        modelRegistry: {
          authStorage: {
            reload: secondReload,
          },
        },
      },
    });

    setLiveEntry('session-3', {
      sessionId: 'session-3',
      cwd: '/tmp/workspace-c',
      listeners: new Set(),
      title: 'Third',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {},
    });

    expect(reloadAllLiveSessionAuth()).toBe(2);
    expect(firstReload).toHaveBeenCalledTimes(1);
    expect(secondReload).toHaveBeenCalledTimes(1);
  });
});

describe('refreshAllLiveSessionModelRegistries', () => {
  it('refreshes model registries for every live session that exposes one', () => {
    const firstRefresh = vi.fn();
    const secondRefresh = vi.fn();

    setLiveEntry('session-model-1', {
      sessionId: 'session-model-1',
      cwd: '/tmp/workspace-a',
      listeners: new Set(),
      title: 'First',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        modelRegistry: {
          refresh: firstRefresh,
        },
      },
    });

    setLiveEntry('session-model-2', {
      sessionId: 'session-model-2',
      cwd: '/tmp/workspace-b',
      listeners: new Set(),
      title: 'Second',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        modelRegistry: {
          refresh: secondRefresh,
        },
      },
    });

    setLiveEntry('session-model-3', {
      sessionId: 'session-model-3',
      cwd: '/tmp/workspace-c',
      listeners: new Set(),
      title: 'Third',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {},
    });

    expect(refreshAllLiveSessionModelRegistries()).toBe(2);
    expect(firstRefresh).toHaveBeenCalledTimes(1);
    expect(secondRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('conversation titles', () => {
  it('treats the default new conversation label as a placeholder', () => {
    expect(isPlaceholderConversationTitle('New Conversation')).toBe(true);
    expect(isPlaceholderConversationTitle(' (new conversation) ')).toBe(true);
    expect(isPlaceholderConversationTitle('Actual title')).toBe(false);
  });

  it('prefers the session manager name for stable live titles', () => {
    expect(
      resolveStableSessionTitle({
        sessionName: undefined,
        sessionManager: {
          getSessionName: () => 'Tool-set title',
        },
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Fallback first prompt' }],
            },
          ],
        },
      } as unknown as LiveRegistryEntry['session']),
    ).toBe('Tool-set title');
  });

  it('prefers session manager names set by agent tools', () => {
    expect(
      resolveStableSessionTitle({
        sessionManager: {
          getSessionName: () => 'Tool-set title',
        },
        sessionName: undefined,
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Fallback prompt' }],
            },
          ],
        },
      } as unknown as LiveRegistryEntry['session']),
    ).toBe('Tool-set title');
  });

  it('ignores placeholder persisted titles until a real title exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-title.jsonl');

    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        type: 'session',
        id: 'session-title',
        timestamp: '2026-03-18T00:00:00.000Z',
        cwd: '/tmp/workspace',
      })}\n`,
    );

    expect(
      resolveStableSessionTitle({
        sessionFile,
        state: {
          messages: [],
        },
      } as unknown as LiveRegistryEntry['session']),
    ).toBe('');

    expect(
      resolveStableSessionTitle({
        sessionFile,
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Use the first prompt while the agent is running.' }],
            },
          ],
        },
      } as unknown as LiveRegistryEntry['session']),
    ).toBe('Use the first prompt while the agent is running.');
  });

  it('does not derive fallback live titles from malformed image blocks', () => {
    expect(
      buildFallbackTitleFromContent([
        { type: 'image', data: '', mimeType: '' },
        { type: 'image', data: '   ', mimeType: 'image/png' },
        { type: 'image', data: 'not-valid-base64!', mimeType: 'image/png' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'text/plain' },
      ]),
    ).toBe('');
  });
});

describe('live session subscriptions', () => {
  it('replays a snapshot of the current live conversation before future events', () => {
    setLiveEntry('session-1', {
      sessionId: 'session-1',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'How do I fix this?',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      session: {
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'How do I fix this?' }],
              timestamp: 1,
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Start by checking the live session snapshot.' }],
              timestamp: 2,
            },
          ],
          streamingMessage: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Rebuilding the visible transcript…' }],
            timestamp: 3,
          },
        },
        getContextUsage: () => null,
        isStreaming: true,
      },
    });

    const events: SseEvent[] = [];
    const unsubscribe = subscribe('session-1', (event) => {
      events.push(event);
    });

    expect(unsubscribe).toBeTypeOf('function');
    expect(events[0]).toEqual({
      type: 'snapshot',
      blockOffset: 0,
      totalBlocks: 3,
      isStreaming: true,
      goalState: null,
      blocks: [
        {
          type: 'user',
          id: 'live-0',
          ts: new Date(1).toISOString(),
          text: 'How do I fix this?',
        },
        {
          type: 'text',
          id: 'live-1-x1',
          ts: new Date(2).toISOString(),
          text: 'Start by checking the live session snapshot.',
        },
        {
          type: 'thinking',
          id: 'live-2-t2',
          ts: new Date(3).toISOString(),
          text: 'Rebuilding the visible transcript…',
        },
      ],
    });
    expect(events[1]).toEqual({ type: 'title_update', title: 'How do I fix this?' });
    expect(events[2]).toEqual({ type: 'context_usage', usage: null });
    expect(events[3]).toEqual({ type: 'queue_state', steering: [], followUp: [] });
    expect(events[4]).toEqual({ type: 'parallel_state', jobs: [] });
    expect(events[5]).toEqual({ type: 'agent_start' });
  });

  it('does not replay agent_start while a generic stale turn is active', () => {
    const events: SseEvent[] = [];

    setLiveEntry('session-hidden-streaming', {
      sessionId: 'session-hidden-streaming',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Stale marker streaming',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      activeStaleTurnCustomType: 'conversation_automation_review',
      session: {
        state: {
          messages: [],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: true,
      },
    });

    subscribe('session-hidden-streaming', (event) => {
      events.push(event);
    });

    expect(events).not.toContainEqual({ type: 'agent_start' });
  });

  it('replays agent_start while an auto-mode stale turn is active so internal work stays visible', () => {
    const events: SseEvent[] = [];

    setLiveEntry('session-auto-hidden-streaming', {
      sessionId: 'session-auto-hidden-streaming',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Auto streaming',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      activeStaleTurnCustomType: 'conversation_automation_post_turn_review',
      session: {
        state: {
          messages: [],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: true,
      },
    });

    subscribe('session-auto-hidden-streaming', (event) => {
      events.push(event);
    });

    expect(events).toContainEqual({ type: 'agent_start' });
  });

  it('tracks mirrored surfaces and explicit takeover', () => {
    setLiveEntry('session-control', {
      sessionId: 'session-control',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Controlled conversation',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: {
          messages: [],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: false,
      },
    });

    const desktopEvents: SseEvent[] = [];
    const mobileEvents: SseEvent[] = [];

    subscribe(
      'session-control',
      (event) => {
        desktopEvents.push(event);
      },
      {
        surface: {
          surfaceId: 'desktop-1',
          surfaceType: 'desktop_web',
        },
      },
    );

    expect(desktopEvents.at(-1)).toEqual({
      type: 'presence_state',
      state: {
        surfaces: [
          {
            surfaceId: 'desktop-1',
            surfaceType: 'desktop_web',
            connectedAt: expect.any(String),
          },
        ],
        controllerSurfaceId: 'desktop-1',
        controllerSurfaceType: 'desktop_web',
        controllerAcquiredAt: expect.any(String),
      },
    });

    subscribe(
      'session-control',
      (event) => {
        mobileEvents.push(event);
      },
      {
        surface: {
          surfaceId: 'mobile-1',
          surfaceType: 'mobile_web',
        },
      },
    );

    expect(mobileEvents.at(-1)).toEqual({
      type: 'presence_state',
      state: {
        surfaces: [
          {
            surfaceId: 'desktop-1',
            surfaceType: 'desktop_web',
            connectedAt: expect.any(String),
          },
          {
            surfaceId: 'mobile-1',
            surfaceType: 'mobile_web',
            connectedAt: expect.any(String),
          },
        ],
        controllerSurfaceId: 'desktop-1',
        controllerSurfaceType: 'desktop_web',
        controllerAcquiredAt: expect.any(String),
      },
    });

    const takeoverState = takeOverSessionControl('session-control', 'mobile-1');
    expect(takeoverState.controllerSurfaceId).toBe('mobile-1');
    expect(takeoverState.controllerSurfaceType).toBe('mobile_web');
    expect(desktopEvents.at(-1)).toEqual({
      type: 'presence_state',
      state: {
        surfaces: [
          {
            surfaceId: 'desktop-1',
            surfaceType: 'desktop_web',
            connectedAt: expect.any(String),
          },
          {
            surfaceId: 'mobile-1',
            surfaceType: 'mobile_web',
            connectedAt: expect.any(String),
          },
        ],
        controllerSurfaceId: 'mobile-1',
        controllerSurfaceType: 'mobile_web',
        controllerAcquiredAt: expect.any(String),
      },
    });
  });

  it('hands control to the newest surface of the same type automatically', () => {
    setLiveEntry('session-same-surface-control', {
      sessionId: 'session-same-surface-control',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Controlled conversation',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: {
          messages: [],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: false,
      },
    });

    subscribe('session-same-surface-control', () => {}, {
      surface: {
        surfaceId: 'desktop-1',
        surfaceType: 'desktop_web',
      },
    });

    const secondDesktopEvents: SseEvent[] = [];
    subscribe(
      'session-same-surface-control',
      (event) => {
        secondDesktopEvents.push(event);
      },
      {
        surface: {
          surfaceId: 'desktop-2',
          surfaceType: 'desktop_web',
        },
      },
    );

    expect(secondDesktopEvents.at(-1)).toEqual({
      type: 'presence_state',
      state: {
        surfaces: [
          {
            surfaceId: 'desktop-1',
            surfaceType: 'desktop_web',
            connectedAt: expect.any(String),
          },
          {
            surfaceId: 'desktop-2',
            surfaceType: 'desktop_web',
            connectedAt: expect.any(String),
          },
        ],
        controllerSurfaceId: 'desktop-2',
        controllerSurfaceType: 'desktop_web',
        controllerAcquiredAt: expect.any(String),
      },
    });
  });

  it('allows prompt submissions to keep running from mirrored surfaces', async () => {
    const prompt = vi.fn(async () => {});

    setLiveEntry('session-prompt-control', {
      sessionId: 'session-prompt-control',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Controlled prompt',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: {
          messages: [],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        prompt,
        isStreaming: false,
      },
    });

    subscribe('session-prompt-control', () => {}, {
      surface: {
        surfaceId: 'desktop-1',
        surfaceType: 'desktop_web',
      },
    });
    subscribe('session-prompt-control', () => {}, {
      surface: {
        surfaceId: 'mobile-1',
        surfaceType: 'mobile_web',
      },
    });

    await promptSession('session-prompt-control', 'from mirrored surface', undefined, undefined, 'mobile-1');
    await promptSession('session-prompt-control', 'from controlling surface', undefined, undefined, 'desktop-1');

    expect(prompt).toHaveBeenNthCalledWith(1, 'from mirrored surface');
    expect(prompt).toHaveBeenNthCalledWith(2, 'from controlling surface');
  });

  it('merges persisted history into truncated live snapshots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-merged.jsonl');
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: 'session', id: 'session-merged', timestamp: '2026-03-13T18:00:00.000Z', cwd: '/tmp/workspace' }),
        JSON.stringify({
          type: 'message',
          id: 'user-1',
          parentId: null,
          timestamp: '2026-03-13T18:00:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'First prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-1',
          parentId: 'user-1',
          timestamp: '2026-03-13T18:00:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'user-2',
          parentId: 'assistant-1',
          timestamp: '2026-03-13T18:00:03.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Second prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-2',
          parentId: 'user-2',
          timestamp: '2026-03-13T18:00:04.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Second answer' }] },
        }),
        '',
      ].join('\n'),
    );

    setLiveEntry('session-merged', {
      sessionId: 'session-merged',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Merged transcript',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile,
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Second prompt' }],
              timestamp: '2026-03-13T18:00:03.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Second answer' }],
              timestamp: '2026-03-13T18:00:04.000Z',
            },
          ],
          streamingMessage: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Planning the next step' }],
            timestamp: '2026-03-13T18:00:05.000Z',
          },
        },
        getContextUsage: () => null,
        isStreaming: true,
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-merged', (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({
      type: 'snapshot',
      blockOffset: 0,
      totalBlocks: 5,
      isStreaming: true,
      goalState: null,
      blocks: [
        {
          type: 'user',
          id: expect.any(String),
          ts: '2026-03-13T18:00:01.000Z',
          text: 'First prompt',
        },
        {
          type: 'text',
          id: expect.any(String),
          ts: '2026-03-13T18:00:02.000Z',
          text: 'First answer',
        },
        {
          type: 'user',
          id: expect.any(String),
          ts: '2026-03-13T18:00:03.000Z',
          text: 'Second prompt',
        },
        {
          type: 'text',
          id: expect.any(String),
          ts: '2026-03-13T18:00:04.000Z',
          text: 'Second answer',
        },
        {
          type: 'thinking',
          id: 'live-2-t2',
          ts: '2026-03-13T18:00:05.000Z',
          text: 'Planning the next step',
        },
      ],
    });
  });

  it('deduplicates reordered live compaction windows against persisted history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-reordered.jsonl');
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: 'session', id: 'session-reordered', timestamp: '2026-03-13T18:00:00.000Z', cwd: '/tmp/workspace' }),
        JSON.stringify({
          type: 'message',
          id: 'user-1',
          parentId: null,
          timestamp: '2026-03-13T18:00:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Initial prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-1',
          parentId: 'user-1',
          timestamp: '2026-03-13T18:00:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Initial answer' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-2',
          parentId: 'assistant-1',
          timestamp: '2026-03-13T18:00:03.000Z',
          message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Pre-compaction A' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-3',
          parentId: 'assistant-2',
          timestamp: '2026-03-13T18:00:04.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'tool-a', name: 'bash', arguments: { command: 'echo A' } }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'tool-result-1',
          parentId: 'assistant-3',
          timestamp: '2026-03-13T18:00:04.500Z',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-a',
            toolName: 'bash',
            content: [{ type: 'text', text: 'A output' }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-4',
          parentId: 'tool-result-1',
          timestamp: '2026-03-13T18:00:05.000Z',
          message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Pre-compaction B' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-5',
          parentId: 'assistant-4',
          timestamp: '2026-03-13T18:00:06.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'tool-b', name: 'read', arguments: { path: 'README.md' } }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'tool-result-2',
          parentId: 'assistant-5',
          timestamp: '2026-03-13T18:00:06.500Z',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-b',
            toolName: 'read',
            content: [{ type: 'text', text: 'B output' }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'summary-1',
          parentId: 'tool-result-2',
          timestamp: '2026-03-13T18:00:07.000Z',
          message: {
            role: 'compactionSummary',
            summary: '## Goal\nCarry the compacted context forward.',
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-6',
          parentId: 'summary-1',
          timestamp: '2026-03-13T18:00:08.000Z',
          message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Post-compaction C' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-7',
          parentId: 'assistant-6',
          timestamp: '2026-03-13T18:00:09.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'tool-c', name: 'edit', arguments: { path: 'notes.md' } }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'tool-result-3',
          parentId: 'assistant-7',
          timestamp: '2026-03-13T18:00:09.500Z',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-c',
            toolName: 'edit',
            content: [{ type: 'text', text: 'C output' }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-8',
          parentId: 'tool-result-3',
          timestamp: '2026-03-13T18:00:10.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Durable tail' }] },
        }),
        '',
      ].join('\n'),
    );

    setLiveEntry('session-reordered', {
      sessionId: 'session-reordered',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Reordered compaction merge',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile,
        state: {
          messages: [
            {
              role: 'compactionSummary',
              summary: '## Goal\nCarry the compacted context forward.',
              timestamp: '2026-03-13T18:00:07.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'thinking', thinking: 'Pre-compaction A' }],
              timestamp: '2026-03-13T18:00:03.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'tool-a', name: 'bash', arguments: { command: 'echo A' } }],
              timestamp: '2026-03-13T18:00:03.100Z',
            },
            {
              role: 'toolResult',
              toolCallId: 'tool-a',
              toolName: 'bash',
              content: [{ type: 'text', text: 'A output' }],
              timestamp: '2026-03-13T18:00:04.100Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'thinking', thinking: 'Pre-compaction B' }],
              timestamp: '2026-03-13T18:00:05.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'tool-b', name: 'read', arguments: { path: 'README.md' } }],
              timestamp: '2026-03-13T18:00:05.100Z',
            },
            {
              role: 'toolResult',
              toolCallId: 'tool-b',
              toolName: 'read',
              content: [{ type: 'text', text: 'B output' }],
              timestamp: '2026-03-13T18:00:06.100Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'thinking', thinking: 'Post-compaction C' }],
              timestamp: '2026-03-13T18:00:08.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'tool-c', name: 'edit', arguments: { path: 'notes.md' } }],
              timestamp: '2026-03-13T18:00:08.100Z',
            },
            {
              role: 'toolResult',
              toolCallId: 'tool-c',
              toolName: 'edit',
              content: [{ type: 'text', text: 'C output' }],
              timestamp: '2026-03-13T18:00:09.100Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'thinking', thinking: 'Live-only planning' }],
              timestamp: '2026-03-13T18:00:11.000Z',
            },
          ],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: true,
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-reordered', (event) => {
      events.push(event);
    });

    expect(events[0]?.type).toBe('snapshot');
    if (events[0]?.type !== 'snapshot') {
      return;
    }

    const blocks = events[0].blocks;
    const toolABlocks = blocks.filter(
      (block): block is Extract<(typeof blocks)[number], { type: 'tool_use' }> =>
        block.type === 'tool_use' && block.toolCallId === 'tool-a',
    );
    expect(toolABlocks).toHaveLength(1);
    expect(toolABlocks[0]?.ts).toBe('2026-03-13T18:00:03.100Z');

    expect(blocks.filter((block) => block.type === 'summary')).toHaveLength(1);
    expect(
      blocks.filter(
        (block): block is Extract<(typeof blocks)[number], { type: 'thinking' }> =>
          block.type === 'thinking' && block.text === 'Live-only planning',
      ),
    ).toHaveLength(1);
    expect(blocks).toHaveLength(11);
  });

  it('ignores replayed live context before the matched suffix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-replayed-context.jsonl');
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: 'session', id: 'session-replayed-context', timestamp: '2026-03-13T18:00:00.000Z', cwd: '/tmp/workspace' }),
        JSON.stringify({
          type: 'message',
          id: 'user-1',
          parentId: null,
          timestamp: '2026-03-13T18:00:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'First prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-1',
          parentId: 'user-1',
          timestamp: '2026-03-13T18:00:02.000Z',
          message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Inspect the first issue' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-2',
          parentId: 'assistant-1',
          timestamp: '2026-03-13T18:00:03.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'tool-a', name: 'bash', arguments: { command: 'echo first' } }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'tool-result-1',
          parentId: 'assistant-2',
          timestamp: '2026-03-13T18:00:03.500Z',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-a',
            toolName: 'bash',
            content: [{ type: 'text', text: 'first output' }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-3',
          parentId: 'tool-result-1',
          timestamp: '2026-03-13T18:00:04.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'First done' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'user-2',
          parentId: 'assistant-3',
          timestamp: '2026-03-13T18:00:05.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Second prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-4',
          parentId: 'user-2',
          timestamp: '2026-03-13T18:00:06.000Z',
          message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Inspect the second issue' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-5',
          parentId: 'assistant-4',
          timestamp: '2026-03-13T18:00:07.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'tool-b', name: 'read', arguments: { path: 'README.md' } }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'tool-result-2',
          parentId: 'assistant-5',
          timestamp: '2026-03-13T18:00:07.500Z',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-b',
            toolName: 'read',
            content: [{ type: 'text', text: 'second output' }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-6',
          parentId: 'tool-result-2',
          timestamp: '2026-03-13T18:00:08.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Second done' }] },
        }),
        '',
      ].join('\n'),
    );

    setLiveEntry('session-replayed-context', {
      sessionId: 'session-replayed-context',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Replay merge guard',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile,
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'First prompt' }],
              timestamp: '2026-03-13T19:00:01.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'thinking', thinking: 'Inspect the first issue' }],
              timestamp: '2026-03-13T19:00:02.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'First done' }],
              timestamp: '2026-03-13T19:00:03.000Z',
            },
            {
              role: 'user',
              content: [{ type: 'text', text: 'Second prompt' }],
              timestamp: '2026-03-13T19:00:04.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Second done' }],
              timestamp: '2026-03-13T19:00:05.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'tool-b', name: 'read', arguments: { path: 'README.md' } }],
              timestamp: '2026-03-13T18:00:07.100Z',
            },
            {
              role: 'toolResult',
              toolCallId: 'tool-b',
              toolName: 'read',
              content: [{ type: 'text', text: 'second output' }],
              timestamp: '2026-03-13T18:00:07.600Z',
            },
          ],
          streamingMessage: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Plan the next fix' }],
            timestamp: '2026-03-13T19:00:06.000Z',
          },
        },
        getContextUsage: () => null,
        isStreaming: true,
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-replayed-context', (event) => {
      events.push(event);
    });

    expect(events[0]?.type).toBe('snapshot');
    if (events[0]?.type !== 'snapshot') {
      return;
    }

    const blocks = events[0].blocks;
    expect(blocks.filter((block) => block.type === 'user' && block.text === 'First prompt')).toHaveLength(1);
    expect(blocks.filter((block) => block.type === 'user' && block.text === 'Second prompt')).toHaveLength(1);
    expect(blocks.filter((block) => block.type === 'text' && block.text === 'First done')).toHaveLength(1);
    expect(blocks.filter((block) => block.type === 'text' && block.text === 'Second done')).toHaveLength(1);
    expect(
      blocks.filter(
        (block): block is Extract<(typeof blocks)[number], { type: 'tool_use' }> =>
          block.type === 'tool_use' && block.toolCallId === 'tool-b' && block.output === 'second output',
      ),
    ).toHaveLength(1);
    expect(blocks.at(-1)).toMatchObject({
      type: 'thinking',
      text: 'Plan the next fix',
    });
    expect(blocks).toHaveLength(9);
  });

  it('includes compaction summaries in the live snapshot', () => {
    setLiveEntry('session-summary', {
      sessionId: 'session-summary',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Compacted conversation',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: {
          messages: [
            {
              role: 'compactionSummary',
              summary: '## Goal\nKeep the compacted context visible.',
              timestamp: 1,
            },
            {
              role: 'user',
              content: [{ type: 'text', text: 'Continue from the summary' }],
              timestamp: 2,
            },
          ],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-summary', (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({
      type: 'snapshot',
      blockOffset: 0,
      totalBlocks: 2,
      isStreaming: false,
      goalState: null,
      blocks: [
        {
          type: 'summary',
          id: 'live-0',
          ts: new Date(1).toISOString(),
          kind: 'compaction',
          title: 'Compaction summary',
          text: '## Goal\nKeep the compacted context visible.',
        },
        {
          type: 'user',
          id: 'live-1',
          ts: new Date(2).toISOString(),
          text: 'Continue from the summary',
        },
      ],
    });
  });

  it('includes reused related thread summaries in the live snapshot', () => {
    setLiveEntry('session-related-summary', {
      sessionId: 'session-related-summary',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Reused conversation context',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: {
          messages: [
            {
              role: 'custom',
              customType: 'related_threads_context',
              display: false,
              content: [
                {
                  type: 'text',
                  text: [
                    'The user explicitly selected previous conversations to reuse as background context for the next prompt.',
                    'Use only the parts that still help. Prefer the current prompt and current repo state over stale historical details.',
                    '',
                    'Conversation 1 — Release signing',
                    'Workspace: /repo/a',
                    'Created: 2026-04-10T10:00:00.000Z',
                    '',
                    'Keep the notarization mapping fix.',
                  ].join('\n'),
                },
              ],
              timestamp: 1,
            },
            {
              role: 'user',
              content: [{ type: 'text', text: 'Ship the release flow fix.' }],
              timestamp: 2,
            },
          ],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-related-summary', (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({
      type: 'snapshot',
      blockOffset: 0,
      totalBlocks: 2,
      isStreaming: false,
      goalState: null,
      blocks: [
        {
          type: 'summary',
          id: 'live-0',
          ts: new Date(1).toISOString(),
          kind: 'related',
          title: 'Reused thread summaries',
          detail: '1 selected conversation was summarized and injected before this prompt so this thread could start with reused context.',
          text: [
            '### Conversation 1 — Release signing',
            '- Workspace: `/repo/a`',
            '- Created: 2026-04-10T10:00:00.000Z',
            '',
            'Keep the notarization mapping fix.',
          ].join('\n'),
        },
        {
          type: 'user',
          id: 'live-1',
          ts: new Date(2).toISOString(),
          text: 'Ship the release flow fix.',
        },
      ],
    });
  });

  it('labels the latest live compaction summary with the compaction kind when available', () => {
    setLiveEntry('session-summary-labeled', {
      sessionId: 'session-summary-labeled',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Compacted conversation',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      lastCompactionSummaryTitle: 'Overflow recovery compaction',
      session: {
        state: {
          messages: [
            {
              role: 'compactionSummary',
              summary: '## Goal\nRetry after compaction.',
              timestamp: 1,
            },
            {
              role: 'user',
              content: [{ type: 'text', text: 'Continue from the summary' }],
              timestamp: 2,
            },
          ],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-summary-labeled', (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({
      type: 'snapshot',
      blockOffset: 0,
      totalBlocks: 2,
      isStreaming: false,
      goalState: null,
      blocks: [
        {
          type: 'summary',
          id: 'live-0',
          ts: new Date(1).toISOString(),
          kind: 'compaction',
          title: 'Overflow recovery compaction',
          text: '## Goal\nRetry after compaction.',
        },
        {
          type: 'user',
          id: 'live-1',
          ts: new Date(2).toISOString(),
          text: 'Continue from the summary',
        },
      ],
    });
  });

  it('surfaces Codex compaction detail on live compaction summaries', () => {
    setLiveEntry('session-summary-codex', {
      sessionId: 'session-summary-codex',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Compacted conversation',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      lastCompactionSummaryTitle: 'Overflow recovery compaction',
      session: {
        state: {
          messages: [
            {
              role: 'compactionSummary',
              summary: '## Goal\nRetry after compaction.',
              timestamp: 1,
              details: {
                nativeCompaction: {
                  version: 1,
                  provider: 'openai-responses-compact',
                  modelKey: 'openai-codex:openai-codex-responses:gpt-5.4',
                  replacementHistory: [
                    {
                      type: 'message',
                      role: 'user',
                      content: [{ type: 'input_text', text: 'Prompt after compaction' }],
                    },
                  ],
                },
              },
            },
          ],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-summary-codex', (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({
      type: 'snapshot',
      blockOffset: 0,
      totalBlocks: 1,
      isStreaming: false,
      goalState: null,
      blocks: [
        {
          type: 'summary',
          id: 'live-0',
          ts: new Date(1).toISOString(),
          kind: 'compaction',
          title: 'Overflow recovery compaction',
          text: '## Goal\nRetry after compaction.',
          detail: 'This used Codex compaction under the hood. Pi kept the text summary for display and portability.',
        },
      ],
    });
  });

  it('uses the persisted transcript for idle live sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-idle.jsonl');
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: 'session', id: 'session-idle', timestamp: '2026-03-13T18:00:00.000Z', cwd: '/tmp/workspace' }),
        JSON.stringify({
          type: 'message',
          id: 'user-1',
          parentId: null,
          timestamp: '2026-03-13T18:00:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'First prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-1',
          parentId: 'user-1',
          timestamp: '2026-03-13T18:00:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'user-2',
          parentId: 'assistant-1',
          timestamp: '2026-03-13T18:00:03.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Second prompt' }] },
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-2',
          parentId: 'user-2',
          timestamp: '2026-03-13T18:00:04.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Second answer' }] },
        }),
        '',
      ].join('\n'),
    );

    setLiveEntry('session-idle', {
      sessionId: 'session-idle',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Keep this sidebar title fresh',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      session: {
        sessionFile,
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Second prompt' }],
              timestamp: '2026-03-13T18:00:03.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Second answer' }],
              timestamp: '2026-03-13T18:00:04.000Z',
            },
          ],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-idle', (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({
      type: 'snapshot',
      blockOffset: 0,
      totalBlocks: 4,
      isStreaming: false,
      goalState: null,
      blocks: [
        {
          type: 'user',
          id: expect.any(String),
          ts: '2026-03-13T18:00:01.000Z',
          text: 'First prompt',
        },
        {
          type: 'text',
          id: expect.any(String),
          ts: '2026-03-13T18:00:02.000Z',
          text: 'First answer',
        },
        {
          type: 'user',
          id: expect.any(String),
          ts: '2026-03-13T18:00:03.000Z',
          text: 'Second prompt',
        },
        {
          type: 'text',
          id: expect.any(String),
          ts: '2026-03-13T18:00:04.000Z',
          text: 'Second answer',
        },
      ],
    });
  });

  it('includes the current live title in live session snapshots', () => {
    setLiveEntry('session-2', {
      sessionId: 'session-2',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Keep this sidebar title fresh',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      session: {
        sessionFile: '/tmp/workspace/session-2.jsonl',
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Keep this sidebar title fresh' }],
              timestamp: 1,
            },
          ],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    });

    expect(getLiveSessions()).toEqual([
      {
        id: 'session-2',
        cwd: '/tmp/workspace',
        sessionFile: '/tmp/workspace/session-2.jsonl',
        title: 'Keep this sidebar title fresh',
        running: false,
        isStreaming: false,
        hasStaleTurnState: false,
      },
    ]);
  });

  it('prefers the persisted session name over the first user message fallback', () => {
    setLiveEntry('session-3', {
      sessionId: 'session-3',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: '',
      autoTitleRequested: true,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile: '/tmp/workspace/session-3.jsonl',
        sessionName: 'Generated title',
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Fallback first prompt' }],
              timestamp: 1,
            },
          ],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    });

    expect(getLiveSessions()[0]).toEqual(
      expect.objectContaining({
        id: 'session-3',
        title: 'Generated title',
      }),
    );

    const events: SseEvent[] = [];
    subscribe('session-3', (event) => {
      events.push(event);
    });

    expect(events[1]).toEqual({ type: 'title_update', title: 'Generated title' });
  });

  it('keeps the sticky conversation title even if in-memory messages shift later', () => {
    setLiveEntry('session-sticky', {
      sessionId: 'session-sticky',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Original conversation title',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile: '/tmp/workspace/session-sticky.jsonl',
        state: {
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Compaction summary' }],
              timestamp: 1,
            },
            {
              role: 'user',
              content: [{ type: 'text', text: 'Most recent prompt after compaction' }],
              timestamp: 2,
            },
          ],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    });

    expect(getLiveSessions()[0]).toEqual(
      expect.objectContaining({
        id: 'session-sticky',
        title: 'Original conversation title',
      }),
    );

    const events: SseEvent[] = [];
    subscribe('session-sticky', (event) => {
      events.push(event);
    });

    expect(events[1]).toEqual({ type: 'title_update', title: 'Original conversation title' });
  });

  it('broadcasts manual renames immediately', () => {
    const session = {
      sessionFile: '/tmp/workspace/session-rename.jsonl',
      sessionName: undefined as string | undefined,
      state: {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Fallback first prompt' }],
            timestamp: 1,
          },
        ],
        streamingMessage: null,
      },
      getContextUsage: () => null,
      isStreaming: false,
      setSessionName: vi.fn((name: string) => {
        session.sessionName = name;
      }),
    };

    setLiveEntry('session-rename', {
      sessionId: 'session-rename',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: '',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session,
    });

    const events: SseEvent[] = [];
    subscribe('session-rename', (event) => {
      events.push(event);
    });
    events.length = 0;

    renameSession('session-rename', 'Better generated title');

    expect(session.setSessionName).toHaveBeenCalledWith('Better generated title');
    expect(getLiveSessions()[0]).toEqual(
      expect.objectContaining({
        id: 'session-rename',
        title: 'Better generated title',
      }),
    );
    expect(events).toContainEqual({ type: 'title_update', title: 'Better generated title' });
  });
});

describe('queued prompt restore', () => {
  it('describes image-only queued prompts without a fake attachment placeholder', () => {
    setLiveEntry('session-image-only-queue', {
      sessionId: 'session-image-only-queue',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Image only queued prompt',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        getSteeringMessages: () => [''],
        getFollowUpMessages: () => [],
        isStreaming: true,
        agent: {
          steeringQueue: {
            messages: [
              {
                role: 'user',
                content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
              },
            ],
          },
          followUpQueue: {
            messages: [],
          },
        },
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-image-only-queue', (event) => {
      events.push(event);
    });

    expect(events).toContainEqual({
      type: 'queue_state',
      steering: [expect.objectContaining({ text: '', imageCount: 1 })],
      followUp: [],
    });
  });

  it('marks fallback queue previews as restorable when the internal queue is unavailable', () => {
    setLiveEntry('session-visible-only-queue', {
      sessionId: 'session-visible-only-queue',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Visible-only queue',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        getSteeringMessages: () => ['queued prompt'],
        getFollowUpMessages: () => [],
        isStreaming: true,
        agent: {},
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-visible-only-queue', (event) => {
      events.push(event);
    });

    expect(events).toContainEqual({
      type: 'queue_state',
      steering: [{ id: 'steer-visible-0', text: 'queued prompt', imageCount: 0, restorable: true }],
      followUp: [],
    });
  });

  it('restores a visible-only queued prompt by clearing and rebuilding the remaining queue', async () => {
    const steeringMessages = ['first queued prompt', 'second queued prompt'];
    const clearQueue = vi.fn(() => ({ steering: [...steeringMessages], followUp: [] }));
    const steer = vi.fn(async (text: string) => {
      steeringMessages.push(text);
    });

    setLiveEntry('session-visible-only-restore', {
      sessionId: 'session-visible-only-restore',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Visible-only restore',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        getSteeringMessages: () => steeringMessages,
        getFollowUpMessages: () => [],
        clearQueue,
        steer,
        followUp: vi.fn(async () => undefined),
        isStreaming: true,
        agent: {},
      },
    });

    const restored = await restoreQueuedMessage('session-visible-only-restore', 'steer', 1, 'steer-visible-1');

    expect(restored).toEqual({
      text: 'second queued prompt',
      images: [],
    });
    expect(clearQueue).toHaveBeenCalledTimes(1);
    expect(steer).toHaveBeenCalledTimes(1);
    expect(steer).toHaveBeenCalledWith('first queued prompt');
  });

  it('lists queued prompt previews for live sessions', () => {
    setLiveEntry('session-list-queued-prompts', {
      sessionId: 'session-list-queued-prompts',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'List queued prompts',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        getSteeringMessages: () => ['first queued prompt'],
        getFollowUpMessages: () => ['follow-up prompt'],
        isStreaming: true,
        agent: {},
      },
    });

    expect(listQueuedPromptPreviews('session-list-queued-prompts')).toEqual({
      steering: [{ id: 'steer-visible-0', text: 'first queued prompt', imageCount: 0, restorable: true }],
      followUp: [{ id: 'followUp-visible-0', text: 'follow-up prompt', imageCount: 0, restorable: true }],
    });
  });

  it('cancels a visible-only queued prompt by clearing and rebuilding the remaining queue', async () => {
    const steeringMessages = ['first queued prompt', 'second queued prompt'];
    const clearQueue = vi.fn(() => ({ steering: [...steeringMessages], followUp: [] }));
    const steer = vi.fn(async (text: string) => {
      steeringMessages.push(text);
    });

    setLiveEntry('session-visible-only-cancel', {
      sessionId: 'session-visible-only-cancel',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Visible-only cancel',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        getSteeringMessages: () => steeringMessages,
        getFollowUpMessages: () => [],
        clearQueue,
        steer,
        followUp: vi.fn(async () => undefined),
        isStreaming: true,
        agent: {},
      },
    });

    const cancelled = await cancelQueuedPrompt('session-visible-only-cancel', 'steer', 'steer-visible-1');

    expect(cancelled).toEqual({ id: 'steer-visible-1', text: 'second queued prompt', imageCount: 0, restorable: true });
    expect(clearQueue).toHaveBeenCalledTimes(1);
    expect(steer).toHaveBeenCalledTimes(1);
    expect(steer).toHaveBeenCalledWith('first queued prompt');
  });

  it('cancels an internal queued prompt by preview id without disturbing other queued items', async () => {
    const steeringMessages = ['first queued prompt', 'second queued prompt'];
    const steeringQueue = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'first queued prompt' }],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'second queued prompt' }],
        },
      ],
    };

    setLiveEntry('session-queue-cancel', {
      sessionId: 'session-queue-cancel',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Cancel queued prompt',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: true,
        getSteeringMessages: () => steeringMessages,
        getFollowUpMessages: () => [],
        agent: {
          steeringQueue,
          followUpQueue: {
            messages: [],
          },
        },
      },
    });

    const previews = listQueuedPromptPreviews('session-queue-cancel');
    const secondPromptPreviewId = previews.steering[1]?.id;
    expect(secondPromptPreviewId).toBeTruthy();

    const cancelled = await cancelQueuedPrompt('session-queue-cancel', 'steer', secondPromptPreviewId as string);

    expect(cancelled).toEqual(expect.objectContaining({ id: secondPromptPreviewId, text: 'second queued prompt', imageCount: 0 }));
    expect(steeringMessages).toEqual(['first queued prompt']);
    expect(steeringQueue).toEqual({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'first queued prompt' }],
        },
      ],
    });
  });

  it('restores a queued prompt back to the composer payload without disturbing other queued items', async () => {
    const steeringMessages = ['first queued prompt', 'second queued prompt'];
    const steeringQueue = {
      messages: [
        { role: 'custom', content: 'internal steer context' },
        {
          role: 'user',
          content: [{ type: 'text', text: 'first queued prompt' }],
        },
        { role: 'custom', content: 'more internal steer context' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'second queued prompt' },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
          ],
        },
      ],
    };

    setLiveEntry('session-queue-restore', {
      sessionId: 'session-queue-restore',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Restore queued prompt',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: true,
        getSteeringMessages: () => steeringMessages,
        getFollowUpMessages: () => [],
        agent: {
          steeringQueue,
          followUpQueue: {
            messages: [],
          },
        },
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-queue-restore', (event) => {
      events.push(event);
    });

    const initialQueueState = events.find((event): event is Extract<SseEvent, { type: 'queue_state' }> => event.type === 'queue_state');
    const secondPromptPreviewId = initialQueueState?.steering[1]?.id;
    events.length = 0;

    const restored = await restoreQueuedMessage('session-queue-restore', 'steer', 1, secondPromptPreviewId);

    expect(restored).toEqual({
      text: 'second queued prompt',
      images: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
    });
    expect(steeringMessages).toEqual(['first queued prompt']);
    expect(steeringQueue).toEqual({
      messages: [
        { role: 'custom', content: 'internal steer context' },
        {
          role: 'user',
          content: [{ type: 'text', text: 'first queued prompt' }],
        },
        { role: 'custom', content: 'more internal steer context' },
      ],
    });
    expect(events).toContainEqual({
      type: 'queue_state',
      steering: [expect.objectContaining({ text: 'first queued prompt', imageCount: 0 })],
      followUp: [],
    });
  });

  it('ignores stale internal queue entries that already left the visible queue', () => {
    const steeringMessages = ['second queued prompt'];
    const steeringQueue = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'first queued prompt' }],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'second queued prompt' }],
        },
      ],
    };

    setLiveEntry('session-stale-internal-queue', {
      sessionId: 'session-stale-internal-queue',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Stale internal queue',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: true,
        getSteeringMessages: () => steeringMessages,
        getFollowUpMessages: () => [],
        agent: {
          steeringQueue,
          followUpQueue: {
            messages: [],
          },
        },
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-stale-internal-queue', (event) => {
      events.push(event);
    });

    expect(events).toContainEqual({
      type: 'queue_state',
      steering: [expect.objectContaining({ text: 'second queued prompt', imageCount: 0 })],
      followUp: [],
    });
    expect(events).not.toContainEqual({
      type: 'queue_state',
      steering: [expect.objectContaining({ text: 'first queued prompt', imageCount: 0 })],
      followUp: [],
    });
  });

  it('restores the intended queued prompt by preview id even after earlier prompts leave the visible queue first', async () => {
    const steeringMessages = ['first queued prompt', 'second queued prompt'];
    const steeringQueue = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'first queued prompt' }],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'second queued prompt' }],
        },
      ],
    };

    setLiveEntry('session-queue-restore-by-id', {
      sessionId: 'session-queue-restore-by-id',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Restore queued prompt by id',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: true,
        getSteeringMessages: () => steeringMessages,
        getFollowUpMessages: () => [],
        agent: {
          steeringQueue,
          followUpQueue: {
            messages: [],
          },
        },
      },
    });

    const events: SseEvent[] = [];
    subscribe('session-queue-restore-by-id', (event) => {
      events.push(event);
    });

    const initialQueueState = events.find((event): event is Extract<SseEvent, { type: 'queue_state' }> => event.type === 'queue_state');
    const secondPromptPreviewId = initialQueueState?.steering[1]?.id;
    expect(secondPromptPreviewId).toBeTruthy();

    steeringMessages.shift();
    events.length = 0;

    const restored = await restoreQueuedMessage('session-queue-restore-by-id', 'steer', 0, secondPromptPreviewId);

    expect(restored).toEqual({
      text: 'second queued prompt',
      images: [],
    });
    expect(steeringMessages).toEqual([]);
    expect(steeringQueue).toEqual({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'first queued prompt' }],
        },
      ],
    });
    expect(events).toContainEqual({
      type: 'queue_state',
      steering: [],
      followUp: [],
    });
  });

  it('rejects invalid queued prompt restore requests when the queue changed', async () => {
    setLiveEntry('session-queue-restore-invalid', {
      sessionId: 'session-queue-restore-invalid',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Restore queued prompt invalid',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        getSteeringMessages: () => ['queued prompt'],
        getFollowUpMessages: () => [],
        clearQueue: vi.fn(() => ({ steering: ['queued prompt'], followUp: [] })),
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        isStreaming: true,
        agent: {},
      },
    });

    await expect(restoreQueuedMessage('session-queue-restore-invalid', 'steer', -1)).rejects.toThrow(
      'Queued message index must be a non-negative integer',
    );
    await expect(restoreQueuedMessage('session-queue-restore-invalid', 'steer', 1)).rejects.toThrow(
      'Queued prompt changed before it could be restored. Try again.',
    );
    await expect(restoreQueuedMessage('session-queue-restore-invalid', 'steer', 0, 'steer-visible-9')).rejects.toThrow(
      'Queued prompt changed before it could be restored. Try again.',
    );
  });

  it('rebuilds remaining follow-up prompts after restoring a visible-only follow-up item', async () => {
    const followUpMessages = ['first follow-up', 'second follow-up'];
    const followUp = vi.fn(async (text: string) => {
      followUpMessages.push(text);
    });

    setLiveEntry('session-follow-up-restore', {
      sessionId: 'session-follow-up-restore',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Follow-up restore',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => followUpMessages,
        clearQueue: vi.fn(() => ({ steering: [], followUp: [...followUpMessages] })),
        steer: vi.fn(async () => undefined),
        followUp,
        isStreaming: true,
        agent: {},
      },
    });

    const restored = await restoreQueuedMessage('session-follow-up-restore', 'followUp', 0, 'followUp-visible-0');

    expect(restored).toEqual({ text: 'first follow-up', images: [] });
    expect(followUp).toHaveBeenCalledWith('second follow-up');
  });
});

describe('queuePromptContext', () => {
  it('appends visible context immediately when the session is idle so the user prompt stays latest', async () => {
    const sendCustomMessage = vi.fn(async () => undefined);

    setLiveEntry('session-idle-context', {
      sessionId: 'session-idle-context',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Idle context',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: false,
        sendCustomMessage,
      },
    });

    await queuePromptContext('session-idle-context', 'referenced_context', 'Conversation automation context');

    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'referenced_context',
      content: 'Conversation automation context',
      display: false,
      details: undefined,
    });
  });

  it('queues visible context for the next turn while the session is streaming', async () => {
    const sendCustomMessage = vi.fn(async () => undefined);

    setLiveEntry('session-streaming-context', {
      sessionId: 'session-streaming-context',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Streaming context',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: true,
        sendCustomMessage,
      },
    });

    await queuePromptContext('session-streaming-context', 'referenced_context', 'Conversation automation context');

    expect(sendCustomMessage).toHaveBeenCalledWith(
      {
        customType: 'referenced_context',
        content: 'Conversation automation context',
        display: false,
        details: undefined,
      },
      {
        deliverAs: 'nextTurn',
      },
    );
  });

  it('ignores blank context payloads', async () => {
    const sendCustomMessage = vi.fn(async () => undefined);

    setLiveEntry('session-blank-context', {
      sessionId: 'session-blank-context',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Blank context',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: false,
        sendCustomMessage,
      },
    });

    await queuePromptContext('session-blank-context', 'referenced_context', '   ');

    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('does not enqueue duplicate related conversation pointers for a conversation', async () => {
    const pointerContext = 'Potentially related previous conversations are available as pointers only.';
    const sendCustomMessage = vi.fn(async () => undefined);

    setLiveEntry('session-duplicate-related-pointers', {
      sessionId: 'session-duplicate-related-pointers',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Duplicate related pointers',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: {
          messages: [
            {
              role: 'custom',
              customType: 'related_conversation_pointers',
              content: pointerContext,
            },
          ],
          streamingMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
        sendCustomMessage,
      },
    });

    await queuePromptContext('session-duplicate-related-pointers', 'related_conversation_pointers', pointerContext);

    expect(sendCustomMessage).not.toHaveBeenCalled();
  });
});

describe('conversation auto mode', () => {
  it('persists live auto mode state without immediately running a review event', async () => {
    const entries: unknown[] = [];
    const appendCustomEntry = vi.fn((customType: string, data: unknown) => {
      entries.push({ type: 'custom', customType, data });
      return 'entry-1';
    });
    const sendCustomMessage = vi.fn(async () => undefined);

    setLiveEntry('session-auto-mode', {
      sessionId: 'session-auto-mode',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Auto mode',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'previous reply' }] }], streamingMessage: null },
        sessionManager: {
          getEntries: () => entries,
          appendCustomEntry,
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: false,
        sendCustomMessage,
      },
    });

    const state = await setLiveSessionAutoModeState('session-auto-mode', { enabled: true, updatedAt: '2026-04-12T15:00:00.000Z' });

    expect(state).toEqual({
      enabled: true,
      mode: 'nudge',
      stopReason: null,
      updatedAt: '2026-04-12T15:00:00.000Z',
    });
    expect(readLiveSessionAutoModeState('session-auto-mode')).toEqual(state);
    expect(appendCustomEntry).toHaveBeenCalledWith('conversation-auto-mode', state);
    expect(sendCustomMessage).not.toHaveBeenCalled();

    await expect(requestConversationAutoModeTurn('session-auto-mode')).resolves.toBe(false);
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('does not queue an auto review turn on a brand new conversation with no assistant history yet', async () => {
    setLiveEntry('session-auto-mode-empty', {
      sessionId: 'session-auto-mode-empty',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Auto mode empty',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        sessionManager: {
          getEntries: () => [
            {
              type: 'custom',
              customType: 'conversation-auto-mode',
              data: {
                enabled: true,
                updatedAt: '2026-04-12T15:09:00.000Z',
              },
            },
          ],
          appendCustomEntry: vi.fn(),
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: false,
        sendCustomMessage: vi.fn(async () => undefined),
      },
    });

    await expect(requestConversationAutoModeTurn('session-auto-mode-empty')).resolves.toBe(false);
  });

  it('does not queue another review event while work is already streaming', async () => {
    setLiveEntry('session-auto-mode-busy', {
      sessionId: 'session-auto-mode-busy',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Auto mode busy',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }], streamingMessage: null },
        sessionManager: {
          getEntries: () => [
            {
              type: 'custom',
              customType: 'conversation-auto-mode',
              data: {
                enabled: true,
                updatedAt: '2026-04-12T15:10:00.000Z',
              },
            },
          ],
          appendCustomEntry: vi.fn(),
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: true,
        sendCustomMessage: vi.fn(async () => undefined),
      },
    });

    await expect(requestConversationAutoModeTurn('session-auto-mode-busy')).resolves.toBe(false);
  });

  it('ignores legacy continuation intent because goal mode owns continuations', async () => {
    const sendCustomMessage = vi.fn(async () => undefined);

    setLiveEntry('session-auto-continue', {
      sessionId: 'session-auto-continue',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Auto mode continue',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        sessionManager: {
          getEntries: () => [
            {
              type: 'custom',
              customType: 'conversation-auto-mode',
              data: {
                enabled: true,
                updatedAt: '2026-04-12T15:12:00.000Z',
              },
            },
          ],
          appendCustomEntry: vi.fn(),
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: false,
        sendCustomMessage,
      },
    });

    markConversationAutoModeContinueRequested('session-auto-continue');
    expect(registry.get('session-auto-continue')?.pendingAutoModeContinuation).toBeUndefined();

    await expect(requestConversationAutoModeContinuationTurn('session-auto-continue')).resolves.toBe(false);
    expect(sendCustomMessage).not.toHaveBeenCalled();
    expect(registry.get('session-auto-continue')?.queuedStaleTurnCustomTypes ?? []).toEqual([]);
  });

  it('run_state tool reads and writes mission task state through session manager', async () => {
    const entries: Array<{ type: string; customType: string; data: unknown }> = [
      {
        type: 'custom',
        customType: 'conversation-auto-mode',
        data: {
          enabled: true,
          mode: 'mission',
          mission: {
            goal: 'Deploy the feature',
            tasks: [
              { id: 'a1', description: 'Run tests', status: 'pending' },
              { id: 'a2', description: 'Build', status: 'pending' },
            ],
          },
          updatedAt: '2026-04-12T15:00:00.000Z',
        },
      },
    ];

    setLiveEntry('session-runstate', {
      sessionId: 'session-runstate',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Run state tool',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'work' }] }], streamingMessage: null },
        sessionManager: {
          getEntries: () => entries,
          appendCustomEntry: (customType: string, data: unknown) => {
            entries.push({ type: 'custom', customType, data });
            return 'entry-rs';
          },
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: false,
        sendCustomMessage: vi.fn(),
      },
    });

    // Read back state
    const state = readLiveSessionAutoModeState('session-runstate');
    expect(state.mode).toBe('mission');
    expect(state.mission?.tasks).toHaveLength(2);
    expect(state.mission?.tasks[0].status).toBe('pending');

    // Simulate agent updating tasks by writing updated state
    state.mission!.tasks[0].status = 'done';
    await setLiveSessionAutoModeState('session-runstate', {
      enabled: true,
      mode: 'mission',
      mission: state.mission!,
    });

    // Verify update persisted
    const finalState = readLiveSessionAutoModeState('session-runstate');
    expect(finalState.mission?.tasks[0].status).toBe('done');
    expect(finalState.mission?.tasks[1].status).toBe('pending');
  });

  it('legacy enabled:true maps to mode nudge with backward compat', async () => {
    const appendCustomEntry = vi.fn();

    setLiveEntry('session-legacy', {
      sessionId: 'session-legacy',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Legacy mode',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'work' }] }], streamingMessage: null },
        sessionManager: {
          getEntries: () => [
            {
              type: 'custom',
              customType: 'conversation-auto-mode',
              data: { enabled: true, updatedAt: '2026-04-12T15:00:00.000Z' },
            },
          ],
          appendCustomEntry,
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: false,
        sendCustomMessage: vi.fn(),
      },
    });

    const state = readLiveSessionAutoModeState('session-legacy');
    expect(state.mode).toBe('nudge');
    expect(state.enabled).toBe(true);
  });
});

describe('legacy auto mode continuation quarantine', () => {
  it('sends a mode-specific continuation message for nudge mode', async () => {
    const sendCustomMessage = vi.fn(async () => undefined);

    setLiveEntry('session-msg-nudge', {
      sessionId: 'session-msg-nudge',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Nudge continuation message',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      pendingAutoModeContinuation: true,
      session: {
        state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'work done' }] }], streamingMessage: null },
        sessionManager: {
          getEntries: () => [
            {
              type: 'custom',
              customType: 'conversation-auto-mode',
              data: { enabled: true, mode: 'nudge', updatedAt: '2026-04-12T15:00:00.000Z' },
            },
          ],
          appendCustomEntry: vi.fn(),
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: false,
        sendCustomMessage,
      },
    });

    await expect(requestConversationAutoModeContinuationTurn('session-msg-nudge')).resolves.toBe(false);
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('sends a mode-specific continuation message for mission mode', async () => {
    const sendCustomMessage = vi.fn(async () => undefined);

    setLiveEntry('session-msg-mission', {
      sessionId: 'session-msg-mission',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Mission continuation message',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      pendingAutoModeContinuation: true,
      session: {
        state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'work done' }] }], streamingMessage: null },
        sessionManager: {
          getEntries: () => [
            {
              type: 'custom',
              customType: 'conversation-auto-mode',
              data: {
                enabled: true,
                mode: 'mission',
                mission: {
                  goal: 'Fix the page',
                  tasks: [
                    { id: 't1', description: 'Task 1', status: 'done' },
                    { id: 't2', description: 'Task 2', status: 'pending' },
                  ],
                },
                updatedAt: '2026-04-12T15:00:00.000Z',
              },
            },
          ],
          appendCustomEntry: vi.fn(),
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: false,
        sendCustomMessage,
      },
    });

    await expect(requestConversationAutoModeContinuationTurn('session-msg-mission')).resolves.toBe(false);
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('sends a mode-specific continuation message for loop mode', async () => {
    const sendCustomMessage = vi.fn(async () => undefined);

    setLiveEntry('session-msg-loop', {
      sessionId: 'session-msg-loop',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Loop continuation message',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      pendingAutoModeContinuation: true,
      session: {
        state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'work done' }] }], streamingMessage: null },
        sessionManager: {
          getEntries: () => [
            {
              type: 'custom',
              customType: 'conversation-auto-mode',
              data: {
                enabled: true,
                mode: 'loop',
                loop: {
                  prompt: 'Find and fix a bug',
                  maxIterations: 5,
                  iterationsUsed: 2,
                  delay: 'After each turn',
                },
                updatedAt: '2026-04-12T15:00:00.000Z',
              },
            },
          ],
          appendCustomEntry: vi.fn(),
        },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: false,
        sendCustomMessage,
      },
    });

    await expect(requestConversationAutoModeContinuationTurn('session-msg-loop')).resolves.toBe(false);
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });
});

describe('appendDetachedUserMessage', () => {
  it('appends a detached user message and promotes it into the fallback title when needed', async () => {
    const appendMessage = vi.fn();

    setLiveEntry('session-detached-user', {
      sessionId: 'session-detached-user',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'New Conversation',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        sessionManager: { appendMessage },
        sessionName: undefined,
        getContextUsage: () => null,
        isStreaming: false,
      },
    });

    await appendDetachedUserMessage('session-detached-user', '  Keep this draft alive.  ');

    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: 'Keep this draft alive.' }],
      }),
    );
    expect(registry.get('session-detached-user')?.session.state.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: 'Keep this draft alive.' }],
      }),
    ]);
    expect(getLiveSessions()).toContainEqual(
      expect.objectContaining({
        id: 'session-detached-user',
        title: 'Keep this draft alive.',
      }),
    );
  });

  it('rejects detached user messages for missing or streaming sessions and ignores blank text', async () => {
    await expect(appendDetachedUserMessage('missing-session', 'hello')).rejects.toThrow('Session missing-session is not live');

    const appendMessage = vi.fn();
    setLiveEntry('session-detached-streaming', {
      sessionId: 'session-detached-streaming',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Streaming',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        sessionManager: { appendMessage },
        getContextUsage: () => null,
        isStreaming: true,
      },
    });

    await expect(appendDetachedUserMessage('session-detached-streaming', 'hello')).rejects.toThrow(
      'Session session-detached-streaming is currently streaming',
    );

    setLiveEntry('session-detached-blank', {
      sessionId: 'session-detached-blank',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'No change',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        sessionManager: { appendMessage },
        getContextUsage: () => null,
        isStreaming: false,
      },
    });

    await appendDetachedUserMessage('session-detached-blank', '   ');
    expect(appendMessage).not.toHaveBeenCalled();
    expect(registry.get('session-detached-blank')?.session.state.messages).toEqual([]);
  });
});

describe('appendVisibleCustomMessage', () => {
  it('sends visible custom messages for idle sessions and ignores blank payloads', async () => {
    const sendCustomMessage = vi.fn(async () => undefined);

    setLiveEntry('session-visible-custom-message', {
      sessionId: 'session-visible-custom-message',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Visible custom message',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: false,
        sendCustomMessage,
      },
    });

    await appendVisibleCustomMessage('session-visible-custom-message', 'automation_note', '  Show this note.  ', { severity: 'info' });
    await appendVisibleCustomMessage('session-visible-custom-message', 'automation_note', '   ');

    expect(sendCustomMessage).toHaveBeenCalledTimes(1);
    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'automation_note',
      content: 'Show this note.',
      display: true,
      details: expect.objectContaining({ severity: 'info' }),
    });
  });

  it('rejects visible custom messages while the session is streaming', async () => {
    setLiveEntry('session-visible-custom-streaming', {
      sessionId: 'session-visible-custom-streaming',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Visible custom streaming',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: true,
        sendCustomMessage: vi.fn(async () => undefined),
      },
    });

    await expect(appendVisibleCustomMessage('session-visible-custom-streaming', 'automation_note', 'show this')).rejects.toThrow(
      'Session session-visible-custom-streaming is currently streaming',
    );
  });
});

describe('submitPromptSession', () => {
  it('returns after the prompt is accepted instead of waiting for full completion', async () => {
    const listeners = new Set<(event: AgentSessionEvent) => void>();
    let resolvePrompt: () => void = () => {
      throw new Error('prompt resolver not set');
    };
    let completionResolved = false;

    setLiveEntry('session-submit-started', {
      sessionId: 'session-submit-started',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Started prompt',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: false,
        subscribe(listener: (event: AgentSessionEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        prompt: vi.fn(async () => {
          listeners.forEach((listener) => {
            listener(
              asAgentSessionEvent({
                type: 'message_start',
                message: {
                  role: 'user',
                  content: [{ type: 'text', text: 'hello there' }],
                  timestamp: 1,
                },
              }),
            );
          });

          await new Promise<void>((resolve) => {
            resolvePrompt = resolve;
          });
          completionResolved = true;
        }),
      },
    });

    const submitted = await submitPromptSession('session-submit-started', 'hello there');
    expect(submitted.acceptedAs).toBe('started');
    void submitted.completion.then(() => {
      completionResolved = true;
    });
    expect(completionResolved).toBe(false);

    resolvePrompt();
    await submitted.completion;
    expect(completionResolved).toBe(true);
  });

  it('keeps an already-clicked send alive after the originating surface disconnects', async () => {
    const prompt = vi.fn(async () => undefined);

    setLiveEntry('session-submit-detached-surface', {
      sessionId: 'session-submit-detached-surface',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Detached surface prompt',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: false,
        subscribe: () => () => {},
        prompt,
      },
    });

    const unsubscribe = subscribe('session-submit-detached-surface', () => {}, {
      surface: {
        surfaceId: 'desktop-1',
        surfaceType: 'desktop_web',
      },
    });
    expect(unsubscribe).not.toBeNull();
    takeOverSessionControl('session-submit-detached-surface', 'desktop-1');
    unsubscribe?.();

    const submitted = await submitPromptSession('session-submit-detached-surface', 'send this anyway', undefined, undefined, 'desktop-1');

    expect(submitted.acceptedAs).toBe('started');
    await submitted.completion;
    expect(prompt).toHaveBeenCalledWith('send this anyway');
  });

  it('reports queued acceptance when the prompt is enqueued as follow-up work', async () => {
    const followUp = vi.fn(async () => undefined);

    setLiveEntry('session-submit-queued', {
      sessionId: 'session-submit-queued',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Queued submit',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: true,
        followUp,
        prompt: vi.fn(async () => undefined),
        steer: vi.fn(async () => undefined),
      },
    });

    const submitted = await submitPromptSession('session-submit-queued', 'keep going', 'followUp');

    expect(submitted.acceptedAs).toBe('queued');
    await expect(submitted.completion).resolves.toBeUndefined();
    expect(followUp).toHaveBeenCalledWith('keep going');
  });

  it('surfaces assistant prompt failures before the full prompt promise settles', async () => {
    const listeners = new Set<(event: AgentSessionEvent) => void>();

    setLiveEntry('session-submit-error', {
      sessionId: 'session-submit-error',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Errored submit',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: false,
        subscribe(listener: (event: AgentSessionEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        prompt: vi.fn(async () => {
          listeners.forEach((listener) => {
            listener(
              asAgentSessionEvent({
                type: 'message_end',
                message: {
                  role: 'assistant',
                  content: [],
                  stopReason: 'error',
                  errorMessage: 'Codex error: upstream overloaded',
                  timestamp: 1,
                },
              }),
            );
          });
        }),
      },
    });

    await expect(submitPromptSession('session-submit-error', 'hello there')).rejects.toThrow('Codex error: upstream overloaded');
  });
});

describe('promptSession', () => {
  it('delivers follow-up prompts immediately when the session is idle', async () => {
    const prompt = vi.fn(async () => undefined);
    const steer = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);

    setLiveEntry('session-idle-followup', {
      sessionId: 'session-idle-followup',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Idle follow-up',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: false,
        prompt,
        steer,
        followUp,
      },
    });

    await promptSession('session-idle-followup', 'continue working', 'followUp');

    expect(prompt).toHaveBeenCalledWith('continue working');
    expect(steer).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
  });

  it('branches away from dangling tool calls before sending a fresh prompt', async () => {
    const prompt = vi.fn(async () => undefined);
    const branch = vi.fn();
    const resetLeaf = vi.fn();
    const sanitizedMessages = [{ role: 'assistant', content: [{ type: 'text', text: 'Stable answer' }] }];
    const state = {
      messages: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'README.md' } }] }],
      streamingMessage: null,
    };

    setLiveEntry('session-dangling-tool-repair', {
      sessionId: 'session-dangling-tool-repair',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Dangling tool repair',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state,
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              id: 'user-1',
              parentId: null,
              timestamp: '2026-04-18T10:00:00.000Z',
              message: { role: 'user', content: [{ type: 'text', text: 'Keep going.' }] },
            },
            {
              type: 'message',
              id: 'assistant-1',
              parentId: 'user-1',
              timestamp: '2026-04-18T10:00:01.000Z',
              message: { role: 'assistant', content: [{ type: 'text', text: 'Stable answer' }], stopReason: 'stop' },
            },
            {
              type: 'custom_message',
              id: 'hidden-1',
              parentId: 'assistant-1',
              timestamp: '2026-04-18T10:00:02.000Z',
              customType: 'conversation_automation_post_turn_review',
              content: [{ type: 'text', text: 'Legacy review prompt.' }],
              display: false,
            },
            {
              type: 'message',
              id: 'assistant-2',
              parentId: 'hidden-1',
              timestamp: '2026-04-18T10:00:03.000Z',
              message: {
                role: 'assistant',
                content: [{ type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'README.md' } }],
                stopReason: 'toolUse',
              },
            },
          ],
          getEntry: (id: string) =>
            (
              ({
                'assistant-1': {
                  type: 'message',
                  id: 'assistant-1',
                  parentId: 'user-1',
                  timestamp: '2026-04-18T10:00:01.000Z',
                  message: { role: 'assistant', content: [{ type: 'text', text: 'Stable answer' }], stopReason: 'stop' },
                },
                'hidden-1': {
                  type: 'custom_message',
                  id: 'hidden-1',
                  parentId: 'assistant-1',
                  timestamp: '2026-04-18T10:00:02.000Z',
                  customType: 'conversation_automation_post_turn_review',
                  content: [{ type: 'text', text: 'Legacy review prompt.' }],
                  display: false,
                },
              }) as Record<string, unknown>
            )[id],
          branch,
          resetLeaf,
          buildSessionContext: () => ({ messages: sanitizedMessages, thinkingLevel: 'off', model: null }),
        },
        getContextUsage: () => null,
        isStreaming: false,
        prompt,
      },
    });

    await promptSession('session-dangling-tool-repair', 'continue working');

    expect(branch).toHaveBeenCalledWith('hidden-1');
    expect(resetLeaf).not.toHaveBeenCalled();
    expect(state.messages).toBe(sanitizedMessages);
    expect(prompt).toHaveBeenCalledWith('continue working');
  });

  it('keeps matched tool call history intact when the transcript is already valid', async () => {
    const prompt = vi.fn(async () => undefined);
    const branch = vi.fn();
    const resetLeaf = vi.fn();
    const state = {
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ready' }] }],
      streamingMessage: null,
    };

    setLiveEntry('session-valid-tool-history', {
      sessionId: 'session-valid-tool-history',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Valid tool history',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state,
        sessionManager: {
          getBranch: () => [
            {
              type: 'message',
              id: 'user-1',
              parentId: null,
              timestamp: '2026-04-18T10:01:00.000Z',
              message: { role: 'user', content: [{ type: 'text', text: 'Check the file.' }] },
            },
            {
              type: 'message',
              id: 'assistant-1',
              parentId: 'user-1',
              timestamp: '2026-04-18T10:01:01.000Z',
              message: {
                role: 'assistant',
                content: [{ type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'README.md' } }],
                stopReason: 'toolUse',
              },
            },
            {
              type: 'message',
              id: 'tool-1',
              parentId: 'assistant-1',
              timestamp: '2026-04-18T10:01:02.000Z',
              message: {
                role: 'toolResult',
                toolCallId: 'call_1',
                toolName: 'read',
                content: [{ type: 'text', text: 'all good' }],
              },
            },
          ],
          getEntry: vi.fn(),
          branch,
          resetLeaf,
          buildSessionContext: vi.fn(() => ({ messages: [], thinkingLevel: 'off', model: null })),
        },
        getContextUsage: () => null,
        isStreaming: false,
        prompt,
      },
    });

    await promptSession('session-valid-tool-history', 'continue working');

    expect(branch).not.toHaveBeenCalled();
    expect(resetLeaf).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledWith('continue working');
    expect(state.messages).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'ready' }] }]);
  });

  it('queues follow-up prompts while the session is streaming', async () => {
    const prompt = vi.fn(async () => undefined);
    const steer = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);

    setLiveEntry('session-streaming-followup', {
      sessionId: 'session-streaming-followup',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Streaming follow-up',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: true,
        prompt,
        steer,
        followUp,
      },
    });

    await promptSession('session-streaming-followup', 'continue working', 'followUp');

    expect(prompt).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
    expect(followUp).toHaveBeenCalledWith('continue working');
  });

  it('defaults to a queued follow-up when the session is already streaming', async () => {
    const prompt = vi.fn(async () => undefined);
    const steer = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);

    setLiveEntry('session-streaming-default-followup', {
      sessionId: 'session-streaming-default-followup',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Streaming default follow-up',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: true,
        prompt,
        steer,
        followUp,
      },
    });

    await promptSession('session-streaming-default-followup', 'keep going');

    expect(prompt).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
    expect(followUp).toHaveBeenCalledWith('keep going');
  });

  it('prompts immediately when only stale turn state remains', async () => {
    const prompt = vi.fn(async () => undefined);
    const steer = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);

    setLiveEntry('session-hidden-pending-followup', {
      sessionId: 'session-hidden-pending-followup',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Stale pending follow-up',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      queuedStaleTurnCustomTypes: ['conversation_automation_post_turn_review'],
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        isStreaming: false,
        prompt,
        steer,
        followUp,
      },
    });

    await promptSession('session-hidden-pending-followup', 'my missing message');

    expect(prompt).toHaveBeenCalledWith('my missing message');
    expect(steer).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
  });

  it('retries queued steering prompts without images when the model rejects image input', async () => {
    const steer = vi.fn(async (_text: string, images?: unknown[]) => {
      if (images) {
        throw new Error('Image input is unsupported for this text-only model.');
      }
    });

    setLiveEntry('session-steer-image-fallback', {
      sessionId: 'session-steer-image-fallback',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Steer image fallback',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        model: { input: ['text', 'image'] },
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        isStreaming: true,
        prompt: vi.fn(async () => undefined),
        steer,
        followUp: vi.fn(async () => undefined),
      },
    });

    const image = {
      type: 'image' as const,
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      mimeType: 'image/png',
    };
    await promptSession('session-steer-image-fallback', 'continue with this screenshot', 'steer', [image]);

    expect(steer).toHaveBeenNthCalledWith(1, 'continue with this screenshot', [image]);
    expect(steer).toHaveBeenNthCalledWith(2, 'continue with this screenshot');
  });

  it('rethrows unrelated image prompt failures instead of silently retrying', async () => {
    const prompt = vi.fn(async () => {
      throw new Error('network unavailable');
    });

    setLiveEntry('session-image-error', {
      sessionId: 'session-image-error',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Image error',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamingMessage: null },
        getContextUsage: () => null,
        model: { input: ['text', 'image'] },
        isStreaming: false,
        prompt,
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      },
    });

    await expect(
      promptSession('session-image-error', 'continue with this screenshot', undefined, [
        {
          type: 'image',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
          mimeType: 'image/png',
        },
      ]),
    ).rejects.toThrow('network unavailable');
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});

describe('session actions', () => {
  it('normalizes GPT-5.5 live context usage to the current 400k window', () => {
    setLiveEntry('session-gpt-55-context', {
      sessionId: 'session-gpt-55-context',
      session: {
        model: { id: 'gpt-5.5', contextWindow: 272_000 },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Context tokens' }] }],
        getContextUsage: () => ({ tokens: 200_000, contextWindow: 272_000, percent: 73.5 }),
      },
    });

    expect(getSessionContextUsage('session-gpt-55-context')).toEqual(
      expect.objectContaining({
        tokens: 200_000,
        modelId: 'gpt-5.5',
        contextWindow: 400_000,
        percent: 50,
      }),
    );
  });

  it('compacts a live session and broadcasts the refreshed snapshot and context usage', async () => {
    const compact = vi.fn(async () => ({ summary: 'compacted' }));
    const events: SseEvent[] = [];

    setLiveEntry('session-compact', {
      sessionId: 'session-compact',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Compact this session',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      contextUsageTimer: setTimeout(() => undefined, 10_000),
      session: {
        state: {
          messages: [
            {
              role: 'compactionSummary',
              summary: '## Goal\nKeep the compacted context visible.',
              timestamp: 1,
            },
          ],
          streamingMessage: null,
        },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Context tokens' }] }],
        getContextUsage: () => ({ tokens: 8, contextWindow: 64, percent: 12.5 }),
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        compact,
        isStreaming: false,
      },
    });

    registry.get('session-compact')?.listeners.add({
      send: (event: SseEvent) => {
        events.push(event);
      },
    } as never);

    await expect(compactSession('session-compact', 'summarize this first')).resolves.toEqual({ summary: 'compacted' });

    expect(compact).toHaveBeenCalledWith('summarize this first');
    expect(registry.get('session-compact')?.lastCompactionSummaryTitle).toBe('Manual compaction');
    expect(registry.get('session-compact')?.contextUsageTimer).toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({ type: 'snapshot' }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'context_usage',
        usage: expect.objectContaining({ tokens: 8 }),
      }),
    );
  });

  it('reloads, exports, aborts, and destroys live sessions through the underlying session object', async () => {
    const abort = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const exportToHtml = vi.fn(async (outputPath?: string) => outputPath ?? '/tmp/default.html');
    const reload = vi.fn(async () => undefined);

    setLiveEntry('session-actions', {
      sessionId: 'session-actions',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Session actions',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      contextUsageTimer: setTimeout(() => undefined, 10_000),
      session: {
        getContextUsage: () => null,
        isStreaming: false,
        abort,
        dispose,
        exportToHtml,
        reload,
      },
    });

    await reloadSessionResources('session-actions');
    await expect(exportSessionHtml('session-actions', '/tmp/session-actions.html')).resolves.toBe('/tmp/session-actions.html');
    await abortSession('session-actions');
    await abortSession('missing-session');
    destroySession('session-actions');

    expect(reload).toHaveBeenCalledTimes(1);
    expect(exportToHtml).toHaveBeenCalledWith('/tmp/session-actions.html');
    expect(abort).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(isLive('session-actions')).toBe(false);
  });

  it('updates live session model preferences with the current session state', async () => {
    const applyPreferences = vi.spyOn(conversationModelPreferences, 'applyConversationModelPreferencesToLiveSession').mockResolvedValue({
      currentModel: 'gpt-5',
      currentThinkingLevel: 'high',
      currentServiceTier: 'priority',
      hasExplicitServiceTier: true,
    });

    try {
      setLiveEntry('session-model-preferences', {
        sessionId: 'session-model-preferences',
        cwd: '/tmp/workspace',
        listeners: new Set(),
        title: 'Model preferences',
        autoTitleRequested: false,
        lastContextUsageJson: null,
        lastQueueStateJson: null,
        session: {
          model: { id: 'gpt-4.1' },
          thinkingLevel: 'low',
          agent: {},
          modelRegistry: {},
        },
      });

      await expect(
        updateLiveSessionModelPreferences('session-model-preferences', { model: 'gpt-5', thinkingLevel: 'high' }, [
          { id: 'gpt-5', provider: 'openai' },
        ] as never),
      ).resolves.toEqual({
        currentModel: 'gpt-5',
        currentThinkingLevel: 'high',
        currentServiceTier: 'priority',
        hasExplicitServiceTier: true,
      });

      expect(applyPreferences).toHaveBeenCalledWith(
        registry.get('session-model-preferences')?.session,
        { model: 'gpt-5', thinkingLevel: 'high' },
        { currentModel: 'gpt-4.1', currentThinkingLevel: 'low', currentServiceTier: '' },
        [{ id: 'gpt-5', provider: 'openai' }],
      );
    } finally {
      applyPreferences.mockRestore();
    }
  });
});

describe('event translation', () => {
  it('surfaces user messages from message_start events immediately', () => {
    expect(
      toSse(
        asAgentSessionEvent({
          type: 'message_start',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Show this prompt right away.' }],
            timestamp: 1,
          },
        }),
      ),
    ).toEqual({
      type: 'user_message',
      block: {
        type: 'user',
        id: 'live-user',
        ts: new Date(1).toISOString(),
        text: 'Show this prompt right away.',
      },
    });
  });

  it('ignores user message_end events to avoid duplicate rows', () => {
    expect(
      toSse(
        asAgentSessionEvent({
          type: 'message_end',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Show this prompt right away.' }],
            timestamp: 1,
          },
        }),
      ),
    ).toBeNull();
  });

  it('surfaces assistant error messages from message_end events', () => {
    expect(
      toSse(
        asAgentSessionEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'Codex error: upstream overloaded',
            timestamp: 1,
          },
        }),
      ),
    ).toEqual({
      type: 'error',
      message: 'Codex error: upstream overloaded',
    });
  });

  it('translates tool completions, auto compaction starts, and unknown events consistently', () => {
    expect(
      toSse(
        asAgentSessionEvent({
          type: 'tool_execution_end',
          toolCallId: 'tool-1',
          toolName: 'read',
          isError: false,
          result: {
            content: [
              { type: 'text', text: 'first line' },
              { type: 'image', data: 'ignored' },
              { type: 'text', text: 'second line' },
            ],
            details: { size: 2 },
          },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        type: 'tool_end',
        toolCallId: 'tool-1',
        toolName: 'read',
        isError: false,
        output: 'first line\nsecond line',
        details: { size: 2 },
        durationMs: expect.any(Number),
      }),
    );

    expect(
      toSse(
        asAgentSessionEvent({
          type: 'compaction_start',
          reason: 'overflow',
        }),
      ),
    ).toEqual({ type: 'compaction_start', mode: 'auto', reason: 'overflow' });

    expect(toSse(asAgentSessionEvent({ type: 'unhandled_event_type' }))).toBeNull();
  });
});

describe('session directory resolution', () => {
  it('stores web-created sessions under cwd-specific subdirectories', () => {
    expect(resolvePersistentSessionDir('/Users/patrick/workingdir/personal-agent')).toBe(
      join(getDurableSessionsDir(), '--Users-patrick-workingdir-personal-agent--'),
    );
  });
});

describe('session file persistence', () => {
  it('creates a session file immediately for a brand-new session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session.jsonl');

    const manager = {
      persist: true,
      sessionFile,
      flushed: false,
      _rewriteFile() {
        this.flushed = false;
        writeFileSync(sessionFile, '{"type":"session","id":"session-1"}\n');
      },
    };

    ensureSessionFileExists(asPersistedSessionManager(manager));

    expect(existsSync(sessionFile)).toBe(true);
    expect(manager.flushed).toBe(true);
    expect(readFileSync(sessionFile, 'utf-8')).toContain('"type":"session"');
  });

  it('persists user-only session state instead of waiting for the first assistant reply', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session.jsonl');
    const entries: unknown[] = [
      { type: 'session', id: 'session-1' },
      {
        type: 'message',
        id: 'user-1',
        parentId: null,
        timestamp: '2026-03-11T16:55:00.000Z',
        message: { role: 'user', content: 'Keep this draft alive.' },
      },
    ];

    const manager: {
      persist: boolean;
      sessionFile: string;
      flushed: boolean;
      fileEntries: unknown[];
      _rewriteFile(): void;
      _persist?: (entry: unknown) => void;
    } = {
      persist: true,
      sessionFile,
      flushed: false,
      fileEntries: entries,
      _rewriteFile() {
        writeFileSync(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
      },
    };

    patchSessionManagerPersistence(asPersistedSessionManager(manager));
    manager._persist?.(entries[1]);

    expect(manager.flushed).toBe(true);
    expect(readFileSync(sessionFile, 'utf-8')).toContain('Keep this draft alive.');
  });
});
