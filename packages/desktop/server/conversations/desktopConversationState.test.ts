import { afterEach, describe, expect, it, vi } from 'vitest';

const readLiveSessionStateSnapshotMock = vi.fn();
const readConversationSessionMetaCapabilityMock = vi.fn();
const inlineConversationSessionDetailAssetsCapabilityMock = vi.fn();
const readSessionDetailForRouteMock = vi.fn();

vi.mock('./liveSessions.js', () => ({
  readLiveSessionStateSnapshot: readLiveSessionStateSnapshotMock,
}));

vi.mock('./conversationSessionCapability.js', () => ({
  readConversationSessionMetaCapability: readConversationSessionMetaCapabilityMock,
}));

vi.mock('./conversationSessionAssetCapability.js', () => ({
  inlineConversationSessionDetailAssetsCapability: inlineConversationSessionDetailAssetsCapabilityMock,
}));

vi.mock('./conversationService.js', () => ({
  readSessionDetailForRoute: readSessionDetailForRouteMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('desktopConversationState reducer', () => {
  it('does not replace same-text user image blocks when image identity differs', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');

    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, {
      type: 'user_message',
      block: {
        type: 'user',
        id: 'user-1',
        text: 'same text',
        images: [{ alt: 'old.png', src: 'blob:old', mimeType: 'image/png', caption: 'old.png' }],
      },
    } as never);
    state = applyDesktopConversationStreamEvent(state, {
      type: 'user_message',
      block: {
        type: 'user',
        id: 'user-2',
        text: 'same text',
        images: [{ alt: 'new.png', src: 'blob:new', mimeType: 'image/png', caption: 'new.png' }],
      },
    } as never);

    expect(state.blocks).toHaveLength(2);
    expect(state.blocks).toEqual([
      expect.objectContaining({ type: 'user', images: [expect.objectContaining({ src: 'blob:old' })] }),
      expect.objectContaining({ type: 'user', images: [expect.objectContaining({ src: 'blob:new' })] }),
    ]);
  });

  it('clears compaction state and surfaces compaction failures from live events', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');

    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, {
      type: 'compaction_start',
      mode: 'auto',
      reason: 'threshold',
    } as never);
    expect(state.isCompacting).toBe(true);

    state = applyDesktopConversationStreamEvent(state, {
      type: 'compaction_end',
      mode: 'auto',
      reason: 'threshold',
      aborted: false,
      willRetry: false,
      tokensBefore: 90000,
    } as never);
    expect(state.isCompacting).toBe(false);
    expect(state.blocks).toHaveLength(0);

    state = applyDesktopConversationStreamEvent(state, {
      type: 'compaction_start',
      mode: 'manual',
      reason: 'manual',
    } as never);
    state = applyDesktopConversationStreamEvent(state, {
      type: 'compaction_end',
      mode: 'manual',
      reason: 'manual',
      aborted: false,
      willRetry: false,
      errorMessage: 'Compaction failed: nope',
    } as never);

    expect(state.isCompacting).toBe(false);
    expect(state.error).toBe('Compaction failed: nope');
    expect(state.blocks.at(-1)).toMatchObject({ type: 'error', message: 'Compaction failed: nope' });
  });

  it('updates streaming tool blocks and queue state from live events', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');

    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, {
      type: 'agent_start',
    } as never);
    state = applyDesktopConversationStreamEvent(state, {
      type: 'tool_start',
      toolName: 'shell',
      args: { cmd: 'pwd' },
      toolCallId: 'tool-1',
    } as never);
    state = applyDesktopConversationStreamEvent(state, {
      type: 'tool_update',
      toolCallId: 'tool-1',
      partialResult: 'partial output',
    } as never);
    state = applyDesktopConversationStreamEvent(state, {
      type: 'tool_end',
      toolCallId: 'tool-1',
      output: 'final output',
      isError: false,
      durationMs: 42,
      details: { exitCode: 0 },
    } as never);
    state = applyDesktopConversationStreamEvent(state, {
      type: 'queue_state',
      steering: [{ id: 'steer-1', text: 'Nudge', imageCount: 0 }],
      followUp: [{ id: 'follow-1', text: 'Later', imageCount: 1 }],
    } as never);
    state = applyDesktopConversationStreamEvent(state, {
      type: 'parallel_state',
      jobs: [
        {
          id: 'parallel-1',
          prompt: 'Check the docs',
          childConversationId: 'child-1',
          status: 'running',
          imageCount: 1,
          attachmentRefs: ['diagram (rev 2)'],
          touchedFiles: ['src/app.ts'],
          parentTouchedFiles: ['src/app.ts'],
          overlapFiles: ['src/app.ts'],
          sideEffects: ['Saved checkpoint abc1234 Keep the fix.'],
        },
      ],
    } as never);

    expect(state.isStreaming).toBe(true);
    expect(state.blocks).toEqual([
      {
        type: 'tool_use',
        tool: 'shell',
        input: { cmd: 'pwd' },
        output: 'final output',
        status: 'ok',
        durationMs: 42,
        details: { exitCode: 0 },
        ts: expect.any(String),
        _toolCallId: 'tool-1',
      },
    ]);
    expect(state.pendingQueue).toEqual({
      steering: [{ id: 'steer-1', text: 'Nudge', imageCount: 0 }],
      followUp: [{ id: 'follow-1', text: 'Later', imageCount: 1 }],
    });
    expect(state.parallelJobs).toEqual([
      {
        id: 'parallel-1',
        prompt: 'Check the docs',
        childConversationId: 'child-1',
        status: 'running',
        imageCount: 1,
        attachmentRefs: ['diagram (rev 2)'],
        touchedFiles: ['src/app.ts'],
        parentTouchedFiles: ['src/app.ts'],
        overlapFiles: ['src/app.ts'],
        sideEffects: ['Saved checkpoint abc1234 Keep the fix.'],
      },
    ]);
  });

  it('updates goal state from goal tool completions', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');

    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, {
      type: 'tool_start',
      toolName: 'set_goal',
      args: { objective: 'Ship the thing' },
      toolCallId: 'goal-1',
    } as never);
    state = applyDesktopConversationStreamEvent(state, {
      type: 'tool_end',
      toolName: 'set_goal',
      toolCallId: 'goal-1',
      output: 'Goal set: "Ship the thing"',
      isError: false,
      durationMs: 7,
      details: {
        state: {
          objective: 'Ship the thing',
          status: 'active',
          tasks: [],
          stopReason: null,
          updatedAt: '2026-05-11T12:00:00.000Z',
        },
      },
    } as never);

    expect(state.goalState).toEqual({
      objective: 'Ship the thing',
      status: 'active',
      tasks: [],
      stopReason: null,
      updatedAt: '2026-05-11T12:00:00.000Z',
    });

    state = applyDesktopConversationStreamEvent(state, {
      type: 'tool_end',
      toolName: 'update_goal',
      toolCallId: 'goal-2',
      output: 'Goal complete!',
      isError: false,
      durationMs: 5,
      details: {
        state: {
          objective: '',
          status: 'complete',
          tasks: [],
          stopReason: 'goal achieved',
          updatedAt: '2026-05-11T12:01:00.000Z',
        },
      },
    } as never);

    expect(state.goalState).toBeNull();
  });

  it('clears goal state when a snapshot explicitly reports no active goal', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');

    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, {
      type: 'snapshot',
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      isStreaming: false,
      goalState: { objective: 'Ship it', status: 'active', tasks: [], stopReason: null, updatedAt: '2026-05-11T12:00:00.000Z' },
    } as never);
    expect(state.goalState?.objective).toBe('Ship it');

    state = applyDesktopConversationStreamEvent(state, {
      type: 'snapshot',
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      isStreaming: false,
      goalState: null,
    } as never);

    expect(state.goalState).toBeNull();
  });

  it('preserves terminal-style metadata for direct bang bash runs', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');

    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, {
      type: 'tool_start',
      toolName: 'bash',
      args: {
        command: 'npm run release:publish',
        displayMode: 'terminal',
        excludeFromContext: true,
      },
      toolCallId: 'user-bash-1',
    } as never);
    state = applyDesktopConversationStreamEvent(state, {
      type: 'tool_end',
      toolName: 'bash',
      toolCallId: 'user-bash-1',
      output: '/bin/bash: npm: command not found',
      isError: true,
      durationMs: 127,
      details: {
        displayMode: 'terminal',
        exitCode: 127,
        excludeFromContext: true,
      },
    } as never);

    expect(state.blocks).toEqual([
      {
        type: 'tool_use',
        tool: 'bash',
        input: {
          command: 'npm run release:publish',
          displayMode: 'terminal',
          excludeFromContext: true,
        },
        output: '/bin/bash: npm: command not found',
        status: 'error',
        durationMs: 127,
        details: {
          displayMode: 'terminal',
          exitCode: 127,
          excludeFromContext: true,
        },
        ts: expect.any(String),
        _toolCallId: 'user-bash-1',
      },
    ]);
  });

  it('replaces duplicate user message blocks instead of appending them twice', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');

    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, {
      type: 'user_message',
      block: {
        type: 'user',
        id: 'user-1',
        ts: '2026-04-11T12:00:00.000Z',
        text: 'hello',
      },
    } as never);
    state = applyDesktopConversationStreamEvent(state, {
      type: 'user_message',
      block: {
        type: 'user',
        id: 'user-2',
        ts: '2026-04-11T12:00:01.000Z',
        text: 'hello',
      },
    } as never);

    expect(state.blocks).toEqual([
      {
        type: 'user',
        id: 'user-2',
        text: 'hello',
        ts: '2026-04-11T12:00:01.000Z',
        images: undefined,
      },
    ]);
    expect(state.totalBlocks).toBe(1);
  });
});

describe('desktopConversationState reducer — streaming lifecycle', () => {
  it('agent_start sets isStreaming and clears error', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');
    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, { type: 'agent_start' } as never);
    expect(state.isStreaming).toBe(true);
    expect(state.error).toBeNull();
  });

  it('agent_end clears isStreaming', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');
    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, { type: 'agent_start' } as never);
    state = applyDesktopConversationStreamEvent(state, { type: 'agent_end' } as never);
    expect(state.isStreaming).toBe(false);
  });

  it('turn_end clears isStreaming', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');
    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, { type: 'agent_start' } as never);
    state = applyDesktopConversationStreamEvent(state, { type: 'turn_end' } as never);
    expect(state.isStreaming).toBe(false);
  });

  it('snapshot uses the server streaming state instead of hardcoding false', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');

    // Snapshot with isStreaming: true preserves the streaming state
    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, {
      type: 'snapshot',
      blocks: [],
      blockOffset: 0,
      totalBlocks: 3,
      isStreaming: true,
    } as never);
    expect(state.isStreaming).toBe(true);
    expect(state.isCompacting).toBe(false);
    expect(state.hasSnapshot).toBe(true);
    expect(state.totalBlocks).toBe(3);

    // Snapshot with isStreaming: false clears the streaming state
    state = applyDesktopConversationStreamEvent(state, {
      type: 'snapshot',
      blocks: [],
      blockOffset: 0,
      totalBlocks: 3,
      isStreaming: false,
    } as never);
    expect(state.isStreaming).toBe(false);
    expect(state.isCompacting).toBe(false);

    // Snapshot without isStreaming preserves the previous streaming state
    state = applyDesktopConversationStreamEvent(state, {
      type: 'agent_start',
    } as never);
    expect(state.isStreaming).toBe(true);

    state = applyDesktopConversationStreamEvent(state, {
      type: 'snapshot',
      blocks: [],
      blockOffset: 0,
      totalBlocks: 3,
    } as never);
    expect(state.isStreaming).toBe(true);
  });

  it('error event appends error block and clears isStreaming', async () => {
    const { applyDesktopConversationStreamEvent, createEmptyDesktopConversationStreamState } =
      await import('./desktopConversationState.js');
    let state = createEmptyDesktopConversationStreamState();
    state = applyDesktopConversationStreamEvent(state, { type: 'agent_start' } as never);
    state = applyDesktopConversationStreamEvent(state, { type: 'error', message: 'server overloaded' } as never);
    expect(state.isStreaming).toBe(false);
    expect(state.error).toBe('server overloaded');
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ type: 'error', message: 'server overloaded' });
  });
});

describe('readDesktopConversationState', () => {
  it('builds the unified local state from the live registry for active conversations', async () => {
    readConversationSessionMetaCapabilityMock.mockReturnValue({
      id: 'conv-live',
      file: '/tmp/conv-live.jsonl',
      timestamp: '2026-04-11T12:00:00.000Z',
      cwd: '/tmp/project',
      cwdSlug: 'project',
      model: 'openai/gpt-5.4',
      title: 'Live conversation',
      messageCount: 1,
      isLive: true,
    });
    readLiveSessionStateSnapshotMock.mockReturnValue({
      blocks: [
        {
          type: 'user',
          id: 'user-1',
          ts: '2026-04-11T12:00:00.000Z',
          text: 'hello from live',
        },
      ],
      blockOffset: 0,
      totalBlocks: 1,
      hasSnapshot: true,
      isStreaming: true,
      isCompacting: false,
      hasPendingHiddenTurn: false,
      error: null,
      title: 'Live conversation',
      tokens: { input: 1, output: 2, total: 3 },
      cost: 0.01,
      contextUsage: { tokens: 3 },
      pendingQueue: { steering: [], followUp: [] },
      parallelJobs: [],
      presence: {
        surfaces: [],
        controllerSurfaceId: null,
        controllerSurfaceType: null,
        controllerAcquiredAt: null,
      },
      autoModeState: null,
      cwdChange: null,
    });

    const { readDesktopConversationState } = await import('./desktopConversationState.js');
    const state = await readDesktopConversationState({
      conversationId: 'conv-live',
      profile: 'default',
      tailBlocks: 20,
    });

    expect(readLiveSessionStateSnapshotMock).toHaveBeenCalledWith('conv-live', 20);
    expect(state).toEqual({
      conversationId: 'conv-live',
      sessionDetail: {
        meta: readConversationSessionMetaCapabilityMock.mock.results[0]?.value,
        blocks: [],
        blockOffset: 0,
        totalBlocks: 1,
        contextUsage: { tokens: 3 },
      },
      liveSession: {
        live: true,
        id: 'conv-live',
        cwd: '/tmp/project',
        sessionFile: '/tmp/conv-live.jsonl',
        title: 'Live conversation',
        isStreaming: true,
        hasPendingHiddenTurn: false,
      },
      stream: {
        blocks: [
          {
            type: 'user',
            id: 'user-1',
            ts: '2026-04-11T12:00:00.000Z',
            text: 'hello from live',
            images: undefined,
          },
        ],
        blockOffset: 0,
        totalBlocks: 1,
        hasSnapshot: true,
        isStreaming: true,
        isCompacting: false,
        error: null,
        title: 'Live conversation',
        tokens: { input: 1, output: 2, total: 3 },
        cost: 0.01,
        contextUsage: { tokens: 3 },
        pendingQueue: { steering: [], followUp: [] },
        parallelJobs: [],
        presence: {
          surfaces: [],
          controllerSurfaceId: null,
          controllerSurfaceType: null,
          controllerAcquiredAt: null,
        },
        autoModeState: null,
        cwdChange: null,
      },
    });
  });

  it('does not forward unsafe tail block limits to live snapshots', async () => {
    readConversationSessionMetaCapabilityMock.mockReturnValue({
      id: 'conv-live',
      file: '/tmp/conv-live.jsonl',
      timestamp: '2026-04-11T12:00:00.000Z',
      cwd: '/tmp/project',
      cwdSlug: 'project',
      model: 'openai/gpt-5.4',
      title: 'Live conversation',
      messageCount: 1,
      isLive: true,
    });
    readLiveSessionStateSnapshotMock.mockReturnValue({
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      hasSnapshot: true,
      isStreaming: false,
      isCompacting: false,
      hasPendingHiddenTurn: false,
      error: null,
      title: null,
      tokens: null,
      cost: null,
      contextUsage: null,
      pendingQueue: { steering: [], followUp: [] },
      parallelJobs: [],
      presence: { surfaces: [], controllerSurfaceId: null, controllerSurfaceType: null, controllerAcquiredAt: null },
      autoModeState: null,
      cwdChange: null,
    });

    const { readDesktopConversationState } = await import('./desktopConversationState.js');
    await readDesktopConversationState({
      conversationId: 'conv-live',
      profile: 'default',
      tailBlocks: Number.MAX_SAFE_INTEGER + 1,
    });

    expect(readLiveSessionStateSnapshotMock).toHaveBeenCalledWith('conv-live', undefined);
  });

  it('caps expensive tail block limits for live snapshots', async () => {
    readConversationSessionMetaCapabilityMock.mockReturnValue({
      id: 'conv-live',
      file: '/tmp/conv-live.jsonl',
      timestamp: '2026-04-11T12:00:00.000Z',
      cwd: '/tmp/project',
      cwdSlug: 'project',
      model: 'openai/gpt-5.4',
      title: 'Live conversation',
      messageCount: 1,
      isLive: true,
    });
    readLiveSessionStateSnapshotMock.mockReturnValue({
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      hasSnapshot: true,
      isStreaming: false,
      isCompacting: false,
      hasPendingHiddenTurn: false,
      error: null,
      title: null,
      tokens: null,
      cost: null,
      contextUsage: null,
      pendingQueue: { steering: [], followUp: [] },
      parallelJobs: [],
      presence: { surfaces: [], controllerSurfaceId: null, controllerSurfaceType: null, controllerAcquiredAt: null },
      autoModeState: null,
      cwdChange: null,
    });

    const { readDesktopConversationState } = await import('./desktopConversationState.js');
    await readDesktopConversationState({
      conversationId: 'conv-live',
      profile: 'default',
      tailBlocks: 5000,
    });

    expect(readLiveSessionStateSnapshotMock).toHaveBeenCalledWith('conv-live', 1000);
  });

  it('falls back to stored session detail when the conversation is not live', async () => {
    readConversationSessionMetaCapabilityMock.mockReturnValue({
      id: 'conv-stored',
      isLive: false,
    });
    readSessionDetailForRouteMock.mockResolvedValue({
      sessionRead: {
        detail: {
          meta: { id: 'conv-stored', title: 'Stored conversation' },
          blocks: [{ id: 'msg-1', type: 'text', ts: '2026-04-11T12:00:00.000Z', text: 'stored reply' }],
          blockOffset: 0,
          totalBlocks: 1,
          contextUsage: { tokens: 9 },
        },
      },
    });
    inlineConversationSessionDetailAssetsCapabilityMock.mockImplementation((_conversationId, detail) => ({
      ...detail,
      inlined: true,
    }));

    const { createEmptyDesktopConversationStreamState, readDesktopConversationState } = await import('./desktopConversationState.js');
    const state = await readDesktopConversationState({
      conversationId: 'conv-stored',
      profile: 'default',
      tailBlocks: 10,
    });

    expect(readSessionDetailForRouteMock).toHaveBeenCalledWith({
      conversationId: 'conv-stored',
      profile: 'default',
      tailBlocks: 10,
    });
    expect(inlineConversationSessionDetailAssetsCapabilityMock).toHaveBeenCalledWith('conv-stored', {
      meta: { id: 'conv-stored', title: 'Stored conversation' },
      blocks: [{ id: 'msg-1', type: 'text', ts: '2026-04-11T12:00:00.000Z', text: 'stored reply' }],
      blockOffset: 0,
      totalBlocks: 1,
      contextUsage: { tokens: 9 },
    });
    expect(state).toEqual({
      conversationId: 'conv-stored',
      sessionDetail: {
        meta: { id: 'conv-stored', title: 'Stored conversation' },
        blocks: [{ id: 'msg-1', type: 'text', ts: '2026-04-11T12:00:00.000Z', text: 'stored reply' }],
        blockOffset: 0,
        totalBlocks: 1,
        contextUsage: { tokens: 9 },
        inlined: true,
      },
      liveSession: { live: false },
      stream: createEmptyDesktopConversationStreamState(),
    });
  });
});
