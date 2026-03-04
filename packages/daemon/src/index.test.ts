import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runDaemonProcess: vi.fn(async () => undefined),
}));

vi.mock('./server.js', () => ({
  runDaemonProcess: mocks.runDaemonProcess,
}));

import { runDaemonCli } from './index.js';

describe('runDaemonCli', () => {
  beforeEach(() => {
    mocks.runDaemonProcess.mockClear();
  });

  it('prints help and exits without starting daemon process', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runDaemonCli(['--help']);

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('personal-agentd'));
    expect(mocks.runDaemonProcess).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('starts daemon process when no help flag is provided', async () => {
    const code = await runDaemonCli([]);

    expect(code).toBe(0);
    expect(mocks.runDaemonProcess).toHaveBeenCalledTimes(1);
  });
});
