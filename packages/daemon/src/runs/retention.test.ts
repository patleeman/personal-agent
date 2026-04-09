import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  existsSyncMock,
  rmSyncMock,
  deleteDurableRunRecordsMock,
  loadDurableRunStatusMock,
  listDurableRunIdsMock,
  resolveDurableRunPathsMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  rmSyncMock: vi.fn(),
  deleteDurableRunRecordsMock: vi.fn(),
  loadDurableRunStatusMock: vi.fn(),
  listDurableRunIdsMock: vi.fn(),
  resolveDurableRunPathsMock: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  rmSync: rmSyncMock,
}));

vi.mock('./store.js', () => ({
  deleteDurableRunRecords: deleteDurableRunRecordsMock,
  loadDurableRunStatus: loadDurableRunStatusMock,
  listDurableRunIds: listDurableRunIdsMock,
  resolveDurableRunPaths: resolveDurableRunPathsMock,
}));

import {
  cleanupRetentionEligibleRuns,
  getRetentionConfig,
  getRetentionEligibleRuns,
  isRetentionEligible,
} from './retention.js';

describe('durable run retention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:00:00.000Z'));
    existsSyncMock.mockReset();
    rmSyncMock.mockReset();
    deleteDurableRunRecordsMock.mockReset();
    loadDurableRunStatusMock.mockReset();
    listDurableRunIdsMock.mockReset();
    resolveDurableRunPathsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts only terminal runs older than the retention window', () => {
    loadDurableRunStatusMock.mockReturnValueOnce(undefined);
    expect(isRetentionEligible('/runs', 'missing')).toBe(false);

    loadDurableRunStatusMock.mockReturnValueOnce({ status: 'running', completedAt: '2026-03-01T00:00:00.000Z' });
    expect(isRetentionEligible('/runs', 'running')).toBe(false);

    loadDurableRunStatusMock.mockReturnValueOnce({ status: 'completed' });
    expect(isRetentionEligible('/runs', 'no-completed-at')).toBe(false);

    loadDurableRunStatusMock.mockReturnValueOnce({ status: 'completed', completedAt: '2026-03-20T00:00:00.000Z' });
    expect(isRetentionEligible('/runs', 'fresh')).toBe(false);

    loadDurableRunStatusMock.mockReturnValueOnce({ status: 'failed', completedAt: '2026-03-01T00:00:00.000Z' });
    expect(isRetentionEligible('/runs', 'stale')).toBe(true);
  });

  it('lists only eligible runs when the runs root exists', () => {
    existsSyncMock.mockReturnValue(true);
    listDurableRunIdsMock.mockReturnValue(['run-a', 'run-b']);
    loadDurableRunStatusMock
      .mockReturnValueOnce({ status: 'completed', completedAt: '2026-03-01T00:00:00.000Z' })
      .mockReturnValueOnce({ status: 'running', completedAt: '2026-03-01T00:00:00.000Z' });

    expect(getRetentionEligibleRuns('/runs')).toEqual(['run-a']);
  });

  it('returns an empty list when the runs root is missing', () => {
    existsSyncMock.mockReturnValue(false);

    expect(getRetentionEligibleRuns('/runs')).toEqual([]);
    expect(listDurableRunIdsMock).not.toHaveBeenCalled();
  });

  it('cleans up eligible runs and ignores per-run removal failures', () => {
    existsSyncMock.mockReturnValue(true);
    listDurableRunIdsMock.mockReturnValue(['run-a', 'run-b']);
    loadDurableRunStatusMock
      .mockReturnValueOnce({ status: 'completed', completedAt: '2026-03-01T00:00:00.000Z' })
      .mockReturnValueOnce({ status: 'failed', completedAt: '2026-03-02T00:00:00.000Z' });
    resolveDurableRunPathsMock
      .mockReturnValueOnce({ root: '/runs/run-a' })
      .mockReturnValueOnce({ root: '/runs/run-b' });
    rmSyncMock.mockImplementationOnce(() => undefined).mockImplementationOnce(() => {
      throw new Error('disk busy');
    });

    expect(cleanupRetentionEligibleRuns('/runs')).toBe(1);
    expect(deleteDurableRunRecordsMock).toHaveBeenCalledTimes(1);
    expect(deleteDurableRunRecordsMock).toHaveBeenCalledWith('/runs', ['run-a']);
  });

  it('returns the retention configuration', () => {
    expect(getRetentionConfig()).toEqual({
      retentionDays: 30,
      retentionMs: 30 * 24 * 60 * 60 * 1000,
    });
  });
});
