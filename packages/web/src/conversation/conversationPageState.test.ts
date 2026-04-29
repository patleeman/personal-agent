import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../shared/types';
import {
  buildConversationBackgroundRunIndicatorText,
  buildConversationSessionSummaryNotice,
  findLastCopyableAgentText,
  hasConversationLoadedHistoricalTailBlocks,
  mergeConversationSessionMeta,
  replaceConversationMetaInSessionList,
  resolveConversationBackgroundRunState,
  resolveConversationLiveSession,
  resolveConversationPerformanceMode,
  resolveConversationVisibleScrollBinding,
  resolveConversationStreamTitleSync,
  resolveDisplayedConversationPendingStatusLabel,
  shouldDeferConversationFileRefresh,
  shouldEnableConversationLiveStream,
  shouldFetchConversationAttachments,
  shouldFetchConversationLiveSessionGitContext,
  shouldLoadConversationModels,
  shouldRenderConversationRail,
  shouldShowConversationBootstrapLoadingState,
  shouldShowConversationInitialHistoricalWarmupLoader,
  shouldShowMissingConversationState,
  shouldSubscribeToDesktopConversationState,
  shouldUseHealthyDesktopConversationState,
} from './conversationPageState';

describe('conversation page state helpers', () => {
  it('resolves pending status labels without leaking streaming placeholders', () => {
    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: true,
      hasDraftPendingPrompt: true,
      pendingPrompt: null,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: false,
      hasVisibleSessionDetail: false,
    })).toBe('Sending…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: false,
      hasDraftPendingPrompt: false,
      pendingPrompt: { text: 'hi', relatedConversationIds: ['a', 'b'] },
      isStreaming: false,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: true,
      hasVisibleSessionDetail: false,
    })).toBe('Summarizing 2 related threads…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: false,
      hasDraftPendingPrompt: false,
      pendingPrompt: null,
      isStreaming: true,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: true,
      hasVisibleSessionDetail: false,
    })).toBeNull();
  });

  it('finds the latest copyable assistant text or summary block', () => {
    expect(findLastCopyableAgentText(undefined)).toBeNull();
    expect(findLastCopyableAgentText([
      { type: 'user', ts: '2026-01-01T00:00:00.000Z', text: 'prompt' },
      { type: 'text', ts: '2026-01-01T00:00:01.000Z', text: '  ' },
      { type: 'summary', ts: '2026-01-01T00:00:02.000Z', kind: 'branch', title: 'Summary', text: 'summary text' },
      { type: 'tool_use', ts: '2026-01-01T00:00:03.000Z', tool: 'bash', input: {}, output: 'ignored' },
    ])).toBe('summary text');
    expect(findLastCopyableAgentText([
      { type: 'summary', ts: '2026-01-01T00:00:00.000Z', kind: 'branch', title: 'Summary', text: 'summary text' },
      { type: 'text', ts: '2026-01-01T00:00:01.000Z', text: 'latest assistant text' },
    ])).toBe('latest assistant text');
  });

  it('gates expensive conversation reads during pending initial prompt work', () => {
    expect(shouldDeferConversationFileRefresh({
      draft: false,
      conversationId: 'conv-1',
      hasPendingInitialPrompt: false,
      pendingInitialPromptDispatching: true,
      hasPendingInitialPromptInFlight: false,
    })).toBe(true);

    expect(shouldFetchConversationLiveSessionGitContext({
      draft: false,
      conversationId: 'conv-1',
      conversationLiveDecision: true,
      conversationBootstrapLoading: false,
      sessionLoading: false,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      pendingInitialPromptDispatching: false,
      hasPendingInitialPromptInFlight: false,
    })).toBe(true);

    expect(shouldLoadConversationModels({
      draft: false,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: false,
    })).toBe(false);
  });

  it('merges active conversation metadata into the session list without rewriting stable rows', () => {
    const sessions: SessionMeta[] = [{
      id: 'conv-1',
      file: '/tmp/conv-1.jsonl',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/repo',
      cwdSlug: '-repo',
      model: 'model-a',
      title: 'Old title',
      messageCount: 4,
      isRunning: false,
      needsAttention: true,
    }];

    const next = replaceConversationMetaInSessionList(sessions, 'conv-1', {
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
    expect(replaceConversationMetaInSessionList(next, 'conv-1', next?.[0])).toBe(next);
  });

  it('merges detail and list metadata while preserving list-only fallback fields', () => {
    const sessionSnapshot: SessionMeta = {
      id: 'conv-1',
      file: '/tmp/conv-1.jsonl',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/repo',
      cwdSlug: '-repo',
      model: 'model-a',
      title: 'List title',
      messageCount: 4,
      isRunning: true,
      needsAttention: true,
      attachedContextDocs: [{ id: 'doc-1', title: 'Design doc', summary: 'System design' }],
    };

    expect(mergeConversationSessionMeta({
      ...sessionSnapshot,
      title: 'Detail title',
      isRunning: undefined,
      needsAttention: undefined,
      attachedContextDocs: undefined,
    }, sessionSnapshot)).toMatchObject({
      title: 'Detail title',
      isRunning: true,
      needsAttention: true,
      attachedContextDocs: [{ id: 'doc-1', title: 'Design doc', summary: 'System design' }],
    });
  });

  it('keeps title synchronization immutable and normalized', () => {
    const sessions = [{ id: 'conv-1', title: 'Old title' }];

    const result = resolveConversationStreamTitleSync({
      draft: false,
      conversationId: 'conv-1',
      streamTitle: '  New title  ',
      liveTitle: 'Old title',
      sessions,
    });

    expect(result.normalizedTitle).toBe('New title');
    expect(result.shouldPushLiveTitle).toBe(true);
    expect(result.nextSessions).toEqual([{ id: 'conv-1', title: 'New title' }]);
    expect(result.nextSessions).not.toBe(sessions);
  });

  it('keeps desktop, attachment, missing-state, and rail decisions explicit', () => {
    expect(shouldUseHealthyDesktopConversationState({
      draft: false,
      conversationId: 'conv-1',
      desktopMode: 'local',
      desktopError: null,
    })).toBe(true);

    expect(shouldFetchConversationAttachments({
      draft: false,
      conversationId: 'conv-1',
      drawingsPickerOpen: true,
    })).toBe(true);

    expect(shouldSubscribeToDesktopConversationState({ draft: false })).toBe(true);
    expect(shouldSubscribeToDesktopConversationState({ draft: true })).toBe(false);
    expect(shouldSubscribeToDesktopConversationState({ draft: false, remoteHostId: 'bender' })).toBe(false);
    expect(shouldSubscribeToDesktopConversationState({ draft: false, remoteConversationId: 'remote-1' })).toBe(false);

    expect(shouldShowMissingConversationState({
      draft: false,
      conversationId: 'conv-1',
      sessionsLoaded: true,
      confirmedLive: false,
      sessionLoading: false,
      hasVisibleSessionDetail: false,
      hasSavedConversationSessionFile: false,
      hasPendingInitialPrompt: false,
    })).toBe(true);

    expect(resolveConversationPerformanceMode({ messageCount: 96 })).toBe('aggressive');
    expect(shouldRenderConversationRail({
      hasRenderableMessages: true,
      realMessages: [{ type: 'text', ts: '2026-01-01T00:00:00.000Z', text: 'hello' }],
      performanceMode: 'default',
    })).toBe(true);
  });

  it('keeps live-stream and transcript loading decisions explicit', () => {
    expect(shouldEnableConversationLiveStream('conv-1', null)).toBe(true);
    expect(shouldEnableConversationLiveStream('conv-1', false)).toBe(false);
    expect(resolveConversationLiveSession({
      streamBlockCount: 0,
      isStreaming: false,
      confirmedLive: true,
    })).toBe(true);

    expect(hasConversationLoadedHistoricalTailBlocks({ blocks: [{ id: 'a' }], totalBlocks: 1 }, 10)).toBe(true);
    expect(hasConversationLoadedHistoricalTailBlocks({ blocks: [{ id: 'a' }], totalBlocks: 1 }, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(shouldShowConversationInitialHistoricalWarmupLoader({
      warmupActive: true,
      targetTailBlocks: 10,
      currentTailBlocks: 5,
      loadedTailBlocks: false,
    })).toBe(true);
    expect(shouldShowConversationInitialHistoricalWarmupLoader({
      warmupActive: true,
      targetTailBlocks: Number.MAX_SAFE_INTEGER + 1,
      currentTailBlocks: 5,
      loadedTailBlocks: false,
    })).toBe(false);
    expect(shouldShowConversationBootstrapLoadingState({
      draft: false,
      conversationId: 'conv-1',
      conversationBootstrapLoading: true,
      hasRenderableMessages: false,
      hasVisibleSessionDetail: false,
    })).toBe(true);
  });

  it('uses stable transcript bindings while a saved conversation is loading', () => {
    const stableMessages = [{ type: 'text' as const, ts: '2026-01-01T00:00:00.000Z', text: 'cached' }];
    expect(resolveConversationVisibleScrollBinding({
      draft: false,
      routeConversationId: 'conv-2',
      realMessages: undefined,
      stableTranscriptState: { conversationId: 'conv-1', messages: stableMessages },
      showConversationLoadingState: true,
      initialScrollKey: 'tail:conv-2',
      isStreaming: true,
    })).toEqual({
      conversationId: 'conv-1',
      messages: stableMessages,
      initialScrollKey: null,
      isStreaming: false,
      usingStableTranscript: true,
    });
  });

  it('formats connected background-run indicators from latest run status', () => {
    expect(buildConversationBackgroundRunIndicatorText([])).toBe('');
    expect(buildConversationBackgroundRunIndicatorText([{
      runId: 'run-1',
      conversationId: 'conv-1',
      manifest: {
        kind: 'background-run',
        spec: { metadata: { taskSlug: 'task-a' } },
      },
      status: { status: 'running' },
    }])).toBe('running · task-a');
    expect(buildConversationBackgroundRunIndicatorText([{
      runId: 'run-shell',
      conversationId: 'conv-1',
      manifest: {
        kind: 'raw-shell',
        spec: {
          target: { type: 'shell', command: 'npm test' },
          metadata: { taskSlug: 'test-run' },
        },
      },
      status: { status: 'running' },
    }])).toBe('running · npm test');
  });

  it('resolves connected active background-run state for a conversation', () => {
    const state = resolveConversationBackgroundRunState({
      conversationId: 'conv-1',
      excludeConversationRunId: 'conversation-live-conv-1',
      runs: {
        scannedAt: '2026-04-01T00:00:00.000Z',
        runsRoot: '/tmp/runs',
        summary: { total: 3, recoveryActions: {}, statuses: {} },
        runs: [
          {
            runId: 'run-active',
            conversationId: 'conv-1',
            manifest: {
              kind: 'background-run',
              source: { type: 'tool', id: 'conv-1' },
              spec: { metadata: { taskSlug: 'arch-pass' } },
              createdAt: '2026-04-01T00:00:00.000Z',
            },
            status: { status: 'running', updatedAt: '2026-04-01T00:01:00.000Z' },
            problems: [],
            recoveryAction: 'none',
          },
          {
            runId: 'run-done',
            conversationId: 'conv-1',
            manifest: {
              kind: 'background-run',
              source: { type: 'tool', id: 'conv-1' },
              spec: { metadata: { taskSlug: 'done-task' } },
              createdAt: '2026-04-01T00:00:00.000Z',
            },
            status: { status: 'completed', completedAt: '2026-04-01T00:02:00.000Z' },
            problems: [],
            recoveryAction: 'none',
          },
          {
            runId: 'conversation-live-conv-1',
            conversationId: 'conv-1',
            manifest: {
              kind: 'background-run',
              source: { type: 'tool', id: 'conv-1' },
              spec: { metadata: { taskSlug: 'live-session' } },
              createdAt: '2026-04-01T00:00:00.000Z',
            },
            status: { status: 'running' },
            problems: [],
            recoveryAction: 'none',
          },
        ],
      },
    });

    expect(state.connectedRuns.map((run) => run.runId)).toEqual(['run-active', 'run-done']);
    expect(state.activeRuns.map((run) => run.runId)).toEqual(['run-active']);
    expect(state.indicatorText).toBe('running · arch-pass');
  });

  it('builds compact session summary notices', () => {
    expect(buildConversationSessionSummaryNotice({
      draft: false,
      title: 'Architecture pass',
      isLiveSession: true,
      currentModel: 'gpt-5.1',
      cwd: '/repo',
      messageCount: 2,
      contextUsage: { total: 27_200, contextWindow: 272_000 },
    })).toBe('Architecture pass · active session · gpt-5.1 · /repo · 2 blocks · 10.0% of 272k ctx');

    expect(buildConversationSessionSummaryNotice({
      draft: true,
      title: 'Ignored title',
      isLiveSession: false,
      fallbackModel: 'default-model',
      draftCwd: '',
      messageCount: 1,
    })).toBe('Draft conversation · default-model · unset cwd · 1 block');

    expect(buildConversationSessionSummaryNotice({
      draft: false,
      title: 'Recovered thread',
      isLiveSession: false,
      currentModel: '   ',
      fallbackModel: 'default-model',
      cwd: '',
      messageCount: 0,
    })).toBe('Recovered thread · default-model · unknown cwd · 0 blocks');
  });
});
