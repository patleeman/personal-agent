/**
 * Tests for trace persistence hooks in liveSessionEventHandling.ts
 *
 * Verifies that persistTraceToolCall and persistTraceCompaction
 * are called with correct arguments when SSE events fire.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the persist functions before importing the handler
const { persistTraceToolCallMock, persistTraceCompactionMock } = vi.hoisted(() => ({
  persistTraceToolCallMock: vi.fn(),
  persistTraceCompactionMock: vi.fn(),
}));

vi.mock('../traces/tracePersistence.js', () => ({
  persistTraceToolCall: persistTraceToolCallMock,
  persistTraceCompaction: persistTraceCompactionMock,
}));

import { handleLiveSessionEvent } from './liveSessionEventHandling.js';

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
    } as any;

    // First fire tool_execution_start to set up the timer
    handleLiveSessionEvent(
      entry,
      {
        type: 'tool_execution_start',
        toolCallId: 'tc-1',
        toolName: 'bash',
        args: {},
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
    expect(call.toolName).toBe('bash');
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
