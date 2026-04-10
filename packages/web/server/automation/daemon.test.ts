import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDaemonStatusMock,
  getManagedDaemonServiceStatusMock,
  installManagedDaemonServiceMock,
  loadDaemonConfigMock,
  pingDaemonMock,
  resolveDaemonPathsMock,
  restartManagedDaemonServiceIfInstalledMock,
  startManagedDaemonServiceMock,
  stopManagedDaemonServiceMock,
  uninstallManagedDaemonServiceMock,
} = vi.hoisted(() => ({
  getDaemonStatusMock: vi.fn(),
  getManagedDaemonServiceStatusMock: vi.fn(),
  installManagedDaemonServiceMock: vi.fn(),
  loadDaemonConfigMock: vi.fn(),
  pingDaemonMock: vi.fn(),
  resolveDaemonPathsMock: vi.fn(),
  restartManagedDaemonServiceIfInstalledMock: vi.fn(),
  startManagedDaemonServiceMock: vi.fn(),
  stopManagedDaemonServiceMock: vi.fn(),
  uninstallManagedDaemonServiceMock: vi.fn(),
}));

vi.mock('@personal-agent/daemon', () => ({
  getDaemonStatus: getDaemonStatusMock,
  loadDaemonConfig: loadDaemonConfigMock,
  pingDaemon: pingDaemonMock,
  resolveDaemonPaths: resolveDaemonPathsMock,
}));

vi.mock('@personal-agent/services', () => ({
  getManagedDaemonServiceStatus: getManagedDaemonServiceStatusMock,
  installManagedDaemonService: installManagedDaemonServiceMock,
  restartManagedDaemonServiceIfInstalled: restartManagedDaemonServiceIfInstalledMock,
  startManagedDaemonService: startManagedDaemonServiceMock,
  stopManagedDaemonService: stopManagedDaemonServiceMock,
  uninstallManagedDaemonService: uninstallManagedDaemonServiceMock,
}));

import {
  installDaemonServiceAndReadState,
  readDaemonState,
  restartDaemonServiceAndReadState,
  startDaemonServiceAndReadState,
  stopDaemonServiceAndReadState,
  uninstallDaemonServiceAndReadState,
} from './daemon.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-daemon-state-'));
  tempDirs.push(dir);
  return dir;
}

function expectedServicePlatform(): string {
  if (process.platform === 'darwin') {
    return 'launchd';
  }

  if (process.platform === 'linux') {
    return 'systemd';
  }

  return process.platform;
}

describe('automation daemon', () => {
  afterEach(async () => {
    process.env = originalEnv;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    getDaemonStatusMock.mockReset();
    getManagedDaemonServiceStatusMock.mockReset();
    installManagedDaemonServiceMock.mockReset();
    loadDaemonConfigMock.mockReset();
    pingDaemonMock.mockReset();
    resolveDaemonPathsMock.mockReset();
    restartManagedDaemonServiceIfInstalledMock.mockReset();
    startManagedDaemonServiceMock.mockReset();
    stopManagedDaemonServiceMock.mockReset();
    uninstallManagedDaemonServiceMock.mockReset();
  });

  it('reads healthy daemon state and filters removed sync log lines', async () => {
    const dir = createTempDir();
    const logFile = join(dir, 'personal-agentd.log');
    writeFileSync(logFile, 'line one\n[module:sync] hidden\nline two\n', 'utf-8');

    loadDaemonConfigMock.mockReturnValue({ ipc: { socketPath: join(dir, 'daemon.sock') } });
    resolveDaemonPathsMock.mockReturnValue({ root: dir, socketPath: '/tmp/runtime.sock', logFile });
    getManagedDaemonServiceStatusMock.mockReturnValue({
      identifier: 'personal-agent-daemon',
      manifestPath: '/tmp/personal-agent-daemon.plist',
      installed: true,
      running: true,
      logFile,
    });
    pingDaemonMock.mockResolvedValue(true);
    getDaemonStatusMock.mockResolvedValue({
      socketPath: '/tmp/runtime.sock',
      pid: 42,
      startedAt: '2026-04-10T00:00:00.000Z',
      modules: [{ id: 'tasks' }, { id: 'runs' }],
      queue: { currentDepth: 2, maxDepth: 5 },
    });

    await expect(readDaemonState()).resolves.toEqual({
      warnings: [],
      service: {
        platform: expectedServicePlatform(),
        identifier: 'personal-agent-daemon',
        manifestPath: '/tmp/personal-agent-daemon.plist',
        installed: true,
        running: true,
        logFile,
      },
      runtime: {
        running: true,
        socketPath: '/tmp/runtime.sock',
        pid: 42,
        startedAt: '2026-04-10T00:00:00.000Z',
        moduleCount: 2,
        queueDepth: 2,
        maxQueueDepth: 5,
      },
      log: {
        path: logFile,
        lines: ['line one', 'line two'],
      },
    });
  });

  it('reports offline daemon warnings when the installed service is stopped', async () => {
    const dir = createTempDir();
    const logFile = join(dir, 'personal-agentd.log');

    loadDaemonConfigMock.mockReturnValue({ ipc: { socketPath: join(dir, 'daemon.sock') } });
    resolveDaemonPathsMock.mockReturnValue({ root: dir, socketPath: '/tmp/runtime.sock', logFile });
    getManagedDaemonServiceStatusMock.mockReturnValue({
      identifier: 'personal-agent-daemon',
      manifestPath: '/tmp/personal-agent-daemon.plist',
      installed: true,
      running: false,
    });
    pingDaemonMock.mockResolvedValue(false);

    await expect(readDaemonState()).resolves.toEqual({
      warnings: [
        'Daemon service is installed but not running.',
        'Daemon runtime is not responding on the local socket.',
      ],
      service: {
        platform: expectedServicePlatform(),
        identifier: 'personal-agent-daemon',
        manifestPath: '/tmp/personal-agent-daemon.plist',
        installed: true,
        running: false,
        logFile,
      },
      runtime: {
        running: false,
        socketPath: '/tmp/runtime.sock',
        moduleCount: 0,
      },
      log: {
        path: logFile,
        lines: [],
      },
    });
  });

  it('reports inspection failures and tolerates unreadable log files', async () => {
    const dir = createTempDir();
    const unreadableLogPath = join(dir, 'logs');
    mkdirSync(unreadableLogPath);

    loadDaemonConfigMock.mockReturnValue({ ipc: { socketPath: join(dir, 'daemon.sock') } });
    resolveDaemonPathsMock.mockReturnValue({ root: dir, socketPath: '/tmp/runtime.sock', logFile: unreadableLogPath });
    getManagedDaemonServiceStatusMock.mockImplementation(() => {
      throw new Error('service failed');
    });
    pingDaemonMock.mockRejectedValue(new Error('runtime failed'));

    await expect(readDaemonState()).resolves.toEqual({
      warnings: [
        'Could not inspect daemon service status: service failed',
        'Could not inspect daemon runtime: runtime failed',
      ],
      service: {
        platform: expectedServicePlatform(),
        identifier: 'personal-agent-daemon',
        manifestPath: '',
        installed: false,
        running: false,
        logFile: unreadableLogPath,
        error: 'service failed',
      },
      runtime: {
        running: false,
        socketPath: '/tmp/runtime.sock',
        moduleCount: 0,
      },
      log: {
        path: unreadableLogPath,
        lines: [],
      },
    });
  });

  it('reports the daemon as desktop-owned in desktop runtime mode', async () => {
    const dir = createTempDir();
    process.env.PERSONAL_AGENT_DESKTOP_RUNTIME = '1';
    process.env.PERSONAL_AGENT_DESKTOP_DAEMON_LOG_FILE = join(dir, 'desktop-daemon.log');

    loadDaemonConfigMock.mockReturnValue({ ipc: { socketPath: join(dir, 'daemon.sock') } });
    resolveDaemonPathsMock.mockReturnValue({ root: dir, socketPath: '/tmp/runtime.sock', logFile: join(dir, 'ignored.log') });
    pingDaemonMock.mockResolvedValue(false);

    await expect(readDaemonState()).resolves.toEqual({
      warnings: ['Daemon runtime is not responding on the local socket.'],
      service: {
        platform: 'desktop',
        identifier: 'desktop-local-daemon',
        manifestPath: 'desktop menubar runtime',
        installed: true,
        running: true,
        logFile: join(dir, 'desktop-daemon.log'),
      },
      runtime: {
        running: false,
        socketPath: '/tmp/runtime.sock',
        moduleCount: 0,
      },
      log: {
        path: join(dir, 'desktop-daemon.log'),
        lines: [],
      },
    });
  });

  it('rejects daemon managed service lifecycle actions in desktop runtime mode', async () => {
    process.env.PERSONAL_AGENT_DESKTOP_RUNTIME = '1';

    await expect(installDaemonServiceAndReadState()).rejects.toThrow(
      'Managed daemon service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local daemon runtime.',
    );
    await expect(startDaemonServiceAndReadState()).rejects.toThrow(
      'Managed daemon service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local daemon runtime.',
    );
    await expect(restartDaemonServiceAndReadState()).rejects.toThrow(
      'Managed daemon service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local daemon runtime.',
    );
    await expect(stopDaemonServiceAndReadState()).rejects.toThrow(
      'Managed daemon service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local daemon runtime.',
    );
    await expect(uninstallDaemonServiceAndReadState()).rejects.toThrow(
      'Managed daemon service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local daemon runtime.',
    );

    expect(installManagedDaemonServiceMock).not.toHaveBeenCalled();
    expect(startManagedDaemonServiceMock).not.toHaveBeenCalled();
    expect(restartManagedDaemonServiceIfInstalledMock).not.toHaveBeenCalled();
    expect(stopManagedDaemonServiceMock).not.toHaveBeenCalled();
    expect(uninstallManagedDaemonServiceMock).not.toHaveBeenCalled();
  });

  it('runs daemon lifecycle actions and rejects restart when the service is not installed', async () => {
    const dir = createTempDir();
    const logFile = join(dir, 'personal-agentd.log');
    writeFileSync(logFile, 'daemon ready\n', 'utf-8');

    loadDaemonConfigMock.mockReturnValue({ ipc: { socketPath: join(dir, 'daemon.sock') } });
    resolveDaemonPathsMock.mockReturnValue({ root: dir, socketPath: '/tmp/runtime.sock', logFile });
    getManagedDaemonServiceStatusMock.mockReturnValue({
      identifier: 'personal-agent-daemon',
      manifestPath: '/tmp/personal-agent-daemon.plist',
      installed: true,
      running: true,
      logFile,
    });
    pingDaemonMock.mockResolvedValue(true);
    getDaemonStatusMock.mockResolvedValue({
      socketPath: '/tmp/runtime.sock',
      pid: 99,
      startedAt: '2026-04-10T00:00:00.000Z',
      modules: [{ id: 'tasks' }],
      queue: { currentDepth: 1, maxDepth: 3 },
    });
    restartManagedDaemonServiceIfInstalledMock.mockReturnValueOnce(true).mockReturnValueOnce(false);

    await installDaemonServiceAndReadState();
    expect(installManagedDaemonServiceMock).toHaveBeenCalledTimes(1);

    await startDaemonServiceAndReadState();
    expect(startManagedDaemonServiceMock).toHaveBeenCalledTimes(1);

    await restartDaemonServiceAndReadState();
    expect(restartManagedDaemonServiceIfInstalledMock).toHaveBeenCalledTimes(1);

    await stopDaemonServiceAndReadState();
    expect(stopManagedDaemonServiceMock).toHaveBeenCalledTimes(1);

    await uninstallDaemonServiceAndReadState();
    expect(uninstallManagedDaemonServiceMock).toHaveBeenCalledTimes(1);

    await expect(restartDaemonServiceAndReadState()).rejects.toThrow('Daemon service is not installed. Install it from this page or run `pa daemon service install`.');
    expect(restartManagedDaemonServiceIfInstalledMock).toHaveBeenCalledTimes(2);
  });
});
