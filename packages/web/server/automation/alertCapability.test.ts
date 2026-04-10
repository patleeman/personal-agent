import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  acknowledgeAlertForProfileMock,
  dismissAlertForProfileMock,
  getAlertForProfileMock,
  getAlertSnapshotForProfileMock,
  invalidateAppTopicsMock,
  snoozeAlertForProfileMock,
} = vi.hoisted(() => ({
  acknowledgeAlertForProfileMock: vi.fn(),
  dismissAlertForProfileMock: vi.fn(),
  getAlertForProfileMock: vi.fn(),
  getAlertSnapshotForProfileMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  snoozeAlertForProfileMock: vi.fn(),
}));

vi.mock('./alerts.js', () => ({
  acknowledgeAlertForProfile: acknowledgeAlertForProfileMock,
  dismissAlertForProfile: dismissAlertForProfileMock,
  getAlertForProfile: getAlertForProfileMock,
  getAlertSnapshotForProfile: getAlertSnapshotForProfileMock,
  snoozeAlertForProfile: snoozeAlertForProfileMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

import {
  acknowledgeAlertCapability,
  dismissAlertCapability,
  readAlertCapability,
  readAlertSnapshotCapability,
  snoozeAlertCapability,
} from './alertCapability.js';

describe('alertCapability', () => {
  beforeEach(() => {
    acknowledgeAlertForProfileMock.mockReset();
    dismissAlertForProfileMock.mockReset();
    getAlertForProfileMock.mockReset();
    getAlertSnapshotForProfileMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    snoozeAlertForProfileMock.mockReset();
  });

  it('reads alert snapshots and details', () => {
    getAlertSnapshotForProfileMock.mockReturnValue({ entries: [{ id: 'alert-1' }], activeCount: 1 });
    getAlertForProfileMock.mockReturnValue({ id: 'alert-1', title: 'Wake up' });

    expect(readAlertSnapshotCapability('assistant')).toEqual({ entries: [{ id: 'alert-1' }], activeCount: 1 });
    expect(readAlertCapability('assistant', ' alert-1 ')).toEqual({ id: 'alert-1', title: 'Wake up' });
    expect(readAlertCapability('assistant', '   ')).toBeUndefined();

    expect(getAlertSnapshotForProfileMock).toHaveBeenCalledWith('assistant');
    expect(getAlertForProfileMock).toHaveBeenCalledWith('assistant', 'alert-1');
  });

  it('acknowledges and dismisses alerts while invalidating desktop snapshots', () => {
    acknowledgeAlertForProfileMock.mockReturnValue({ id: 'alert-1', status: 'acknowledged' });
    dismissAlertForProfileMock.mockReturnValue(undefined);

    expect(acknowledgeAlertCapability('assistant', 'alert-1')).toEqual({ id: 'alert-1', status: 'acknowledged' });
    expect(dismissAlertCapability('assistant', 'missing')).toBeUndefined();

    expect(acknowledgeAlertForProfileMock).toHaveBeenCalledWith('assistant', 'alert-1');
    expect(dismissAlertForProfileMock).toHaveBeenCalledWith('assistant', 'missing');
    expect(invalidateAppTopicsMock).toHaveBeenCalledTimes(1);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('alerts');
  });

  it('snoozes alerts and invalidates related snapshots when the alert exists', async () => {
    snoozeAlertForProfileMock
      .mockResolvedValueOnce({
        alert: { id: 'alert-1', status: 'acknowledged' },
        resume: { id: 'resume-1', dueAt: '2026-04-10T12:15:00.000Z' },
      })
      .mockResolvedValueOnce(undefined);

    await expect(snoozeAlertCapability('assistant', 'alert-1', { delay: '15m' })).resolves.toEqual({
      alert: { id: 'alert-1', status: 'acknowledged' },
      resume: { id: 'resume-1', dueAt: '2026-04-10T12:15:00.000Z' },
    });
    await expect(snoozeAlertCapability('assistant', 'missing', { delay: '15m' })).resolves.toBeUndefined();

    expect(snoozeAlertForProfileMock).toHaveBeenNthCalledWith(1, 'assistant', 'alert-1', { delay: '15m' });
    expect(snoozeAlertForProfileMock).toHaveBeenNthCalledWith(2, 'assistant', 'missing', { delay: '15m' });
    expect(invalidateAppTopicsMock).toHaveBeenCalledTimes(1);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('alerts', 'sessions', 'runs');
  });
});
