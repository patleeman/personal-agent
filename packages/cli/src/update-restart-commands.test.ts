import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayMocks, daemonMocks } = vi.hoisted(() => ({
  gatewayMocks: {
    restartManagedDaemonServiceIfInstalled: vi.fn((): any => undefined),
    restartGatewayServiceIfInstalled: vi.fn(() => undefined),
    restartWebUiServiceIfInstalled: vi.fn(() => undefined),
    getManagedDaemonServiceStatus: vi.fn(() => ({
      identifier: 'mock-daemon',
      manifestPath: '/tmp/mock-daemon',
      installed: false,
      running: false,
    })),
    getWebUiServiceStatus: vi.fn(() => ({
      identifier: 'mock-web-ui',
      manifestPath: '/tmp/mock-web-ui',
      installed: false,
      running: false,
      platform: 'launchctl',
      port: 3741,
      url: 'http://127.0.0.1:3741',
    })),
  },
  daemonMocks: {
    startDaemonDetached: vi.fn(async () => undefined),
    stopDaemonGracefully: vi.fn(async () => undefined),
  },
}));

vi.mock('@personal-agent/gateway', async () => {
  const actual = await vi.importActual<typeof import('@personal-agent/gateway')>('@personal-agent/gateway');
  return {
    ...actual,
    restartManagedDaemonServiceIfInstalled: gatewayMocks.restartManagedDaemonServiceIfInstalled,
    restartGatewayServiceIfInstalled: gatewayMocks.restartGatewayServiceIfInstalled,
    restartWebUiServiceIfInstalled: gatewayMocks.restartWebUiServiceIfInstalled,
    getManagedDaemonServiceStatus: gatewayMocks.getManagedDaemonServiceStatus,
    getWebUiServiceStatus: gatewayMocks.getWebUiServiceStatus,
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

import { runCli } from './index.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };

  gatewayMocks.restartManagedDaemonServiceIfInstalled.mockReset();
  gatewayMocks.restartManagedDaemonServiceIfInstalled.mockImplementation(() => undefined);
  gatewayMocks.restartGatewayServiceIfInstalled.mockReset();
  gatewayMocks.restartGatewayServiceIfInstalled.mockImplementation(() => undefined);
  gatewayMocks.restartWebUiServiceIfInstalled.mockReset();
  gatewayMocks.restartWebUiServiceIfInstalled.mockImplementation(() => undefined);
  gatewayMocks.getManagedDaemonServiceStatus.mockReset();
  gatewayMocks.getManagedDaemonServiceStatus.mockImplementation(() => ({
    identifier: 'mock-daemon',
    manifestPath: '/tmp/mock-daemon',
    installed: false,
    running: false,
  }));
  gatewayMocks.getWebUiServiceStatus.mockReset();
  gatewayMocks.getWebUiServiceStatus.mockImplementation(() => ({
    identifier: 'mock-web-ui',
    manifestPath: '/tmp/mock-web-ui',
    installed: false,
    running: false,
    platform: 'launchctl',
    port: 3741,
    url: 'http://127.0.0.1:3741',
  }));

  daemonMocks.startDaemonDetached.mockReset();
  daemonMocks.startDaemonDetached.mockImplementation(async () => undefined);
  daemonMocks.stopDaemonGracefully.mockReset();
  daemonMocks.stopDaemonGracefully.mockImplementation(async () => undefined);
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('update and restart commands', () => {
  it('supports pa restart', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['restart']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Restart summary'))).toBe(true);

    logSpy.mockRestore();
  });

  it('restarts the managed daemon service without doing a detached daemon bounce', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    gatewayMocks.getManagedDaemonServiceStatus.mockReturnValue({
      identifier: 'mock-daemon',
      manifestPath: '/tmp/mock-daemon',
      installed: true,
      running: true,
    });
    gatewayMocks.restartManagedDaemonServiceIfInstalled.mockReturnValue({
      identifier: 'mock-daemon',
      manifestPath: '/tmp/mock-daemon',
      installed: true,
      running: true,
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runCli(['restart']);

    expect(exitCode).toBe(0);
    expect(gatewayMocks.restartManagedDaemonServiceIfInstalled).toHaveBeenCalledTimes(1);
    expect(daemonMocks.stopDaemonGracefully).not.toHaveBeenCalled();
    expect(daemonMocks.startDaemonDetached).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('clears an owned application restart lock after pa restart completes', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const lockFile = join(stateRoot, 'web', 'app-restart.lock.json');
    mkdirSync(join(stateRoot, 'web'), { recursive: true });
    writeFileSync(lockFile, `${JSON.stringify({ action: 'restart', pid: process.pid })}\n`);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runCli(['restart']);

    expect(exitCode).toBe(0);
    expect(existsSync(lockFile)).toBe(false);

    logSpy.mockRestore();
  });

  it('validates pa restart arguments', async () => {
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['restart', 'now']);

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('Usage: pa restart'))).toBe(true);

    errorSpy.mockRestore();
  });

  it('fails pa update outside a git checkout', async () => {
    const nonGitRepo = createTempDir('personal-agent-non-git-');
    process.env.PERSONAL_AGENT_REPO_ROOT = nonGitRepo;

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['update']);

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('Repository root is not a git checkout'))).toBe(true);

    errorSpy.mockRestore();
  });

  it('supports pa update --repo-only', async () => {
    const nonGitRepo = createTempDir('personal-agent-non-git-');
    process.env.PERSONAL_AGENT_REPO_ROOT = nonGitRepo;

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['update', '--repo-only']);

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('Repository root is not a git checkout'))).toBe(true);
    expect(errors.some((line) => line.includes('Usage: pa update'))).toBe(false);

    errorSpy.mockRestore();
  });

  it('clears an owned application update lock after pa update exits', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const nonGitRepo = createTempDir('personal-agent-non-git-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_REPO_ROOT = nonGitRepo;

    const lockFile = join(stateRoot, 'web', 'app-restart.lock.json');
    mkdirSync(join(stateRoot, 'web'), { recursive: true });
    writeFileSync(lockFile, `${JSON.stringify({ action: 'update', pid: process.pid })}\n`);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = await runCli(['update']);

    expect(exitCode).toBe(1);
    expect(existsSync(lockFile)).toBe(false);

    errorSpy.mockRestore();
  });

  it('validates pa update arguments', async () => {
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['update', '--hard']);

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('Usage: pa update'))).toBe(true);

    errorSpy.mockRestore();
  });
});
