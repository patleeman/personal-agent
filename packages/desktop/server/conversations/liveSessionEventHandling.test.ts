/**
 * Tests for trace persistence hooks in liveSessionEventHandling.ts
 *
 * Verifies that persistTraceToolCall and persistTraceCompaction
 * are called with correct arguments when SSE events fire.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the persist functions before importing the handler
const { persistTraceToolCallMock, persistTraceCompactionMock, persistAppTelemetryEventMock } = vi.hoisted(() => ({
  persistTraceToolCallMock: vi.fn(),
  persistTraceCompactionMock: vi.fn(),
  persistAppTelemetryEventMock: vi.fn(),
}));

vi.mock('../traces/appTelemetry.js', () => ({
  persistAppTelemetryEvent: persistAppTelemetryEventMock,
}));

vi.mock('../traces/tracePersistence.js', () => ({
  persistTraceToolCall: persistTraceToolCallMock,
  persistTraceCompaction: persistTraceCompactionMock,
}));

import { handleLiveSessionEvent } from './liveSessionEventHandling.js';

// ── Streaming lifecycle callbacks ────────────────────────────────────────────

describe('streaming lifecycle callbacks', () => {
  function makeEntry(overrides: Record<string, unknown> = {}) {
    return {
      sessionId: 'sess-1',
      session: {} as any,
      title: 'Test',
      ...overrides,
    } as any;
  }

  function makeCallbacks() {
    return {
      requestConversationAutoModeContinuationTurn: vi.fn().mockResolvedValue(false),
      requestConversationAutoModeTurn: vi.fn().mockResolvedValue(false),
      syncDurableConversationRun: vi.fn().mockResolvedValue(undefined),
      notifyLifecycleHandlers: vi.fn(),
      applyPendingConversationWorkingDirectoryChange: vi.fn().mockResolvedValue(undefined),
      scheduleContextUsage: vi.fn(),
      publishSessionMetaChanged: vi.fn(),
      broadcastQueueState: vi.fn(),
      broadcastTitle: vi.fn(),
      broadcastStats: vi.fn(),
      clearContextUsageTimer: vi.fn(),
      broadcastContextUsage: vi.fn(),
      broadcastSnapshot: vi.fn(),
      broadcast: vi.fn(),
      tryImportReadyParallelJobs: vi.fn().mockResolvedValue(undefined),
      syncRunningState: vi.fn(),
    };
  }

  it('agent_start marks durable run as running and syncs running state', () => {
    const entry = makeEntry();
    const cbs = makeCallbacks();
    handleLiveSessionEvent(entry, { type: 'agent_start' } as any, cbs);
    expect(cbs.syncDurableConversationRun).toHaveBeenCalledWith(entry, 'running');
    expect(cbs.syncRunningState).toHaveBeenCalledWith('sess-1');
  });

  it('agent_end marks durable run as waiting', () => {
    const entry = makeEntry({
      traceRunStartedAtMs: Date.now(),
      traceRunTurnCount: 1,
      traceRunStepCount: 0,
    });
    const cbs = makeCallbacks();
    handleLiveSessionEvent(entry, { type: 'agent_end', messages: [] } as any, cbs);
    expect(cbs.syncDurableConversationRun).toHaveBeenCalledWith(entry, 'waiting');
    expect(cbs.clearContextUsageTimer).toHaveBeenCalled();
    expect(cbs.broadcastContextUsage).toHaveBeenCalled();
  });

  it('turn_end marks durable run as waiting and notifies lifecycle handlers', () => {
    const entry = makeEntry();
    const cbs = makeCallbacks();
    handleLiveSessionEvent(entry, { type: 'turn_end', message: {}, toolResults: [] } as any, cbs);
    expect(cbs.syncDurableConversationRun).toHaveBeenCalledWith(entry, 'waiting');
    expect(cbs.notifyLifecycleHandlers).toHaveBeenCalledWith(entry, 'turn_end');
    expect(cbs.syncRunningState).toHaveBeenCalledWith('sess-1');
    expect(cbs.clearContextUsageTimer).toHaveBeenCalled();
  });

  it('calls syncRunningState on every event, not just agent_start/turn_end', () => {
    const entry = makeEntry();
    const cbs = makeCallbacks();
    const events = [
      { type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'bash', args: {} },
      { type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: 'hi' } },
      { type: 'tool_execution_end', toolCallId: 'tc-1', toolName: 'bash', result: { exitCode: 0 }, isError: false },
    ] as any;
    for (const event of events) handleLiveSessionEvent(entry, event, cbs);
    expect(cbs.syncRunningState).toHaveBeenCalledTimes(events.length);
    expect(cbs.syncRunningState).toHaveBeenCalledWith('sess-1');
  });

  it('agent_start then agent_end broadcasts to subscribers via broadcast', () => {
    const entry = makeEntry({ traceRunStartedAtMs: Date.now(), traceRunTurnCount: 0, traceRunStepCount: 0 });
    const cbs = makeCallbacks();
    handleLiveSessionEvent(entry, { type: 'agent_start' } as any, cbs);
    handleLiveSessionEvent(entry, { type: 'agent_end', messages: [] } as any, cbs);
    const broadcastedTypes = cbs.broadcast.mock.calls.map((c: any[]) => c[1]?.type);
    expect(broadcastedTypes).toContain('agent_start');
    expect(broadcastedTypes).toContain('agent_end');
  });

  it('records current turn error from assistant message_end with error stop reason', () => {
    const entry = makeEntry({ currentTurnError: null });
    const cbs = makeCallbacks();
    handleLiveSessionEvent(
      entry,
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'server overloaded',
          content: [],
        },
      } as any,
      cbs,
    );
    expect(entry.currentTurnError).toBe('server overloaded');
  });

  it('does not set currentTurnError for non-error assistant messages', () => {
    const entry = makeEntry({ currentTurnError: null });
    const cbs = makeCallbacks();
    handleLiveSessionEvent(
      entry,
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: 'Done.' }],
        },
      } as any,
      cbs,
    );
    expect(entry.currentTurnError).toBeNull();
  });

  it('schedules context usage update on agent_start, message_update, and tool events', () => {
    const entry = makeEntry();
    const cbs = makeCallbacks();
    const events: any[] = [
      { type: 'agent_start' },
      { type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: 'hi' } },
      { type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'bash', args: {} },
    ];
    for (const event of events) handleLiveSessionEvent(entry, event, cbs);
    expect(cbs.scheduleContextUsage).toHaveBeenCalledTimes(events.length);
  });
});

describe('trace persistence hooks', () => {
  const mockSession = {
    sessionId: 'test-session',
    title: 'Test conversation',
  } as any;

  const mockCallbacks = {
    maybeAutoTitleConversation: vi.fn(),
    requestConversationAutoModeContinuationTurn: vi.fn(),
    requestConversationAutoModeTurn: vi.fn(),
    syncDurableConversationRun: vi.fn(),
    notifyLifecycleHandlers: vi.fn(),
    applyPendingConversationWorkingDirectoryChange: vi.fn(),
    scheduleContextUsage: vi.fn(),
    publishSessionMetaChanged: vi.fn(),
    syncRunningState: vi.fn(),
    broadcastQueueState: vi.fn(),
    broadcastTitle: vi.fn(),
    broadcastStats: vi.fn(),
    clearContextUsageTimer: vi.fn(),
    broadcastContextUsage: vi.fn(),
    broadcastSnapshot: vi.fn(),
    broadcast: vi.fn(),
    tryImportReadyParallelJobs: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists tool call on tool_execution_end (success)', () => {
    const entry = {
      sessionId: 'test-session',
      session: mockSession,
      title: 'Test conversation',
      traceRunId: 'run-1',
    } as any;

    // First fire tool_execution_start to set up the timer
    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_start',
        toolCallId: 'tc-1',
        toolName: 'bash',
        args: { command: 'git status --short' },
      } as any,
      mockCallbacks,
    );

    // Then fire tool_execution_end
    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-1',
        toolName: 'bash',
        result: { exitCode: 0 },
        isError: false,
      } as any,
      mockCallbacks,
    );

    expect(persistTraceToolCallMock).toHaveBeenCalledTimes(1);
    const call = persistTraceToolCallMock.mock.calls[0][0];
    expect(call.sessionId).toBe('test-session');
    expect(call.runId).toBe('run-1');
    expect(call.toolName).toBe('bash');
    expect(call.toolInput).toEqual({ command: 'git status --short' });
    expect(call.status).toBe('ok');
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
    expect(call.conversationTitle).toBe('Test conversation');
  });

  it('persists tool call with error status on failed execution', () => {
    const entry = {
      sessionId: 'test-session',
      session: mockSession,
      title: 'Test conversation',
    } as any;

    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_start',
        toolCallId: 'tc-2',
        toolName: 'read',
        args: { path: '/nonexistent' },
      } as any,
      mockCallbacks,
    );

    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-2',
        toolName: 'read',
        result: 'File not found',
        isError: true,
      } as any,
      mockCallbacks,
    );

    expect(persistTraceToolCallMock).toHaveBeenCalledTimes(1);
    const call = persistTraceToolCallMock.mock.calls[0][0];
    expect(call.toolName).toBe('read');
    expect(call.status).toBe('error');
    expect(call.errorMessage).toBe('File not found');
  });

  it('persists object-shaped tool errors as readable JSON instead of object Object', () => {
    const entry = {
      sessionId: 'test-session',
      session: mockSession,
      title: 'Test conversation',
    } as any;

    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_start',
        toolCallId: 'tc-json-error',
        toolName: 'bash',
        args: { command: 'npm test' },
      } as any,
      mockCallbacks,
    );

    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-json-error',
        toolName: 'bash',
        result: { exitCode: 1, stderr: 'failed' },
        isError: true,
      } as any,
      mockCallbacks,
    );

    expect(persistTraceToolCallMock).toHaveBeenCalledTimes(1);
    expect(persistTraceToolCallMock.mock.calls[0][0].errorMessage).toBe('{"exitCode":1,"stderr":"failed"}');
  });

  it('persists compaction on compaction_end', () => {
    const entry = {
      sessionId: 'test-session',
      session: mockSession,
      title: 'Test conversation',
      isCompacting: true,
    } as any;

    handleLiveSessionEvent(
      entry,
      {
        type: 'compaction_end',
        reason: 'overflow',
        aborted: false,
        willRetry: false,
        result: { tokensBefore: 120000, summary: 'test' },
      } as any,
      mockCallbacks,
    );

    expect(persistTraceCompactionMock).toHaveBeenCalledTimes(1);
    const call = persistTraceCompactionMock.mock.calls[0][0];
    expect(call.sessionId).toBe('test-session');
    expect(call.reason).toBe('overflow');
    expect(call.tokensBefore).toBe(120000);
  });

  it('does not persist aborted compactions', () => {
    const entry = {
      sessionId: 'test-session',
      session: mockSession,
      title: 'Test',
      isCompacting: true,
    } as any;

    handleLiveSessionEvent(
      entry,
      {
        type: 'compaction_end',
        reason: 'overflow',
        aborted: true,
        willRetry: false,
        result: undefined,
      } as any,
      mockCallbacks,
    );

    expect(persistTraceCompactionMock).not.toHaveBeenCalled();
  });

  it('tracks multiple concurrent tool executions independently', () => {
    const entry = {
      sessionId: 'test-session',
      session: mockSession,
      title: 'Test',
    } as any;

    // Start two tools
    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_start',
        toolCallId: 'tc-a',
        toolName: 'bash',
        args: {},
      } as any,
      mockCallbacks,
    );

    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_start',
        toolCallId: 'tc-b',
        toolName: 'edit',
        args: {},
      } as any,
      mockCallbacks,
    );

    // End in reverse order
    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-b',
        toolName: 'edit',
        result: {},
        isError: false,
      } as any,
      mockCallbacks,
    );

    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-a',
        toolName: 'bash',
        result: {},
        isError: false,
      } as any,
      mockCallbacks,
    );

    expect(persistTraceToolCallMock).toHaveBeenCalledTimes(2);
    expect(persistTraceToolCallMock.mock.calls[0][0].toolName).toBe('edit');
    expect(persistTraceToolCallMock.mock.calls[1][0].toolName).toBe('bash');
  });
});

describe('auto mode continuation flow', () => {
  const REVIEW_TYPE = 'conversation_automation_post_turn_review';

  function makeEntry(overrides: Record<string, unknown> = {}) {
    return {
      sessionId: 'sess-auto',
      session: {} as any,
      title: 'Auto mode',
      pendingAutoModeContinuation: false,
      pendingHiddenTurnCustomTypes: [] as string[],
      activeHiddenTurnCustomType: null,
      ...overrides,
    } as any;
  }

  function makeCallbacks() {
    return {
      requestConversationAutoModeContinuationTurn: vi.fn().mockResolvedValue(true),
      requestConversationAutoModeTurn: vi.fn().mockResolvedValue(true),
      syncDurableConversationRun: vi.fn(),
      notifyLifecycleHandlers: vi.fn(),
      applyPendingConversationWorkingDirectoryChange: vi.fn(),
      scheduleContextUsage: vi.fn(),
      publishSessionMetaChanged: vi.fn(),
      syncRunningState: vi.fn(),
      broadcastQueueState: vi.fn(),
      broadcastTitle: vi.fn(),
      broadcastStats: vi.fn(),
      clearContextUsageTimer: vi.fn(),
      broadcastContextUsage: vi.fn(),
      broadcastSnapshot: vi.fn(),
      broadcast: vi.fn(),
      tryImportReadyParallelJobs: vi.fn(),
    };
  }

  describe('nudge mode review turn', () => {
    it('schedules continuation when pendingAutoModeContinuation is true', async () => {
      const entry = makeEntry({
        pendingAutoModeContinuation: true,
        activeHiddenTurnCustomType: REVIEW_TYPE,
      });
      const cbs = makeCallbacks();

      handleLiveSessionEvent(entry, { type: 'turn_end' } as any, cbs);

      // The handler uses queueMicrotask; flush microtasks
      await new Promise((resolve) => queueMicrotask(resolve));

      expect(cbs.requestConversationAutoModeContinuationTurn).toHaveBeenCalledWith('sess-auto');
      expect(cbs.requestConversationAutoModeTurn).not.toHaveBeenCalled();
    });

    it('clears pendingAutoModeContinuation flag after consuming it', () => {
      const entry = makeEntry({
        pendingAutoModeContinuation: true,
        activeHiddenTurnCustomType: REVIEW_TYPE,
      });
      const cbs = makeCallbacks();

      handleLiveSessionEvent(entry, { type: 'turn_end' } as any, cbs);

      // Flag is cleared synchronously, not in microtask
      expect(entry.pendingAutoModeContinuation).toBe(false);
    });
  });

  describe('auto mode continuation NOT triggered for non-review turns', () => {
    it('does NOT schedule continuation for a non-hidden turn when flag is set', async () => {
      // This tests the bug: non-hidden turns should NOT consume
      // pendingAutoModeContinuation. The flag is only for the review turn handler.
      const entry = makeEntry({
        pendingAutoModeContinuation: true,
        activeHiddenTurnCustomType: null, // not a hidden review turn
      });
      const cbs = makeCallbacks();

      handleLiveSessionEvent(entry, { type: 'turn_end' } as any, cbs);

      await new Promise((resolve) => queueMicrotask(resolve));

      // Should NOT schedule continuation - flag is only for review turn
      expect(cbs.requestConversationAutoModeContinuationTurn).not.toHaveBeenCalled();
    });
  });
});
