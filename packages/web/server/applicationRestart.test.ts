import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock, getWebUiServiceStatusMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  getWebUiServiceStatusMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('@personal-agent/gateway', () => ({
  getWebUiServiceStatus: getWebUiServiceStatusMock,
}));

import { requestApplicationRestart, requestApplicationUpdate, requestWebUiServiceRestart } from './applicationRestart.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  spawnMock.mockReset();
  getWebUiServiceStatusMock.mockReset();
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe('application maintenance requests', () => {
  it('spawns a detached pa restart --rebuild process and records a lock file', () => {
    const stateRoot = createTempDir('pa-web-restart-state-');
    const repoRoot = createTempDir('pa-web-restart-repo-');
    const cliEntryFile = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
    const logFile = join(stateRoot, 'web', 'logs', 'web.log');

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    mkdirSync(join(repoRoot, 'packages', 'cli', 'dist'), { recursive: true });
    writeFileSync(cliEntryFile, 'console.log("cli");\n');

    const unref = vi.fn();
    spawnMock.mockReturnValue({ pid: 4242, unref });
    getWebUiServiceStatusMock.mockReturnValue({
      installed: true,
      port: 3741,
      logFile,
    });

    const result = requestApplicationRestart({ repoRoot, profile: 'datadog' });
    const lockFile = join(stateRoot, 'web', 'app-restart.lock.json');

    expect(result.accepted).toBe(true);
    expect(result.action).toBe('restart');
    expect(result.logFile).toBe(logFile);
    expect(spawnMock).toHaveBeenCalledWith(process.execPath, [cliEntryFile, 'restart', '--rebuild'], {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', expect.any(Number), expect.any(Number)],
      env: expect.objectContaining({
        PERSONAL_AGENT_REPO_ROOT: repoRoot,
        PERSONAL_AGENT_RESTART_NOTIFY_INBOX: '1',
        PERSONAL_AGENT_RESTART_NOTIFY_PROFILE: 'datadog',
        PERSONAL_AGENT_RESTART_REQUESTED_AT: result.requestedAt,
      }),
    });
    expect(unref).toHaveBeenCalledTimes(1);
    expect(existsSync(lockFile)).toBe(true);

    expect(JSON.parse(readFileSync(lockFile, 'utf-8'))).toMatchObject({
      action: 'restart',
      pid: 4242,
      repoRoot,
      profile: 'datadog',
      port: 3741,
      command: [process.execPath, cliEntryFile, 'restart', '--rebuild'],
    });
  });

  it('spawns a detached pa update process and records a lock file', () => {
    const stateRoot = createTempDir('pa-web-update-state-');
    const repoRoot = createTempDir('pa-web-update-repo-');
    const cliEntryFile = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
    const logFile = join(stateRoot, 'web', 'logs', 'web.log');

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    mkdirSync(join(repoRoot, 'packages', 'cli', 'dist'), { recursive: true });
    writeFileSync(cliEntryFile, 'console.log("cli");\n');

    const unref = vi.fn();
    spawnMock.mockReturnValue({ pid: 5252, unref });
    getWebUiServiceStatusMock.mockReturnValue({
      installed: true,
      port: 3741,
      logFile,
    });

    const result = requestApplicationUpdate({ repoRoot, profile: 'datadog' });
    const lockFile = join(stateRoot, 'web', 'app-restart.lock.json');

    expect(result.accepted).toBe(true);
    expect(result.action).toBe('update');
    expect(spawnMock).toHaveBeenCalledWith(process.execPath, [cliEntryFile, 'update'], {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', expect.any(Number), expect.any(Number)],
      env: expect.objectContaining({
        PERSONAL_AGENT_REPO_ROOT: repoRoot,
        PERSONAL_AGENT_UPDATE_NOTIFY_INBOX: '1',
        PERSONAL_AGENT_UPDATE_NOTIFY_PROFILE: 'datadog',
        PERSONAL_AGENT_UPDATE_REQUESTED_AT: result.requestedAt,
      }),
    });
    expect(unref).toHaveBeenCalledTimes(1);
    expect(existsSync(lockFile)).toBe(true);

    expect(JSON.parse(readFileSync(lockFile, 'utf-8'))).toMatchObject({
      action: 'update',
      pid: 5252,
      repoRoot,
      profile: 'datadog',
      port: 3741,
      command: [process.execPath, cliEntryFile, 'update'],
    });
  });

  it('spawns a detached pa ui service restart process and records a lock file', () => {
    const stateRoot = createTempDir('pa-web-service-restart-state-');
    const repoRoot = createTempDir('pa-web-service-restart-repo-');
    const cliEntryFile = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
    const logFile = join(stateRoot, 'web', 'logs', 'web.log');

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    mkdirSync(join(repoRoot, 'packages', 'cli', 'dist'), { recursive: true });
    writeFileSync(cliEntryFile, 'console.log("cli");\n');

    const unref = vi.fn();
    spawnMock.mockReturnValue({ pid: 6262, unref });
    getWebUiServiceStatusMock.mockReturnValue({
      installed: true,
      port: 3741,
      logFile,
    });

    const result = requestWebUiServiceRestart({ repoRoot });
    const lockFile = join(stateRoot, 'web', 'app-restart.lock.json');

    expect(result.accepted).toBe(true);
    expect(result.action).toBe('web-ui-service-restart');
    expect(spawnMock).toHaveBeenCalledWith(process.execPath, [cliEntryFile, 'ui', 'service', 'restart', '--port', '3741'], {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', expect.any(Number), expect.any(Number)],
      env: expect.objectContaining({
        PERSONAL_AGENT_REPO_ROOT: repoRoot,
      }),
    });
    const restartCallEnv = spawnMock.mock.calls.at(-1)?.[2]?.env as Record<string, string | undefined> | undefined;
    expect(restartCallEnv?.PERSONAL_AGENT_RESTART_NOTIFY_INBOX).toBeUndefined();
    expect(restartCallEnv?.PERSONAL_AGENT_UPDATE_NOTIFY_INBOX).toBeUndefined();
    expect(unref).toHaveBeenCalledTimes(1);
    expect(existsSync(lockFile)).toBe(true);

    expect(JSON.parse(readFileSync(lockFile, 'utf-8'))).toMatchObject({
      action: 'web-ui-service-restart',
      pid: 6262,
      repoRoot,
      profile: '',
      port: 3741,
      command: [process.execPath, cliEntryFile, 'ui', 'service', 'restart', '--port', '3741'],
    });
  });

  it('throws when the managed web ui service is not installed', () => {
    const stateRoot = createTempDir('pa-web-restart-state-');
    const repoRoot = createTempDir('pa-web-restart-repo-');
    const cliEntryFile = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    mkdirSync(join(repoRoot, 'packages', 'cli', 'dist'), { recursive: true });
    writeFileSync(cliEntryFile, 'console.log("cli");\n');

    getWebUiServiceStatusMock.mockReturnValue({
      installed: false,
      port: 3741,
    });

    expect(() => requestApplicationRestart({ repoRoot, profile: 'datadog' })).toThrow(
      'Managed web UI service is not installed.',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('prevents concurrent requests while a lock pid is still running', () => {
    const stateRoot = createTempDir('pa-web-restart-state-');
    const repoRoot = createTempDir('pa-web-restart-repo-');
    const cliEntryFile = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
    const lockFile = join(stateRoot, 'web', 'app-restart.lock.json');

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    mkdirSync(join(repoRoot, 'packages', 'cli', 'dist'), { recursive: true });
    mkdirSync(join(stateRoot, 'web'), { recursive: true });
    writeFileSync(cliEntryFile, 'console.log("cli");\n');
    writeFileSync(lockFile, `${JSON.stringify({ action: 'update', pid: process.pid, requestedAt: new Date().toISOString() }, null, 2)}\n`);

    getWebUiServiceStatusMock.mockReturnValue({
      installed: true,
      port: 3741,
    });

    expect(() => requestApplicationRestart({ repoRoot, profile: 'datadog' })).toThrow('Application update already in progress');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
