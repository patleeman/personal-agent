/**
 * P0: CLI daemon command behavior matrix tests
 * Tests all daemon subcommands: status, status --json, start, stop, restart, logs
 * Plus unknown subcommand failure paths
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  };
});

afterEach(async () => {
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
    expect(logs.some((line) => line.includes('personal-agentd: stopped'))).toBe(true);
    expect(logs.some((line) => line.includes('socket:'))).toBe(true);
    expect(logs.some((line) => line.includes('hint: pa daemon start'))).toBe(true);

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

  it('handles daemon status as default when no subcommand provided', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    // 'daemon' without subcommand should default to status
    const exitCode = await runCli(['daemon']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('personal-agentd:'))).toBe(true);

    logSpy.mockRestore();
  });

  it('handles daemon start subcommand', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const daemonDir = join(stateRoot, 'daemon');
    mkdirSync(daemonDir, { recursive: true });
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

  it('handles daemon logs subcommand', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['daemon', 'logs']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('logFile='))).toBe(true);
    expect(logs.some((line) => line.includes('pid='))).toBe(true);

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

    expect(logs.some((line) => line.includes('pid=12345'))).toBe(true);

    logSpy.mockRestore();
  });
});
