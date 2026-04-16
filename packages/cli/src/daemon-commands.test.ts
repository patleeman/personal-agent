/**
 * P0: CLI daemon command behavior matrix tests
 * Tests daemon command behavior: help, status, status --json, start, stop, restart, logs, service help
 * Plus unknown subcommand failure paths
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceMocks, daemonMocks } = vi.hoisted(() => ({
  serviceMocks: {
    getManagedDaemonServiceStatus: vi.fn(() => ({
      identifier: 'mock-daemon',
      manifestPath: '/tmp/mock-daemon',
      installed: false,
      running: false,
    })),
    restartManagedDaemonServiceIfInstalled: vi.fn((): unknown => undefined),
  },
  daemonMocks: {
    startDaemonDetached: vi.fn(async () => undefined),
    stopDaemonGracefully: vi.fn(async () => undefined),
  },
}));

vi.mock('@personal-agent/daemon', async () => {
  const actual = await vi.importActual<typeof import('@personal-agent/daemon')>('@personal-agent/daemon');
  return {
    ...actual,
    getManagedDaemonServiceStatus: serviceMocks.getManagedDaemonServiceStatus,
    restartManagedDaemonServiceIfInstalled: serviceMocks.restartManagedDaemonServiceIfInstalled,
    startDaemonDetached: daemonMocks.startDaemonDetached,
    stopDaemonGracefully: daemonMocks.stopDaemonGracefully,
  };
});

import { runCli } from './index.js';

const originalEnv = process.env;
const originalCwd = process.cwd();
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createFakeDaemonWorkspace(): string {
  const dir = createTempDir('personal-agent-daemon-workspace-');
  const entryFile = join(dir, 'packages', 'daemon', 'dist', 'index.js');
  mkdirSync(join(dir, 'packages', 'daemon', 'dist'), { recursive: true });
  writeFileSync(entryFile, 'process.exit(0);\n');
  return dir;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PI_SESSION_DIR: createTempDir('pi-session-')
  };

  serviceMocks.getManagedDaemonServiceStatus.mockReset();
  serviceMocks.getManagedDaemonServiceStatus.mockImplementation(() => ({
    identifier: 'mock-daemon',
    manifestPath: '/tmp/mock-daemon',
    installed: false,
    running: false,
  }));
  serviceMocks.restartManagedDaemonServiceIfInstalled.mockReset();
  serviceMocks.restartManagedDaemonServiceIfInstalled.mockImplementation(() => undefined);
  daemonMocks.startDaemonDetached.mockReset();
  daemonMocks.startDaemonDetached.mockImplementation(async () => undefined);
  daemonMocks.stopDaemonGracefully.mockReset();
  daemonMocks.stopDaemonGracefully.mockImplementation(async () => undefined);
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('daemon command matrix', () => {
  it('shows daemon status as stopped when daemon is not running', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon', 'status']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('stopped'))).toBe(true);
    expect(logs.some((line) => line.includes('Socket'))).toBe(true);
    expect(logs.some((line) => line.includes('pa daemon start'))).toBe(true);

    logSpy.mockRestore();
  });

  it('shows daemon status with --json flag', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon', 'status', '--json']);

    expect(exitCode).toBe(0);

    // Find the JSON line
    const jsonLine = logs.find((line) => line.includes('"running":'));
    expect(jsonLine).toBeDefined();

    const parsed = JSON.parse(jsonLine!);
    expect(parsed.running).toBe(false);

    logSpy.mockRestore();
  });

  it('shows daemon status when no subcommand is provided', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Daemon'))).toBe(true);
    expect(logs.some((line) => line.includes('stopped'))).toBe(true);
    expect(logs.some((line) => line.includes('Usage: pa daemon'))).toBe(true);
    expect(logs.some((line) => line.includes('pa daemon start'))).toBe(true);
    expect(logs.some((line) => line.includes('pa daemon service [install|status|uninstall|help]'))).toBe(true);

    logSpy.mockRestore();
  });

  it('shows daemon help via daemon help subcommand', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon', 'help']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('pa daemon service [install|status|uninstall|help]'))).toBe(true);

    logSpy.mockRestore();
  });

  it('shows daemon service help via daemon service', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon', 'service']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('pa daemon service install'))).toBe(true);

    logSpy.mockRestore();
  });

  it('handles daemon start subcommand', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const daemonDir = join(stateRoot, 'daemon');
    const workspace = createFakeDaemonWorkspace();
    mkdirSync(daemonDir, { recursive: true });
    process.chdir(workspace);
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon', 'start']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('personal-agentd start requested'))).toBe(true);

    logSpy.mockRestore();
  });

  it('handles daemon stop subcommand', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon', 'stop']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('personal-agentd stop requested'))).toBe(true);

    logSpy.mockRestore();
  });

  it('handles daemon restart subcommand', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const workspace = createFakeDaemonWorkspace();
    process.chdir(workspace);
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon', 'restart']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('personal-agentd restart requested'))).toBe(true);

    logSpy.mockRestore();
  });

  it('uses the managed daemon service for daemon restart when installed', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    serviceMocks.getManagedDaemonServiceStatus.mockReturnValue({
      identifier: 'mock-daemon',
      manifestPath: '/tmp/mock-daemon',
      installed: true,
      running: true,
    });
    serviceMocks.restartManagedDaemonServiceIfInstalled.mockReturnValue({
      identifier: 'mock-daemon',
      manifestPath: '/tmp/mock-daemon',
      installed: true,
      running: true,
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runCli(['daemon', 'restart']);

    expect(exitCode).toBe(0);
    expect(serviceMocks.restartManagedDaemonServiceIfInstalled).toHaveBeenCalledTimes(1);
    expect(daemonMocks.stopDaemonGracefully).not.toHaveBeenCalled();
    expect(daemonMocks.startDaemonDetached).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('handles daemon logs subcommand', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon', 'logs']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Log file'))).toBe(true);
    expect(logs.some((line) => line.includes('PID'))).toBe(true);

    logSpy.mockRestore();
  });

  it('returns error for unknown daemon subcommand', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon', 'unknown-subcommand']);

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('Unknown daemon subcommand'))).toBe(true);

    errorSpy.mockRestore();
  });

  it('daemon logs shows pid from file when available', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const daemonDir = join(stateRoot, 'daemon');
    mkdirSync(daemonDir, { recursive: true });
    const pidFile = join(daemonDir, 'personal-agentd.pid');
    writeFileSync(pidFile, '12345');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    await runCli(['daemon', 'logs']);

    expect(logs.some((line) => line.includes('12345'))).toBe(true);

    logSpy.mockRestore();
  });
});
