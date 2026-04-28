import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createWebLiveConversationRunIdMock,
  listRecoverableWebLiveConversationRunsFromDaemonMock,
  listRecoverableWebLiveConversationRunsLocalMock,
  pingDaemonMock,
  saveWebLiveConversationRunStateMock,
  syncWebLiveConversationRunStateMock,
} = vi.hoisted(() => ({
  createWebLiveConversationRunIdMock: vi.fn((conversationId: string) => `conversation-live-${conversationId}`),
  listRecoverableWebLiveConversationRunsFromDaemonMock: vi.fn(),
  listRecoverableWebLiveConversationRunsLocalMock: vi.fn(),
  pingDaemonMock: vi.fn(),
  saveWebLiveConversationRunStateMock: vi.fn(),
  syncWebLiveConversationRunStateMock: vi.fn(),
}));

vi.mock('@personal-agent/daemon', () => ({
  createWebLiveConversationRunId: createWebLiveConversationRunIdMock,
  listRecoverableWebLiveConversationRuns: listRecoverableWebLiveConversationRunsLocalMock,
  listRecoverableWebLiveConversationRunsFromDaemon: listRecoverableWebLiveConversationRunsFromDaemonMock,
  pingDaemon: pingDaemonMock,
  saveWebLiveConversationRunState: saveWebLiveConversationRunStateMock,
  syncWebLiveConversationRunState: syncWebLiveConversationRunStateMock,
}));

import {
  createWebLiveConversationRunId,
  listRecoverableWebLiveConversationRuns,
  syncWebLiveConversationRun,
} from './conversationRuns.js';

describe('conversationRuns daemon fallback', () => {
  beforeEach(() => {
    createWebLiveConversationRunIdMock.mockClear();
    listRecoverableWebLiveConversationRunsFromDaemonMock.mockReset();
    listRecoverableWebLiveConversationRunsLocalMock.mockReset();
    pingDaemonMock.mockReset();
    saveWebLiveConversationRunStateMock.mockReset();
    syncWebLiveConversationRunStateMock.mockReset();
  });

  it('re-exports live conversation run id creation', () => {
    expect(createWebLiveConversationRunId('conv-123')).toBe('conversation-live-conv-123');
    expect(createWebLiveConversationRunIdMock).toHaveBeenCalledWith('conv-123');
  });

  it('syncs through the daemon when available and normalizes the payload', async () => {
    pingDaemonMock.mockResolvedValue(true);
    syncWebLiveConversationRunStateMock.mockResolvedValue({ runId: 'run-daemon' });

    await expect(syncWebLiveConversationRun({
      conversationId: 'conv-123',
      sessionFile: '/tmp/conv-123.jsonl',
      cwd: '/tmp/workspace',
      title: 'Investigate issue',
      profile: 'assistant',
      state: 'running',
      updatedAt: new Date('2026-03-12T13:00:05.000Z'),
      lastError: 'transient',
      pendingOperation: {
        type: 'prompt',
        text: 'continue',
        enqueuedAt: '2026-03-12T13:00:05.000Z',
      },
    })).resolves.toEqual({ runId: 'run-daemon' });

    expect(syncWebLiveConversationRunStateMock).toHaveBeenCalledWith({
      conversationId: 'conv-123',
      sessionFile: '/tmp/conv-123.jsonl',
      cwd: '/tmp/workspace',
      title: 'Investigate issue',
      profile: 'assistant',
      state: 'running',
      updatedAt: '2026-03-12T13:00:05.000Z',
      lastError: 'transient',
      pendingOperation: {
        type: 'prompt',
        text: 'continue',
        enqueuedAt: '2026-03-12T13:00:05.000Z',
      },
    });
    expect(saveWebLiveConversationRunStateMock).not.toHaveBeenCalled();
  });

  it('omits malformed updatedAt values when syncing live conversation runs', async () => {
    pingDaemonMock.mockResolvedValue(true);
    syncWebLiveConversationRunStateMock.mockResolvedValue({ runId: 'run-daemon' });

    await expect(syncWebLiveConversationRun({
      conversationId: 'conv-invalid-time',
      sessionFile: '/tmp/conv-invalid-time.jsonl',
      cwd: '/tmp/workspace',
      state: 'running',
      updatedAt: 'not-a-date',
    })).resolves.toEqual({ runId: 'run-daemon' });

    expect(syncWebLiveConversationRunStateMock).toHaveBeenCalledWith({
      conversationId: 'conv-invalid-time',
      sessionFile: '/tmp/conv-invalid-time.jsonl',
      cwd: '/tmp/workspace',
      state: 'running',
    });
  });

  it('falls back to local persistence when the daemon is unavailable', async () => {
    saveWebLiveConversationRunStateMock.mockResolvedValue({ runId: 'run-local' });

    pingDaemonMock.mockResolvedValueOnce(false);
    await expect(syncWebLiveConversationRun({
      conversationId: 'conv-124',
      sessionFile: '/tmp/conv-124.jsonl',
      cwd: '/tmp/workspace',
      state: 'waiting',
    })).resolves.toEqual({ runId: 'run-local' });

    pingDaemonMock.mockRejectedValueOnce(new Error('ECONNREFUSED: daemon unavailable'));
    await expect(syncWebLiveConversationRun({
      conversationId: 'conv-125',
      sessionFile: '/tmp/conv-125.jsonl',
      cwd: '/tmp/workspace',
      state: 'waiting',
      updatedAt: '2026-03-12T13:00:10.000Z',
    })).resolves.toEqual({ runId: 'run-local' });

    expect(saveWebLiveConversationRunStateMock).toHaveBeenNthCalledWith(1, {
      conversationId: 'conv-124',
      sessionFile: '/tmp/conv-124.jsonl',
      cwd: '/tmp/workspace',
      state: 'waiting',
    });
    expect(saveWebLiveConversationRunStateMock).toHaveBeenNthCalledWith(2, {
      conversationId: 'conv-125',
      sessionFile: '/tmp/conv-125.jsonl',
      cwd: '/tmp/workspace',
      state: 'waiting',
      updatedAt: '2026-03-12T13:00:10.000Z',
    });
  });

  it('rethrows unexpected daemon errors during sync', async () => {
    pingDaemonMock.mockRejectedValue(new Error('permission denied'));

    await expect(syncWebLiveConversationRun({
      conversationId: 'conv-126',
      sessionFile: '/tmp/conv-126.jsonl',
      cwd: '/tmp/workspace',
      state: 'waiting',
    })).rejects.toThrow('permission denied');

    expect(saveWebLiveConversationRunStateMock).not.toHaveBeenCalled();
    expect(syncWebLiveConversationRunStateMock).not.toHaveBeenCalled();
  });

  it('lists recoverable runs from the daemon when available', async () => {
    pingDaemonMock.mockResolvedValue(true);
    listRecoverableWebLiveConversationRunsFromDaemonMock.mockResolvedValue({
      runs: [{ runId: 'conversation-live-conv-123', conversationId: 'conv-123' }],
    });

    await expect(listRecoverableWebLiveConversationRuns()).resolves.toEqual([
      { runId: 'conversation-live-conv-123', conversationId: 'conv-123' },
    ]);
    expect(listRecoverableWebLiveConversationRunsLocalMock).not.toHaveBeenCalled();
  });

  it('falls back to local recoverable runs when daemon listing is unavailable', async () => {
    listRecoverableWebLiveConversationRunsLocalMock.mockReturnValue([
      { runId: 'conversation-live-local', conversationId: 'local' },
    ]);

    pingDaemonMock.mockResolvedValueOnce(false);
    await expect(listRecoverableWebLiveConversationRuns()).resolves.toEqual([
      { runId: 'conversation-live-local', conversationId: 'local' },
    ]);

    pingDaemonMock.mockRejectedValueOnce(new Error('unknown request type'));
    await expect(listRecoverableWebLiveConversationRuns()).resolves.toEqual([
      { runId: 'conversation-live-local', conversationId: 'local' },
    ]);
  });

  it('rethrows unexpected daemon errors during listing', async () => {
    pingDaemonMock.mockRejectedValue(new Error('kaboom'));

    await expect(listRecoverableWebLiveConversationRuns()).rejects.toThrow('kaboom');
    expect(listRecoverableWebLiveConversationRunsLocalMock).not.toHaveBeenCalled();
  });
});
