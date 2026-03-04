import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runDaemonProcess: vi.fn(),
}));

vi.mock('./server.js', () => ({
  runDaemonProcess: mocks.runDaemonProcess,
}));

import { runDaemonCli } from './index.js';

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('runDaemonCli', () => {
  it('prints help and exits with code 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(runDaemonCli(['--help'])).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith('personal-agentd\n\nRuns the personal-agent daemon in the foreground.');
    expect(mocks.runDaemonProcess).not.toHaveBeenCalled();
  });

  it('starts daemon process when no help flag is provided', async () => {
    mocks.runDaemonProcess.mockResolvedValue(undefined);

    await expect(runDaemonCli([])).resolves.toBe(0);

    expect(mocks.runDaemonProcess).toHaveBeenCalledTimes(1);
  });

  it('propagates daemon startup failures', async () => {
    mocks.runDaemonProcess.mockRejectedValue(new Error('socket bind failed'));

    await expect(runDaemonCli([])).rejects.toThrow('socket bind failed');
  });
});
