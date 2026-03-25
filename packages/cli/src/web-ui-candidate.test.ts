import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { childProcessMocks, serviceMocks, daemonMocks, healthMocks } = vi.hoisted(() => ({
  childProcessMocks: {
    spawn: vi.fn(),
    spawnSync: vi.fn(),
  },
  serviceMocks: {
    getManagedDaemonServiceStatus: vi.fn(),
    getWebUiServiceStatus: vi.fn(),
    installWebUiService: vi.fn(),
    restartManagedDaemonServiceIfInstalled: vi.fn(),
  },
  daemonMocks: {
    startDaemonDetached: vi.fn(),
    stopDaemonGracefully: vi.fn(),
  },
  healthMocks: {
    waitForWebUiHealthy: vi.fn(),
  },
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: childProcessMocks.spawn,
    spawnSync: childProcessMocks.spawnSync,
  };
});

vi.mock('@personal-agent/services', async () => {
  const actual = await vi.importActual<typeof import('@personal-agent/services')>('@personal-agent/services');
  return {
    ...actual,
    getManagedDaemonServiceStatus: serviceMocks.getManagedDaemonServiceStatus,
    getWebUiServiceStatus: serviceMocks.getWebUiServiceStatus,
    installWebUiService: serviceMocks.installWebUiService,
    restartManagedDaemonServiceIfInstalled: serviceMocks.restartManagedDaemonServiceIfInstalled,
  };
});

vi.mock('@personal-agent/daemon', async () => {
  const actual = await vi.importActual<typeof import('@personal-agent/daemon')>('@personal-agent/daemon');
  return {
    ...actual,
    startDaemonDetached: daemonMocks.startDaemonDetached,
    stopDaemonGracefully: daemonMocks.stopDaemonGracefully,
  };
});

vi.mock('./web-ui-health.js', () => ({
  waitForWebUiHealthy: healthMocks.waitForWebUiHealthy,
}));

import { runCli } from './index.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createFakeWebBuildRepo(): string {
  const repoRoot = createTempDir('pa-web-ui-candidate-repo-');
  mkdirSync(join(repoRoot, 'packages', 'web', 'dist', 'app'), { recursive: true });
  mkdirSync(join(repoRoot, 'packages', 'web', 'dist', 'assets'), { recursive: true });
  mkdirSync(join(repoRoot, 'packages', 'web', 'dist-server'), { recursive: true });
  mkdirSync(join(repoRoot, 'node_modules'), { recursive: true });
  writeFileSync(join(repoRoot, 'packages', 'web', 'dist', 'index.html'), '<!doctype html><div id="root"></div>\n');
  writeFileSync(join(repoRoot, 'packages', 'web', 'dist', 'app', 'index.html'), '<!doctype html><div id="root"></div>\n');
  writeFileSync(join(repoRoot, 'packages', 'web', 'dist-server', 'index.js'), 'process.stdin.resume();\n');
  return repoRoot;
}

function createFakeChildProcess(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  exitCode: number | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    exitCode: number | null;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = (signal) => {
    child.exitCode = signal === 'SIGKILL' ? 1 : 0;
    queueMicrotask(() => {
      child.emit('exit', child.exitCode, signal ?? null);
      child.emit('close', child.exitCode, signal ?? null);
    });
    return true;
  };

  return child;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };

  childProcessMocks.spawn.mockReset();
  childProcessMocks.spawn.mockImplementation(() => createFakeChildProcess());
  childProcessMocks.spawnSync.mockReset();
  childProcessMocks.spawnSync.mockImplementation((command: string, args?: readonly string[]) => {
    if (command === 'git' && args?.includes('rev-parse')) {
      return { status: 0, stdout: 'rev-test\n', stderr: '' };
    }

    return { status: 0, stdout: '', stderr: '' };
  });

  serviceMocks.getManagedDaemonServiceStatus.mockReset();
  serviceMocks.getManagedDaemonServiceStatus.mockReturnValue({
    identifier: 'mock-daemon',
    manifestPath: '/tmp/mock-daemon',
    installed: false,
    running: false,
  });
  serviceMocks.getWebUiServiceStatus.mockReset();
  serviceMocks.getWebUiServiceStatus.mockReturnValue({
    identifier: 'mock-web-ui',
    manifestPath: '/tmp/mock-web-ui',
    installed: true,
    running: true,
    platform: 'launchctl',
    port: 3741,
    url: 'http://127.0.0.1:3741',
  });
  serviceMocks.installWebUiService.mockReset();
  serviceMocks.installWebUiService.mockImplementation(() => undefined);
  serviceMocks.restartManagedDaemonServiceIfInstalled.mockReset();
  serviceMocks.restartManagedDaemonServiceIfInstalled.mockImplementation(() => undefined);

  daemonMocks.startDaemonDetached.mockReset();
  daemonMocks.startDaemonDetached.mockImplementation(async () => undefined);
  daemonMocks.stopDaemonGracefully.mockReset();
  daemonMocks.stopDaemonGracefully.mockImplementation(async () => undefined);

  healthMocks.waitForWebUiHealthy.mockReset();
  healthMocks.waitForWebUiHealthy.mockImplementation(async () => undefined);
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('web UI blue/green candidate validation', () => {
  it('skips the configured companion port and disables the companion listener for candidate health checks', async () => {
    const repoRoot = createFakeWebBuildRepo();
    const stateRoot = createTempDir('pa-web-ui-candidate-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runCli(['restart', '--rebuild']);

    expect(exitCode).toBe(0);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining('/dist-server/index.js')],
      expect.objectContaining({
        env: expect.objectContaining({
          PA_WEB_DISABLE_COMPANION: '1',
          PERSONAL_AGENT_WEB_SLOT: 'blue',
          PERSONAL_AGENT_WEB_REVISION: 'rev-test',
        }),
      }),
    );

    const spawnOptions = childProcessMocks.spawn.mock.calls[0]?.[2] as { env?: Record<string, string> } | undefined;
    expect(spawnOptions?.env?.PA_WEB_PORT).toBeDefined();
    expect(spawnOptions?.env?.PA_WEB_PORT).not.toBe('3741');

    logSpy.mockRestore();
  });
});
