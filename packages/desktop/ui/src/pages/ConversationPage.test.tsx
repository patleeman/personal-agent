import { parseFragment } from 'parse5';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppDataContext } from '../app/contexts.js';
import { constrainPromptImageDimensions } from '../conversation/promptAttachments.js';
import {
  buildMissionAutoModeInputFromDraft,
  ConversationPage,
  createDraftMissionTask,
  hasConversationTranscriptAcceptedPendingInitialPrompt,
  replaceConversationMetaInSessionList,
  resolveConversationCwdChangeAction,
  resolveConversationPerformanceMode,
  resolveDisplayedConversationPendingStatusLabel,
  shouldAutoDispatchPendingInitialPrompt,
  shouldDeferConversationFileRefresh,
  shouldEnableMessageForkControls,
  shouldFetchConversationAttachments,
  shouldFetchConversationLiveSessionGitContext,
  shouldLoadConversationModels,
  shouldShowMissingConversationState,
  shouldUseHealthyDesktopConversationState,
} from './ConversationPage.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

type ParsedNode = {
  nodeName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
  parentNode?: ParsedNode | null;
};

function getNodeClassList(node: ParsedNode): string[] {
  const value = node.attrs?.find((attr) => attr.name === 'class')?.value ?? '';
  return value.split(/\s+/).filter(Boolean);
}

function findFirstNodeByClass(node: ParsedNode, className: string): ParsedNode | null {
  if (getNodeClassList(node).includes(className)) {
    return node;
  }

  for (const child of node.childNodes ?? []) {
    const match = findFirstNodeByClass(child, className);
    if (match) {
      return match;
    }
  }

  return null;
}

describe('desktop conversation state fallback', () => {
  it('reconnects the current transcript when a cwd change keeps the same conversation id', () => {
    expect(
      resolveConversationCwdChangeAction({
        conversationId: 'conv-1',
        cwdChange: { newConversationId: 'conv-1', cwd: '/tmp/next', autoContinued: true },
        handledKey: null,
      }),
    ).toEqual({ action: 'reconnect', key: 'conv-1\n/tmp/next\n1' });
  });

  it('navigates when a cwd change moves to a different conversation id', () => {
    expect(
      resolveConversationCwdChangeAction({
        conversationId: 'conv-1',
        cwdChange: { newConversationId: 'conv-2', cwd: '/tmp/next', autoContinued: false },
        handledKey: null,
      }),
    ).toEqual({ action: 'navigate', key: 'conv-2\n/tmp/next\n0', conversationId: 'conv-2' });
  });

  it('does not handle the same cwd change twice', () => {
    expect(
      resolveConversationCwdChangeAction({
        conversationId: 'conv-1',
        cwdChange: { newConversationId: 'conv-1', cwd: '/tmp/next', autoContinued: true },
        handledKey: 'conv-1\n/tmp/next\n1',
      }),
    ).toEqual({ action: 'none', key: null });
  });

  it('creates pending user mission tasks with stable user-owned ids', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1778171332502);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    try {
      const task = createDraftMissionTask('Inspect persistence');

      expect(task).toEqual({
        id: 'user-1778171332502-i',
        description: 'Inspect persistence',
        status: 'pending',
      });
    } finally {
      nowSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });

  it('preserves mission tasks when syncing mission draft changes', () => {
    const input = buildMissionAutoModeInputFromDraft(
      { goal: 'Ship mission mode' },
      {
        enabled: true,
        mode: 'mission',
        stopReason: null,
        updatedAt: '2026-05-07T00:00:00.000Z',
        mission: {
          goal: 'Old goal',
          tasks: [
            { id: 't1', description: 'Create task list', status: 'done' },
            { id: 't2', description: 'Persist task list', status: 'pending' },
          ],
        },
      },
    );

    expect(input.mission.goal).toBe('Ship mission mode');
    expect(input.mission.tasks).toEqual([
      { id: 't1', description: 'Create task list', status: 'done' },
      { id: 't2', description: 'Persist task list', status: 'pending' },
    ]);
  });

  it('syncs active conversation meta back into the session list', () => {
    const sessions = [
      {
        id: 'conv-123',
        file: '/tmp/conv-123.jsonl',
        timestamp: '2026-01-01T00:00:00.000Z',
        cwd: '/repo',
        cwdSlug: '-repo',
        model: 'model-a',
        title: 'Old title',
        messageCount: 4,
        isRunning: false,
        needsAttention: true,
      },
    ];

    const next = replaceConversationMetaInSessionList(sessions, 'conv-123', {
      ...sessions[0]!,
      title: 'Fresh title',
      messageCount: 5,
      isRunning: true,
    });

    expect(next).not.toBe(sessions);
    expect(next?.[0]).toMatchObject({
      title: 'Fresh title',
      messageCount: 5,
      isRunning: true,
      needsAttention: true,
    });
  });

  it('does not rewrite sessions when active conversation meta is unchanged', () => {
    const sessions = [
      {
        id: 'conv-123',
        file: '/tmp/conv-123.jsonl',
        timestamp: '2026-01-01T00:00:00.000Z',
        cwd: '/repo',
        cwdSlug: '-repo',
        model: 'model-a',
        title: 'Stable title',
        messageCount: 4,
        isRunning: true,
        needsAttention: true,
      },
    ];

    expect(replaceConversationMetaInSessionList(sessions, 'conv-123', sessions[0]!)).toBe(sessions);
  });

  it('keeps message fork controls available for saved conversations while they stream', () => {
    expect(shouldEnableMessageForkControls({ renderingStaleTranscript: false, conversationId: 'conv-123' })).toBe(true);
  });

  it('hides message fork controls for stale transcripts and drafts', () => {
    expect(shouldEnableMessageForkControls({ renderingStaleTranscript: true, conversationId: 'conv-123' })).toBe(false);
    expect(shouldEnableMessageForkControls({ renderingStaleTranscript: false, conversationId: undefined })).toBe(false);
  });

  it('uses the dedicated desktop state only while the local subscription is healthy', () => {
    expect(
      shouldUseHealthyDesktopConversationState({
        draft: false,
        conversationId: 'conv-123',
        desktopMode: 'local',
        desktopError: null,
      }),
    ).toBe(true);

    expect(
      shouldUseHealthyDesktopConversationState({
        draft: false,
        conversationId: 'conv-123',
        desktopMode: 'local',
        desktopError: 'Conversation state subscription failed.',
      }),
    ).toBe(false);

    expect(
      shouldUseHealthyDesktopConversationState({
        draft: false,
        conversationId: 'conv-123',
        desktopMode: 'checking',
        desktopError: null,
      }),
    ).toBe(false);

    expect(
      shouldUseHealthyDesktopConversationState({
        draft: true,
        conversationId: 'conv-123',
        desktopMode: 'local',
        desktopError: null,
      }),
    ).toBe(false);
  });
});

describe('conversation attachment fetch gating', () => {
  it('only loads saved conversation attachments when the drawings picker is actually open', () => {
    expect(
      shouldFetchConversationAttachments({
        draft: true,
        conversationId: 'conv-123',
        drawingsPickerOpen: true,
      }),
    ).toBe(false);

    expect(
      shouldFetchConversationAttachments({
        draft: false,
        conversationId: null,
        drawingsPickerOpen: true,
      }),
    ).toBe(false);

    expect(
      shouldFetchConversationAttachments({
        draft: false,
        conversationId: 'conv-123',
        drawingsPickerOpen: false,
      }),
    ).toBe(false);

    expect(
      shouldFetchConversationAttachments({
        draft: false,
        conversationId: 'conv-123',
        drawingsPickerOpen: true,
      }),
    ).toBe(true);
  });
});

describe('prompt image resizing', () => {
  it('keeps images that already fit the provider limit unchanged', () => {
    expect(constrainPromptImageDimensions(1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  it('shrinks oversized landscape images to a 2000px long side', () => {
    expect(constrainPromptImageDimensions(4000, 1000)).toEqual({ width: 2000, height: 500 });
  });

  it('shrinks oversized portrait images to a 2000px long side', () => {
    expect(constrainPromptImageDimensions(1200, 3600)).toEqual({ width: 667, height: 2000 });
  });
});

describe('conversation rendering mode', () => {
  it('switches to aggressive rendering for large transcripts', () => {
    expect(resolveConversationPerformanceMode({ messageCount: 95 })).toBe('default');
    expect(resolveConversationPerformanceMode({ messageCount: 96 })).toBe('aggressive');
    expect(resolveConversationPerformanceMode({ messageCount: 240 })).toBe('aggressive');
  });
});

describe('conversation model loading', () => {
  it('keeps draft model data hot even before a session exists', () => {
    expect(
      shouldLoadConversationModels({
        draft: true,
        hasPendingInitialPrompt: false,
        hasPendingInitialPromptInFlight: false,
      }),
    ).toBe(true);
  });

  it('defers model reads while the initial prompt is still pending or in flight', () => {
    expect(
      shouldLoadConversationModels({
        draft: false,
        hasPendingInitialPrompt: true,
        hasPendingInitialPromptInFlight: false,
      }),
    ).toBe(false);

    expect(
      shouldLoadConversationModels({
        draft: false,
        hasPendingInitialPrompt: false,
        hasPendingInitialPromptInFlight: true,
      }),
    ).toBe(false);
  });

  it('loads model data once the initial prompt work is clear', () => {
    expect(
      shouldLoadConversationModels({
        draft: false,
        hasPendingInitialPrompt: false,
        hasPendingInitialPromptInFlight: false,
      }),
    ).toBe(true);
  });
});

describe('conversation file refresh deferral', () => {
  it('defers file-backed refreshes while the initial prompt is still pending or in flight', () => {
    expect(
      shouldDeferConversationFileRefresh({
        draft: false,
        conversationId: 'conv-123',
        hasPendingInitialPrompt: true,
        pendingInitialPromptDispatching: false,
        hasPendingInitialPromptInFlight: false,
      }),
    ).toBe(true);

    expect(
      shouldDeferConversationFileRefresh({
        draft: false,
        conversationId: 'conv-123',
        hasPendingInitialPrompt: false,
        pendingInitialPromptDispatching: true,
        hasPendingInitialPromptInFlight: false,
      }),
    ).toBe(true);

    expect(
      shouldDeferConversationFileRefresh({
        draft: false,
        conversationId: 'conv-123',
        hasPendingInitialPrompt: false,
        pendingInitialPromptDispatching: false,
        hasPendingInitialPromptInFlight: true,
      }),
    ).toBe(true);
  });

  it('keeps normal file refreshes enabled once the carried prompt work is clear', () => {
    expect(
      shouldDeferConversationFileRefresh({
        draft: false,
        conversationId: 'conv-123',
        hasPendingInitialPrompt: false,
        pendingInitialPromptDispatching: false,
        hasPendingInitialPromptInFlight: false,
      }),
    ).toBe(false);
  });
});

describe('conversation live-session git context loading', () => {
  it('defers git-context reads while the initial prompt is still pending or in flight', () => {
    expect(
      shouldFetchConversationLiveSessionGitContext({
        draft: false,
        conversationId: 'conv-123',
        conversationLiveDecision: true,
        conversationBootstrapLoading: false,
        sessionLoading: false,
        isStreaming: false,
        hasPendingInitialPrompt: true,
        pendingInitialPromptDispatching: false,
        hasPendingInitialPromptInFlight: false,
      }),
    ).toBe(false);

    expect(
      shouldFetchConversationLiveSessionGitContext({
        draft: false,
        conversationId: 'conv-123',
        conversationLiveDecision: true,
        conversationBootstrapLoading: false,
        sessionLoading: false,
        isStreaming: false,
        hasPendingInitialPrompt: false,
        pendingInitialPromptDispatching: true,
        hasPendingInitialPromptInFlight: false,
      }),
    ).toBe(false);

    expect(
      shouldFetchConversationLiveSessionGitContext({
        draft: false,
        conversationId: 'conv-123',
        conversationLiveDecision: true,
        conversationBootstrapLoading: false,
        sessionLoading: false,
        isStreaming: false,
        hasPendingInitialPrompt: false,
        pendingInitialPromptDispatching: false,
        hasPendingInitialPromptInFlight: true,
      }),
    ).toBe(false);
  });

  it('loads git context once the conversation is live and the initial prompt work is clear', () => {
    expect(
      shouldFetchConversationLiveSessionGitContext({
        draft: false,
        conversationId: 'conv-123',
        conversationLiveDecision: true,
        conversationBootstrapLoading: false,
        sessionLoading: false,
        isStreaming: false,
        hasPendingInitialPrompt: false,
        pendingInitialPromptDispatching: false,
        hasPendingInitialPromptInFlight: false,
      }),
    ).toBe(true);
  });
});

describe('conversation live state helpers', () => {
  it('does not show the missing state until session discovery has loaded', () => {
    expect(
      shouldShowMissingConversationState({
        draft: false,
        conversationId: 'conv-123',
        sessionsLoaded: false,
        confirmedLive: false,
        sessionLoading: false,
        hasVisibleSessionDetail: false,
        hasSavedConversationSessionFile: false,
        hasPendingInitialPrompt: false,
      }),
    ).toBe(false);

    expect(
      shouldShowMissingConversationState({
        draft: false,
        conversationId: 'conv-123',
        sessionsLoaded: true,
        confirmedLive: false,
        sessionLoading: false,
        hasVisibleSessionDetail: false,
        hasSavedConversationSessionFile: false,
        hasPendingInitialPrompt: false,
      }),
    ).toBe(true);
  });

  it('waits to auto-dispatch a pending initial prompt until no background start is in flight', () => {
    expect(
      shouldAutoDispatchPendingInitialPrompt({
        draft: false,
        conversationId: 'conv-123',
        hasPendingInitialPrompt: true,
        pendingInitialPromptDispatching: false,
        hasStreamSnapshot: true,
        hasTranscriptMessages: false,
      }),
    ).toBe(true);

    expect(
      shouldAutoDispatchPendingInitialPrompt({
        draft: false,
        conversationId: 'conv-123',
        hasPendingInitialPrompt: true,
        pendingInitialPromptDispatching: true,
        hasStreamSnapshot: true,
        hasTranscriptMessages: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoDispatchPendingInitialPrompt({
        draft: false,
        conversationId: 'conv-123',
        hasPendingInitialPrompt: true,
        pendingInitialPromptDispatching: false,
        hasStreamSnapshot: false,
        hasTranscriptMessages: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoDispatchPendingInitialPrompt({
        draft: false,
        conversationId: 'conv-123',
        hasPendingInitialPrompt: true,
        pendingInitialPromptDispatching: false,
        hasStreamSnapshot: true,
        hasTranscriptMessages: true,
      }),
    ).toBe(false);
  });

  it('keeps a detached-start prompt visible until the accepted user turn shows up in the transcript', () => {
    expect(
      hasConversationTranscriptAcceptedPendingInitialPrompt({
        messages: undefined,
        prompt: {
          text: 'Kick this off',
          images: [],
          attachmentRefs: [],
        },
      }),
    ).toBe(false);

    expect(
      hasConversationTranscriptAcceptedPendingInitialPrompt({
        messages: [
          {
            type: 'text',
            ts: '2026-04-11T12:00:00.000Z',
            text: 'Working…',
          },
        ],
        prompt: {
          text: 'Kick this off',
          images: [],
          attachmentRefs: [],
        },
      }),
    ).toBe(false);

    expect(
      hasConversationTranscriptAcceptedPendingInitialPrompt({
        messages: [
          {
            type: 'user',
            ts: '2026-04-11T12:00:01.000Z',
            text: 'Kick this off',
          },
        ],
        prompt: {
          text: 'Kick this off',
          images: [],
          attachmentRefs: [],
        },
      }),
    ).toBe(true);
  });

  it('matches image-only detached-start prompts by user image count', () => {
    expect(
      hasConversationTranscriptAcceptedPendingInitialPrompt({
        messages: [
          {
            type: 'user',
            ts: '2026-04-11T12:00:01.000Z',
            text: '',
            images: [{ alt: 'Attached image' }],
          },
        ],
        prompt: {
          text: '',
          images: [
            {
              data: 'abc',
              mimeType: 'image/png',
            },
          ],
          attachmentRefs: [],
        },
      }),
    ).toBe(true);

    expect(
      hasConversationTranscriptAcceptedPendingInitialPrompt({
        messages: [
          {
            type: 'user',
            ts: '2026-04-11T12:00:01.000Z',
            text: '',
          },
        ],
        prompt: {
          text: '',
          images: [
            {
              data: 'abc',
              mimeType: 'image/png',
            },
          ],
          attachmentRefs: [],
        },
      }),
    ).toBe(false);
  });

  it('keeps showing a pending status while a draft or initial prompt is still staging', () => {
    expect(
      resolveDisplayedConversationPendingStatusLabel({
        explicitLabel: null,
        draft: true,
        hasDraftPendingPrompt: true,
        pendingPrompt: null,
        isStreaming: false,
        hasPendingInitialPrompt: false,
        hasPendingInitialPromptInFlight: false,
        isLiveSession: false,
        hasVisibleSessionDetail: false,
      }),
    ).toBe('Sending…');

    expect(
      resolveDisplayedConversationPendingStatusLabel({
        explicitLabel: null,
        draft: false,
        hasDraftPendingPrompt: false,
        pendingPrompt: {
          text: 'Use the selected threads',
          images: [],
          attachmentRefs: [],
          relatedConversationIds: ['conv-1', 'conv-2'],
        },
        isStreaming: false,
        hasPendingInitialPrompt: true,
        hasPendingInitialPromptInFlight: false,
        isLiveSession: true,
        hasVisibleSessionDetail: false,
      }),
    ).toBe('Summarizing 2 related threads…');

    expect(
      resolveDisplayedConversationPendingStatusLabel({
        explicitLabel: null,
        draft: false,
        hasDraftPendingPrompt: false,
        pendingPrompt: null,
        isStreaming: false,
        hasPendingInitialPrompt: false,
        hasPendingInitialPromptInFlight: true,
        isLiveSession: true,
        hasVisibleSessionDetail: false,
      }),
    ).toBe('Working…');

    expect(
      resolveDisplayedConversationPendingStatusLabel({
        explicitLabel: 'Resuming…',
        draft: false,
        hasDraftPendingPrompt: false,
        pendingPrompt: null,
        isStreaming: false,
        hasPendingInitialPrompt: false,
        hasPendingInitialPromptInFlight: false,
        isLiveSession: false,
        hasVisibleSessionDetail: true,
      }),
    ).toBe('Resuming…');

    expect(
      resolveDisplayedConversationPendingStatusLabel({
        explicitLabel: null,
        draft: false,
        hasDraftPendingPrompt: false,
        pendingPrompt: {
          text: 'Use the selected threads',
          images: [],
          attachmentRefs: [],
          relatedConversationIds: ['conv-1'],
        },
        isStreaming: true,
        hasPendingInitialPrompt: true,
        hasPendingInitialPromptInFlight: true,
        isLiveSession: true,
        hasVisibleSessionDetail: false,
      }),
    ).toBeNull();
  });
});

// ── ConversationPage E2E stream label integration ─────────────────────────────
// Proof that the submit button label correctly reflects stream.isStreaming.

describe('ConversationPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders without reading tree state before initialization', () => {
    expect(() =>
      renderToString(
        <MemoryRouter initialEntries={['/conversations/test-session']}>
          <Routes>
            <Route path="/conversations/:id" element={<ConversationPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    ).not.toThrow();
  });

  it('renders safely before the route param is available', () => {
    expect(() =>
      renderToString(
        <MemoryRouter>
          <ConversationPage />
        </MemoryRouter>,
      ),
    ).not.toThrow();
  });

  it('shows the auto mode toggle on the new conversation page and moves workspace selection into the empty state', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/new']}>
        <ConversationPage draft />
      </MemoryRouter>,
    );

    expect(html).not.toContain('aria-label="Conversation context"');
    expect(html).not.toContain('Show right sidebar');
    expect(html).toContain('Saved workspace');
    expect(html).toContain('Choose workspace folder');
    expect(html).toContain('max-w-[38rem] text-left');
    expect(html).not.toContain('max-w-[72rem] text-left');
    expect(html).not.toContain('Browse…');
    expect(html).not.toContain('Start typing to create a conversation.');
    expect(html).not.toContain('Edit path');
    expect(html).not.toContain('set working directory');
    expect(html).not.toContain('Choose the initial working directory for this draft conversation');
    expect(html).toContain('Goal');
    expect(html).not.toContain('>draft<');
    expect(html).not.toContain('right rail');
  });

  it('omits the composer context row for a bare draft conversation', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/new']}>
        <ConversationPage draft />
      </MemoryRouter>,
    );

    const tree = parseFragment(html) as ParsedNode;
    const inputShell = findFirstNodeByClass(tree, 'ui-input-shell');
    const composerMeta = findFirstNodeByClass(tree, 'conversation-composer-meta');

    expect(inputShell).toBeTruthy();
    expect(composerMeta).toBeNull();
  });

  it('keeps the saved conversation composer constrained to the main content column without the old header fork button', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/test-session']}>
        <Routes>
          <Route path="/conversations/:id" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('mx-auto w-full max-w-6xl');
    expect(html).not.toContain('aria-label="Summarize and fork this conversation"');
    expect(html).not.toContain('summarize + fork');
    expect(html).not.toContain('Show right sidebar');
  });

  it('does not render the conversation right rail even when a run is selected', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/test-session?run=run-ui-preview-check-1']}>
        <Routes>
          <Route path="/conversations/:id" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).not.toContain('aria-label="Conversation context"');
    expect(html).not.toContain('Show right sidebar');
    expect(html).not.toContain('Hide right sidebar');
  });

  it('shows active background runs above the composer even without other shelf content', () => {
    const runId = 'run-ui-preview-check-2026-04-26T00-00-01-000Z-feedface';
    const html = renderToString(
      <AppDataContext.Provider
        value={{
          projects: null,
          sessions: null,
          tasks: null,
          runs: {
            scannedAt: '2026-04-26T00:00:02.000Z',
            runsRoot: '/tmp/runs',
            summary: { total: 1, recoveryActions: {}, statuses: { running: 1 } },
            runs: [
              {
                runId,
                paths: {
                  root: `/tmp/runs/${runId}`,
                  manifestPath: `/tmp/runs/${runId}/manifest.json`,
                  statusPath: `/tmp/runs/${runId}/status.json`,
                  checkpointPath: `/tmp/runs/${runId}/checkpoint.json`,
                  eventsPath: `/tmp/runs/${runId}/events.jsonl`,
                  outputLogPath: `/tmp/runs/${runId}/output.log`,
                  resultPath: `/tmp/runs/${runId}/result.json`,
                },
                manifest: {
                  version: 1,
                  id: runId,
                  kind: 'background-run',
                  resumePolicy: 'continue',
                  createdAt: '2026-04-26T00:00:01.000Z',
                  spec: { metadata: { taskSlug: 'ui-preview-check' } },
                  source: { type: 'tool', id: 'test-session' },
                },
                status: {
                  version: 1,
                  runId,
                  status: 'running',
                  createdAt: '2026-04-26T00:00:01.000Z',
                  updatedAt: '2026-04-26T00:00:02.000Z',
                  activeAttempt: 1,
                  startedAt: '2026-04-26T00:00:01.000Z',
                },
                problems: [],
                recoveryAction: 'none',
              },
            ],
          },
          setProjects: () => {},
          setSessions: () => {},
          setTasks: () => {},
          setRuns: () => {},
        }}
      >
        <MemoryRouter initialEntries={['/conversations/test-session']}>
          <Routes>
            <Route path="/conversations/:id" element={<ConversationPage />} />
          </Routes>
        </MemoryRouter>
      </AppDataContext.Provider>,
    );

    expect(html).toContain('Background Work');
    expect(html).toContain('running · ui-preview-check');
  });

  it('blocks parallel submit while conversation is idle', () => {
    // Renders ConversationPage and verifies the parallel flow checks
    // stream.isStreaming before allowing parallel prompts.
    // The SSE-based stream is no longer available — the desktop bridge
    // is the only path, so the fallback INITIAL_STREAM_STATE has
    // isStreaming: false.

    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/test-session']}>
        <Routes>
          <Route path="/conversations/:id" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Idle conversation should render disabled send, not parallel
    expect(html).toContain('aria-label="Send"');
    expect(html).not.toContain('Parallel (Ctrl');
  });
});
