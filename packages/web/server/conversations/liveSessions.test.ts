import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDurableSessionsDir } from '@personal-agent/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canInjectResumeFallbackPrompt,
  ensureSessionFileExists,
  getLiveSessions,
  isPlaceholderConversationTitle,
  patchSessionManagerPersistence,
  promptSession,
  requestConversationWorkingDirectoryChange,
  submitPromptSession,
  queuePromptContext,
  registry,
  refreshAllLiveSessionModelRegistries,
  reloadAllLiveSessionAuth,
  renameSession,
  resolvePersistentSessionDir,
  resolveStableSessionTitle,
  restoreQueuedMessage,
  subscribe,
  takeOverSessionControl,
  toSse,
  type SseEvent,
} from './liveSessions.js';
import { clearSessionCaches } from './sessions.js';

const tempDirs: string[] = [];
type LiveRegistryEntry = Parameters<typeof registry.set>[1];
type AgentSessionEvent = Parameters<typeof toSse>[0];
type PersistedSessionManager = Parameters<typeof ensureSessionFileExists>[0];

function setLiveEntry(
  sessionId: string,
  entry: Omit<Partial<LiveRegistryEntry>, 'session'> & { session: unknown },
) {
  registry.set(sessionId, {
    sessionId,
    cwd: entry.cwd ?? '',
    listeners: entry.listeners ?? new Set(),
    title: entry.title ?? '',
    autoTitleRequested: entry.autoTitleRequested ?? false,
    lastContextUsageJson: entry.lastContextUsageJson ?? null,
    lastQueueStateJson: entry.lastQueueStateJson ?? null,
    pendingHiddenTurnCustomTypes: entry.pendingHiddenTurnCustomTypes ?? [],
    activeHiddenTurnCustomType: entry.activeHiddenTurnCustomType ?? null,
    pendingAutoCompactionReason: entry.pendingAutoCompactionReason ?? null,
    lastCompactionSummaryTitle: entry.lastCompactionSummaryTitle ?? null,
    ...(entry.lastDurableRunState ? { lastDurableRunState: entry.lastDurableRunState } : {}),
    ...(entry.contextUsageTimer ? { contextUsageTimer: entry.contextUsageTimer } : {}),
    session: entry.session as LiveRegistryEntry['session'],
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

    await expect(requestConversationWorkingDirectoryChange({
      conversationId: 'session-same-cwd',
      cwd: '/tmp/workspace',
    })).resolves.toEqual({
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

    await expect(requestConversationWorkingDirectoryChange({
      conversationId: 'session-next-cwd',
      cwd: '/tmp/workspace-b',
      continuePrompt: 'Continue in the other repo.',
    })).resolves.toEqual({
      conversationId: 'session-next-cwd',
      cwd: '/tmp/workspace-b',
      queued: true,
    });
  });
});

describe('canInjectResumeFallbackPrompt', () => {
  it('returns true for an idle session with no queued work', () => {
    setLiveEntry('session-idle-resume-fallback', {
      sessionId: 'session-idle-resume-fallback',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Idle resume fallback',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        isStreaming: false,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
      },
    });

    expect(canInjectResumeFallbackPrompt('session-idle-resume-fallback')).toBe(true);
  });

  it('returns false while the session is streaming', () => {
    setLiveEntry('session-streaming-resume-fallback', {
      sessionId: 'session-streaming-resume-fallback',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Streaming resume fallback',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        isStreaming: true,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
      },
    });

    expect(canInjectResumeFallbackPrompt('session-streaming-resume-fallback')).toBe(false);
  });

  it('returns false when a hidden turn is pending', () => {
    setLiveEntry('session-hidden-resume-fallback', {
      sessionId: 'session-hidden-resume-fallback',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Hidden resume fallback',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      pendingHiddenTurnCustomTypes: ['conversation_automation_post_turn_review'],
      session: {
        isStreaming: false,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
      },
    });

    expect(canInjectResumeFallbackPrompt('session-hidden-resume-fallback')).toBe(false);
  });

  it('returns false when follow-up work is already queued', () => {
    setLiveEntry('session-queued-resume-fallback', {
      sessionId: 'session-queued-resume-fallback',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Queued resume fallback',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        isStreaming: false,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => ['already queued'],
      },
    });

    expect(canInjectResumeFallbackPrompt('session-queued-resume-fallback')).toBe(false);
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

  it('ignores placeholder persisted titles until a real title exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-title.jsonl');

    writeFileSync(sessionFile, `${JSON.stringify({
      type: 'session',
      id: 'session-title',
      timestamp: '2026-03-18T00:00:00.000Z',
      cwd: '/tmp/workspace',
    })}\n`);

    expect(resolveStableSessionTitle({
      sessionFile,
      state: {
        messages: [],
      },
    } as unknown as LiveRegistryEntry['session'])).toBe('');

    expect(resolveStableSessionTitle({
      sessionFile,
      state: {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Use the first prompt while the agent is running.' }],
          },
        ],
      },
    } as unknown as LiveRegistryEntry['session'])).toBe('Use the first prompt while the agent is running.');
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
    expect(events[4]).toEqual({ type: 'agent_start' });
  });

  it('does not replay agent_start while a hidden turn is active', () => {
    const events: SseEvent[] = [];

    setLiveEntry('session-hidden-streaming', {
      sessionId: 'session-hidden-streaming',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Hidden streaming',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      activeHiddenTurnCustomType: 'conversation_automation_post_turn_review',
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

    subscribe('session-control', (event) => {
      desktopEvents.push(event);
    }, {
      surface: {
        surfaceId: 'desktop-1',
        surfaceType: 'desktop_web',
      },
    });

    expect(desktopEvents.at(-1)).toEqual({
      type: 'presence_state',
      state: {
        surfaces: [{
          surfaceId: 'desktop-1',
          surfaceType: 'desktop_web',
          connectedAt: expect.any(String),
        }],
        controllerSurfaceId: 'desktop-1',
        controllerSurfaceType: 'desktop_web',
        controllerAcquiredAt: expect.any(String),
      },
    });

    subscribe('session-control', (event) => {
      mobileEvents.push(event);
    }, {
      surface: {
        surfaceId: 'mobile-1',
        surfaceType: 'mobile_web',
      },
    });

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
    subscribe('session-same-surface-control', (event) => {
      secondDesktopEvents.push(event);
    }, {
      surface: {
        surfaceId: 'desktop-2',
        surfaceType: 'desktop_web',
      },
    });

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
    writeFileSync(sessionFile, [
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
    ].join('\n'));

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
    writeFileSync(sessionFile, [
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
    ].join('\n'));

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
    const toolABlocks = blocks.filter((block): block is Extract<(typeof blocks)[number], { type: 'tool_use' }> => (
      block.type === 'tool_use' && block.toolCallId === 'tool-a'
    ));
    expect(toolABlocks).toHaveLength(1);
    expect(toolABlocks[0]?.ts).toBe('2026-03-13T18:00:03.100Z');

    expect(blocks.filter((block) => block.type === 'summary')).toHaveLength(1);
    expect(blocks.filter((block): block is Extract<(typeof blocks)[number], { type: 'thinking' }> => (
      block.type === 'thinking' && block.text === 'Live-only planning'
    ))).toHaveLength(1);
    expect(blocks).toHaveLength(11);
  });

  it('ignores replayed live context before the matched suffix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-replayed-context.jsonl');
    writeFileSync(sessionFile, [
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
    ].join('\n'));

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
    expect(blocks.filter((block): block is Extract<(typeof blocks)[number], { type: 'tool_use' }> => (
      block.type === 'tool_use' && block.toolCallId === 'tool-b' && block.output === 'second output'
    ))).toHaveLength(1);
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

  it('uses the persisted transcript for idle live sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-idle.jsonl');
    writeFileSync(sessionFile, [
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
    ].join('\n'));

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
        isStreaming: false,
        hasPendingHiddenTurn: false,
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

    expect(getLiveSessions()[0]).toEqual(expect.objectContaining({
      id: 'session-3',
      title: 'Generated title',
    }));

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

    expect(getLiveSessions()[0]).toEqual(expect.objectContaining({
      id: 'session-sticky',
      title: 'Original conversation title',
    }));

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
    expect(getLiveSessions()[0]).toEqual(expect.objectContaining({
      id: 'session-rename',
      title: 'Better generated title',
    }));
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
            messages: [{
              role: 'user',
              content: [{ type: 'image', data: 'b64-image', mimeType: 'image/png' }],
            }],
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

  it('restores a queued prompt back to the composer payload without disturbing other queued items', async () => {
    const steeringMessages = ['first queued prompt', 'second queued prompt'];
    const steeringQueue = {
      messages: [
        { role: 'custom', content: 'hidden steer context' },
        {
          role: 'user',
          content: [{ type: 'text', text: 'first queued prompt' }],
        },
        { role: 'custom', content: 'more hidden steer context' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'second queued prompt' },
            { type: 'image', data: 'b64-image', mimeType: 'image/png' },
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
      images: [{ type: 'image', data: 'b64-image', mimeType: 'image/png' }],
    });
    expect(steeringMessages).toEqual(['first queued prompt']);
    expect(steeringQueue).toEqual({
      messages: [
        { role: 'custom', content: 'hidden steer context' },
        {
          role: 'user',
          content: [{ type: 'text', text: 'first queued prompt' }],
        },
        { role: 'custom', content: 'more hidden steer context' },
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
});

describe('queuePromptContext', () => {
  it('appends hidden context immediately when the session is idle so the user prompt stays latest', async () => {
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

  it('queues hidden context for the next turn while the session is streaming', async () => {
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

    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'referenced_context',
      content: 'Conversation automation context',
      display: false,
      details: undefined,
    }, {
      deliverAs: 'nextTurn',
    });
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
            listener(asAgentSessionEvent({
              type: 'message_start',
              message: {
                role: 'user',
                content: [{ type: 'text', text: 'hello there' }],
                timestamp: 1,
              },
            }));
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

    const submitted = await submitPromptSession(
      'session-submit-detached-surface',
      'send this anyway',
      undefined,
      undefined,
      'desktop-1',
    );

    expect(submitted.acceptedAs).toBe('started');
    await submitted.completion;
    expect(prompt).toHaveBeenCalledWith('send this anyway');
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

  it('queues follow-up prompts while a hidden turn is pending even before streaming starts', async () => {
    const prompt = vi.fn(async () => undefined);
    const steer = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);

    setLiveEntry('session-hidden-pending-followup', {
      sessionId: 'session-hidden-pending-followup',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Hidden pending follow-up',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      pendingHiddenTurnCustomTypes: ['conversation_automation_post_turn_review'],
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

    expect(prompt).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
    expect(followUp).toHaveBeenCalledWith('my missing message');
  });
});

describe('event translation', () => {
  it('surfaces user messages from message_start events immediately', () => {
    expect(toSse(asAgentSessionEvent({
      type: 'message_start',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Show this prompt right away.' }],
        timestamp: 1,
      },
    }))).toEqual({
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
    expect(toSse(asAgentSessionEvent({
      type: 'message_end',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Show this prompt right away.' }],
        timestamp: 1,
      },
    }))).toBeNull();
  });

  it('surfaces assistant error messages from message_end events', () => {
    expect(toSse(asAgentSessionEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Codex error: upstream overloaded',
        timestamp: 1,
      },
    }))).toEqual({
      type: 'error',
      message: 'Codex error: upstream overloaded',
    });
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
