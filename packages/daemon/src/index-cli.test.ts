import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runDaemonProcess: vi.fn(),
}));

vi.mock('./server.js', () => ({
  runDaemonProcess: mocks.runDaemonProcess,
}));

import { runDaemonCli } from './index.js';

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.resetModules();
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

  it('does not auto-run when imported without an entry file', async () => {
    process.argv = ['node'];

    await import('./index.js');

    expect(mocks.runDaemonProcess).not.toHaveBeenCalled();
  });

  it('logs startup failures and exits when invoked as the entry module', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    mocks.runDaemonProcess.mockRejectedValue(new Error('socket bind failed'));
    process.argv = ['node', fileURLToPath(new URL('./index.ts', import.meta.url))];

    await import('./index.js');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocks.runDaemonProcess).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('socket bind failed');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
