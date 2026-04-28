import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelDurableRunMock,
  clearDurableRunsListCacheMock,
  getDurableRunMock,
  getDurableRunAttentionSignatureMock,
  getDurableRunLogMock,
  invalidateAppTopicsMock,
  listDurableRunsMock,
  markDurableRunAttentionReadMock,
  markDurableRunAttentionUnreadMock,
} = vi.hoisted(() => ({
  cancelDurableRunMock: vi.fn(),
  clearDurableRunsListCacheMock: vi.fn(),
  getDurableRunMock: vi.fn(),
  getDurableRunAttentionSignatureMock: vi.fn(),
  getDurableRunLogMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  listDurableRunsMock: vi.fn(),
  markDurableRunAttentionReadMock: vi.fn(),
  markDurableRunAttentionUnreadMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  markDurableRunAttentionRead: markDurableRunAttentionReadMock,
  markDurableRunAttentionUnread: markDurableRunAttentionUnreadMock,
}));

vi.mock('./durableRuns.js', () => ({
  cancelDurableRun: cancelDurableRunMock,
  clearDurableRunsListCache: clearDurableRunsListCacheMock,
  getDurableRun: getDurableRunMock,
  getDurableRunLog: getDurableRunLogMock,
  listDurableRuns: listDurableRunsMock,
}));

vi.mock('./durableRunAttention.js', () => ({
  getDurableRunAttentionSignature: getDurableRunAttentionSignatureMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

import {
  DurableRunCapabilityInputError,
  cancelDurableRunCapability,
  listDurableRunsCapability,
  markDurableRunAttentionCapability,
  readDurableRunCapability,
  readDurableRunLogCapability,
} from './durableRunCapability.js';

beforeEach(() => {
  cancelDurableRunMock.mockReset();
  clearDurableRunsListCacheMock.mockReset();
  getDurableRunMock.mockReset();
  getDurableRunAttentionSignatureMock.mockReset();
  getDurableRunLogMock.mockReset();
  invalidateAppTopicsMock.mockReset();
  listDurableRunsMock.mockReset();
  markDurableRunAttentionReadMock.mockReset();
  markDurableRunAttentionUnreadMock.mockReset();
});

describe('durableRunCapability', () => {
  it('lists runs', async () => {
    listDurableRunsMock.mockResolvedValue({ runs: [{ runId: 'run-1' }] });

    await expect(listDurableRunsCapability()).resolves.toEqual({ runs: [{ runId: 'run-1' }] });
    expect(listDurableRunsMock).toHaveBeenCalledTimes(1);
  });

  it('reads durable run details and validates the id', async () => {
    getDurableRunMock
      .mockResolvedValueOnce({ run: { runId: 'run-1' } })
      .mockResolvedValueOnce(undefined);

    await expect(readDurableRunCapability('run-1')).resolves.toEqual({ run: { runId: 'run-1' } });
    await expect(readDurableRunCapability('   ')).rejects.toThrow(new DurableRunCapabilityInputError('runId required'));
    await expect(readDurableRunCapability('missing')).rejects.toThrow('Run not found');
  });

  it('reads durable run logs with tail normalization', async () => {
    getDurableRunLogMock.mockResolvedValue({ path: '/tmp/run-1.log', log: 'tail' });

    await expect(readDurableRunLogCapability({ runId: 'run-1', tail: 25 })).resolves.toEqual({ path: '/tmp/run-1.log', log: 'tail' });
    expect(getDurableRunLogMock).toHaveBeenCalledWith('run-1', 25);

    await expect(readDurableRunLogCapability({ runId: 'run-1', tail: 0 })).resolves.toEqual({ path: '/tmp/run-1.log', log: 'tail' });
    expect(getDurableRunLogMock).toHaveBeenCalledWith('run-1', 120);

    await expect(readDurableRunLogCapability({ runId: 'run-1', tail: Number.MAX_SAFE_INTEGER + 1 })).resolves.toEqual({ path: '/tmp/run-1.log', log: 'tail' });
    expect(getDurableRunLogMock).toHaveBeenLastCalledWith('run-1', 120);

    await expect(readDurableRunLogCapability({ runId: 'run-1', tail: 5000 })).resolves.toEqual({ path: '/tmp/run-1.log', log: 'tail' });
    expect(getDurableRunLogMock).toHaveBeenLastCalledWith('run-1', 1000);
  });

  it('cancels durable runs and validates the id', async () => {
    cancelDurableRunMock.mockResolvedValue({ cancelled: true, runId: 'run-1' });

    await expect(cancelDurableRunCapability('run-1')).resolves.toEqual({ cancelled: true, runId: 'run-1' });
    expect(cancelDurableRunMock).toHaveBeenCalledWith('run-1');
    await expect(cancelDurableRunCapability('')).rejects.toThrow(new DurableRunCapabilityInputError('runId required'));
  });

  it('marks durable run attention read or unread and invalidates runs', async () => {
    getDurableRunMock.mockResolvedValue({ run: { runId: 'run-1' } });
    getDurableRunAttentionSignatureMock.mockReturnValue('sig-1');

    await expect(markDurableRunAttentionCapability({ runId: 'run-1' })).resolves.toEqual({ ok: true });
    expect(markDurableRunAttentionReadMock).toHaveBeenCalledWith({ runId: 'run-1', attentionSignature: 'sig-1' });
    expect(markDurableRunAttentionUnreadMock).not.toHaveBeenCalled();
    expect(clearDurableRunsListCacheMock).toHaveBeenCalledTimes(1);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('runs');

    clearDurableRunsListCacheMock.mockClear();
    invalidateAppTopicsMock.mockClear();
    markDurableRunAttentionReadMock.mockClear();

    await expect(markDurableRunAttentionCapability({ runId: 'run-1', read: false })).resolves.toEqual({ ok: true });
    expect(markDurableRunAttentionUnreadMock).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(markDurableRunAttentionReadMock).not.toHaveBeenCalled();
    expect(clearDurableRunsListCacheMock).toHaveBeenCalledTimes(1);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('runs');
  });

  it('fails when marking attention for a missing run', async () => {
    getDurableRunMock.mockResolvedValue(undefined);

    await expect(markDurableRunAttentionCapability({ runId: 'missing' })).rejects.toThrow('Run not found');
    await expect(markDurableRunAttentionCapability({ runId: '' })).rejects.toThrow(new DurableRunCapabilityInputError('runId required'));
  });
});
