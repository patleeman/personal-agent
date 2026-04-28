import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  existsSyncMock,
  openSyncMock,
  readFileSyncMock,
  spawnMock,
  loadDaemonConfigMock,
  pingDaemonMock,
  stopDaemonMock,
  getDaemonStatusMock,
  ensureDaemonDirectoriesMock,
  resolveDaemonPathsMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  openSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  spawnMock: vi.fn(),
  loadDaemonConfigMock: vi.fn(),
  pingDaemonMock: vi.fn(),
  stopDaemonMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  ensureDaemonDirectoriesMock: vi.fn(),
  resolveDaemonPathsMock: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  openSync: openSyncMock,
  readFileSync: readFileSyncMock,
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('./config.js', () => ({
  loadDaemonConfig: loadDaemonConfigMock,
}));

vi.mock('./client.js', () => ({
  pingDaemon: pingDaemonMock,
  stopDaemon: stopDaemonMock,
  getDaemonStatus: getDaemonStatusMock,
}));

vi.mock('./paths.js', () => ({
  ensureDaemonDirectories: ensureDaemonDirectoriesMock,
  resolveDaemonPaths: resolveDaemonPathsMock,
}));

import {
  daemonStatusJson,
  readDaemonPid,
  startDaemonDetached,
  stopDaemonGracefully,
} from './manage.js';

describe('daemon manage helpers', () => {
  const originalDesktopRuntime = process.env.PERSONAL_AGENT_DESKTOP_RUNTIME;

  beforeEach(() => {
    delete process.env.PERSONAL_AGENT_DESKTOP_RUNTIME;
    existsSyncMock.mockReset();
    openSyncMock.mockReset();
    readFileSyncMock.mockReset();
    spawnMock.mockReset();
    loadDaemonConfigMock.mockReset();
    pingDaemonMock.mockReset();
    stopDaemonMock.mockReset();
    getDaemonStatusMock.mockReset();
    ensureDaemonDirectoriesMock.mockReset();
    resolveDaemonPathsMock.mockReset();

    loadDaemonConfigMock.mockReturnValue({ ipc: { socketPath: '/tmp/daemon.sock' } });
    resolveDaemonPathsMock.mockReturnValue({
      logFile: '/tmp/daemon.log',
      pidFile: '/tmp/daemon.pid',
    });
    existsSyncMock.mockImplementation((path: string) => path.endsWith('/index.js'));
    openSyncMock.mockReturnValue(42);
  });

  afterEach(() => {
    if (originalDesktopRuntime === undefined) {
      delete process.env.PERSONAL_AGENT_DESKTOP_RUNTIME;
    } else {
      process.env.PERSONAL_AGENT_DESKTOP_RUNTIME = originalDesktopRuntime;
    }
  });

  it('does not respawn the daemon when it is already reachable', async () => {
    pingDaemonMock.mockResolvedValue(true);

    await startDaemonDetached();

    expect(ensureDaemonDirectoriesMock).toHaveBeenCalledWith({
      logFile: '/tmp/daemon.log',
      pidFile: '/tmp/daemon.pid',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns a detached foreground daemon when it is not running', async () => {
    const child = { unref: vi.fn() };
    pingDaemonMock.mockResolvedValue(false);
    spawnMock.mockReturnValue(child);

    await startDaemonDetached();

    expect(openSyncMock).toHaveBeenCalledWith('/tmp/daemon.log', 'a');
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringMatching(/index\.js$/), '--foreground'],
      {
        detached: true,
        env: expect.any(Object),
        stdio: ['ignore', 42, 42],
      },
    );
    expect(spawnMock.mock.calls[0]?.[2]?.env?.PERSONAL_AGENT_DESKTOP_RUNTIME).toBeUndefined();
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('stops the daemon only when it is reachable', async () => {
    pingDaemonMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await stopDaemonGracefully();
    await stopDaemonGracefully();

    expect(stopDaemonMock).toHaveBeenCalledTimes(1);
    expect(stopDaemonMock).toHaveBeenCalledWith({ ipc: { socketPath: '/tmp/daemon.sock' } });
  });

  it('reads a valid daemon pid from disk', async () => {
    existsSyncMock.mockImplementation((path: string) => path === '/tmp/daemon.pid');
    readFileSyncMock.mockReturnValue('1234\n');

    await expect(readDaemonPid()).resolves.toBe(1234);
  });

  it('returns undefined when the pid file is missing or invalid', async () => {
    existsSyncMock.mockReturnValueOnce(false);
    await expect(readDaemonPid()).resolves.toBeUndefined();

    existsSyncMock.mockReturnValueOnce(true);
    readFileSyncMock.mockReturnValueOnce('not-a-number');
    await expect(readDaemonPid()).resolves.toBeUndefined();
  });

  it('renders a minimal status payload when the daemon is offline', async () => {
    pingDaemonMock.mockResolvedValue(false);

    await expect(daemonStatusJson()).resolves.toBe(JSON.stringify({ running: false }, null, 2));
    expect(getDaemonStatusMock).not.toHaveBeenCalled();
  });

  it('renders the full daemon status payload when the daemon is online', async () => {
    pingDaemonMock.mockResolvedValue(true);
    getDaemonStatusMock.mockResolvedValue({
      running: true,
      pid: 1234,
    });

    await expect(daemonStatusJson()).resolves.toBe(JSON.stringify({
      running: true,
      pid: 1234,
    }, null, 2));
    expect(getDaemonStatusMock).toHaveBeenCalledWith({ ipc: { socketPath: '/tmp/daemon.sock' } });
  });
});
