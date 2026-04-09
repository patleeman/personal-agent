import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pingDaemonMock, startDaemonDetachedMock } = vi.hoisted(() => ({
  pingDaemonMock: vi.fn(),
  startDaemonDetachedMock: vi.fn(),
}));

vi.mock('@personal-agent/daemon', () => ({
  pingDaemon: pingDaemonMock,
  startDaemonDetached: startDaemonDetachedMock,
}));

import { ensureDaemonAvailable } from './daemonToolUtils.js';

describe('ensureDaemonAvailable', () => {
  beforeEach(() => {
    pingDaemonMock.mockReset();
    startDaemonDetachedMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately when the daemon is already reachable', async () => {
    pingDaemonMock.mockResolvedValue(true);

    await expect(ensureDaemonAvailable()).resolves.toBeUndefined();

    expect(startDaemonDetachedMock).not.toHaveBeenCalled();
    expect(pingDaemonMock).toHaveBeenCalledTimes(1);
  });

  it('starts the daemon and waits until it responds', async () => {
    vi.useFakeTimers();
    pingDaemonMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const promise = ensureDaemonAvailable();
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(startDaemonDetachedMock).toHaveBeenCalledTimes(1);
    expect(pingDaemonMock).toHaveBeenCalledTimes(3);
  });

  it('throws when the daemon never becomes reachable', async () => {
    vi.useFakeTimers();
    pingDaemonMock.mockResolvedValue(false);

    const result = ensureDaemonAvailable().then(
      () => null,
      (error) => error,
    );
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual(expect.objectContaining({
      message: 'Daemon did not become available. Start it with: pa daemon start',
    }));
    expect(startDaemonDetachedMock).toHaveBeenCalledTimes(1);
    expect(pingDaemonMock).toHaveBeenCalledTimes(21);
  });
});
