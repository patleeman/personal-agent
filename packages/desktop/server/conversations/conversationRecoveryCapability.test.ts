import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createWebLiveConversationRunIdMock,
  existsSyncMock,
  getDurableRunMock,
  isLiveSessionMock,
  listRecoverableWebLiveConversationRunsMock,
  liveRegistry,
  logErrorMock,
  parsePendingOperationMock,
  promptSessionMock,
  queuePromptContextMock,
  readSessionBlocksMock,
  repairLiveSessionTranscriptTailMock,
  resumeSessionMock,
  syncWebLiveConversationRunMock,
} = vi.hoisted(() => ({
  createWebLiveConversationRunIdMock: vi.fn(),
  existsSyncMock: vi.fn(),
  getDurableRunMock: vi.fn(),
  isLiveSessionMock: vi.fn(),
  listRecoverableWebLiveConversationRunsMock: vi.fn(),
  liveRegistry: new Map<string, unknown>(),
  logErrorMock: vi.fn(),
  parsePendingOperationMock: vi.fn(),
  promptSessionMock: vi.fn(),
  queuePromptContextMock: vi.fn(),
  readSessionBlocksMock: vi.fn(),
  repairLiveSessionTranscriptTailMock: vi.fn(),
  resumeSessionMock: vi.fn(),
  syncWebLiveConversationRunMock: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
  };
});

vi.mock('@personal-agent/daemon', () => ({
  parsePendingOperation: parsePendingOperationMock,
}));

vi.mock('../automation/durableRuns.js', () => ({
  getDurableRun: getDurableRunMock,
}));

vi.mock('./conversationRuns.js', () => ({
  createWebLiveConversationRunId: createWebLiveConversationRunIdMock,
  listRecoverableWebLiveConversationRuns: listRecoverableWebLiveConversationRunsMock,
  syncWebLiveConversationRun: syncWebLiveConversationRunMock,
}));

vi.mock('./liveSessions.js', () => ({
  isLive: isLiveSessionMock,
  promptSession: promptSessionMock,
  queuePromptContext: queuePromptContextMock,
  repairLiveSessionTranscriptTail: repairLiveSessionTranscriptTailMock,
  registry: liveRegistry,
  resumeSession: resumeSessionMock,
}));

vi.mock('./sessions.js', () => ({
  readSessionBlocks: readSessionBlocksMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import { recoverConversationCapability, type RecoverConversationCapabilityContext } from './conversationRecovery.js';

function createContext(): RecoverConversationCapabilityContext {
  return {
    getCurrentProfile: () => 'assistant',
    buildLiveSessionResourceOptions: () => ({ additionalExtensionPaths: ['extensions'] }),
    buildLiveSessionExtensionFactories: () => ['factory'] as never,
    flushLiveDeferredResumes: vi.fn().mockResolvedValue(undefined),
  };
}

describe('recoverConversationCapability', () => {
  beforeEach(() => {
    liveRegistry.clear();
    existsSyncMock.mockReset();
    getDurableRunMock.mockReset();
    isLiveSessionMock.mockReset();
    listRecoverableWebLiveConversationRunsMock.mockReset();
    logErrorMock.mockReset();
    parsePendingOperationMock.mockReset();
    promptSessionMock.mockReset();
    queuePromptContextMock.mockReset();
    readSessionBlocksMock.mockReset();
    repairLiveSessionTranscriptTailMock.mockReset();
    resumeSessionMock.mockReset();
    syncWebLiveConversationRunMock.mockReset();
    createWebLiveConversationRunIdMock.mockReset();

    syncWebLiveConversationRunMock.mockResolvedValue({ runId: 'run-1' });
    promptSessionMock.mockResolvedValue(undefined);
    repairLiveSessionTranscriptTailMock.mockReturnValue({
      recoverable: false,
      repaired: false,
      reason: null,
    });
  });

  afterEach(() => {
    liveRegistry.clear();
  });

  it('repairs but does not prompt when a live conversation ends with a recoverable tail', async () => {
    isLiveSessionMock.mockReturnValueOnce(true);
    repairLiveSessionTranscriptTailMock.mockReturnValueOnce({
      recoverable: true,
      repaired: true,
      reason: 'assistant_error',
    });
    liveRegistry.set('conversation-live', {
      cwd: '/repo/live',
      title: 'Live title',
      session: { sessionFile: '/sessions/live.json' },
    });
    readSessionBlocksMock.mockReturnValueOnce({
      meta: { cwd: '/repo/live', title: 'Live title' },
      blocks: [{ type: 'error', ts: '2026-04-21T12:00:00.000Z', message: 'Codex error: upstream overloaded' }],
    });

    const result = await recoverConversationCapability('conversation-live', createContext());

    expect(repairLiveSessionTranscriptTailMock).toHaveBeenCalledWith('conversation-live');
    expect(syncWebLiveConversationRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-live',
        sessionFile: '/sessions/live.json',
        cwd: '/repo/live',
        title: 'Live title',
        profile: 'assistant',
        state: 'running',
        pendingOperation: null,
      }),
    );
    expect(promptSessionMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      conversationId: 'conversation-live',
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: false,
    });
  });

  it('replays pending operations after resuming a stored conversation', async () => {
    const pendingOperation = {
      type: 'prompt' as const,
      text: 'Continue the deployment review.',
      behavior: 'followUp' as const,
      contextMessages: [{ customType: 'referenced_context', content: 'Remember the staging note.' }],
      enqueuedAt: '2026-04-21T12:05:00.000Z',
    };

    isLiveSessionMock.mockReturnValueOnce(false);
    createWebLiveConversationRunIdMock.mockReturnValueOnce('web-run:conversation-1');
    getDurableRunMock.mockResolvedValueOnce({
      run: {
        checkpoint: {
          payload: {
            pendingOperation: { type: 'prompt', text: 'ignored' },
            profile: ' reviewer ',
          },
        },
        manifest: {
          source: { filePath: ' /sessions/from-run.json ' },
          spec: { cwd: ' /manifest-cwd ' },
        },
      },
    });
    parsePendingOperationMock.mockReturnValueOnce(pendingOperation);
    readSessionBlocksMock.mockReturnValueOnce({
      meta: {
        file: '/sessions/stored.json',
        cwd: '/repo/stored',
        title: 'Stored title',
      },
      blocks: [{ type: 'error', ts: '2026-04-21T12:00:00.000Z', message: 'Codex error: upstream overloaded' }],
    });
    existsSyncMock.mockReturnValueOnce(true);
    resumeSessionMock.mockResolvedValueOnce({ id: 'conversation-1-live' });
    repairLiveSessionTranscriptTailMock.mockReturnValueOnce({
      recoverable: true,
      repaired: true,
      reason: 'assistant_error',
    });
    liveRegistry.set('conversation-1-live', {
      cwd: '/repo/resumed',
      title: 'Stored title',
      session: {},
    });

    const context = createContext();
    const result = await recoverConversationCapability('conversation-1', context);

    expect(createWebLiveConversationRunIdMock).toHaveBeenCalledWith('conversation-1');
    expect(resumeSessionMock).toHaveBeenCalledWith('/sessions/stored.json', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
      cwdOverride: '/repo/stored',
    });
    expect(syncWebLiveConversationRunMock).toHaveBeenCalledWith({
      conversationId: 'conversation-1-live',
      sessionFile: '/sessions/stored.json',
      cwd: '/repo/resumed',
      title: 'Stored title',
      profile: 'reviewer',
      state: 'running',
      pendingOperation,
    });
    expect(queuePromptContextMock).toHaveBeenCalledWith('conversation-1-live', 'referenced_context', 'Remember the staging note.');
    expect(promptSessionMock).toHaveBeenCalledWith('conversation-1-live', 'Continue the deployment review.', 'followUp', undefined);
    expect(result).toEqual({
      conversationId: 'conversation-1-live',
      live: true,
      recovered: true,
      replayedPendingOperation: true,
      usedFallbackPrompt: false,
    });
  });
});
