import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listManagedTmuxSessionsMock = vi.fn();
const findManagedTmuxSessionByNameMock = vi.fn();
const startManagedTmuxSessionMock = vi.fn();
const stopManagedTmuxSessionMock = vi.fn();
const sendManagedTmuxCommandMock = vi.fn();
const captureManagedTmuxPaneMock = vi.fn();

const runner = vi.fn();

vi.mock('./tmux.js', () => ({
  createSpawnSyncTmuxRunner: () => runner,
  listManagedTmuxSessions: (...args: unknown[]) => listManagedTmuxSessionsMock(...args),
  findManagedTmuxSessionByName: (...args: unknown[]) => findManagedTmuxSessionByNameMock(...args),
  startManagedTmuxSession: (...args: unknown[]) => startManagedTmuxSessionMock(...args),
  stopManagedTmuxSession: (...args: unknown[]) => stopManagedTmuxSessionMock(...args),
  sendManagedTmuxCommand: (...args: unknown[]) => sendManagedTmuxCommandMock(...args),
  captureManagedTmuxPane: (...args: unknown[]) => captureManagedTmuxPaneMock(...args),
}));

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
    PERSONAL_AGENT_STATE_ROOT: createTempDir('pa-state-'),
  };

  listManagedTmuxSessionsMock.mockReset();
  findManagedTmuxSessionByNameMock.mockReset();
  startManagedTmuxSessionMock.mockReset();
  stopManagedTmuxSessionMock.mockReset();
  sendManagedTmuxCommandMock.mockReset();
  captureManagedTmuxPaneMock.mockReset();
  runner.mockReset();
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('tmux CLI command', () => {
  it('renders managed tmux sessions for pa tmux list', async () => {
    listManagedTmuxSessionsMock.mockReturnValue([
      {
        name: 'repo-code-review-20260305-120000',
        id: '$1',
        windows: 1,
        attachedClients: 0,
        createdEpochSeconds: 1700000000,
        createdAt: '2023-11-14T22:13:20.000Z',
        task: 'code-review',
        logPath: '/tmp/repo-code-review.log',
        command: 'pa -p "review"',
      },
    ]);

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['tmux', 'list']);
    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Managed tmux sessions'))).toBe(true);
    expect(logs.some((line) => line.includes('repo-code-review-20260305-120000'))).toBe(true);

    logSpy.mockRestore();
  });

  it('starts managed tmux sessions via pa tmux run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T13:45:09-05:00'));

    findManagedTmuxSessionByNameMock.mockReturnValue({
      name: 'personal-agent-code-review-20260305-134509',
    });

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['tmux', 'run', 'code-review', '--', 'echo', 'hello']);
    expect(exitCode).toBe(0);

    expect(startManagedTmuxSessionMock).toHaveBeenCalledTimes(1);

    const callArgs = startManagedTmuxSessionMock.mock.calls[0]?.[0] as {
      sessionName: string;
      task: string;
      command: string;
      sourceCommand: string;
    };

    expect(callArgs.sessionName).toBe('personal-agent-code-review-20260305-134509');
    expect(callArgs.task).toBe('code-review');
    expect(callArgs.sourceCommand).toBe('echo hello');
    expect(callArgs.command).toContain("'echo' 'hello'");
    expect(callArgs.command).toContain('2>&1');

    expect(logs.some((line) => line.includes('Managed tmux session started'))).toBe(true);

    logSpy.mockRestore();
  });

  it('quotes run arguments that contain spaces', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T13:45:09-05:00'));

    findManagedTmuxSessionByNameMock.mockReturnValue({
      name: 'personal-agent-prompt-20260305-134509',
    });

    const exitCode = await runCli(['tmux', 'run', 'prompt', '--', 'pa', '-p', 'hello world']);
    expect(exitCode).toBe(0);

    const callArgs = startManagedTmuxSessionMock.mock.calls[0]?.[0] as {
      command: string;
      sourceCommand: string;
    };

    expect(callArgs.sourceCommand).toBe('pa -p hello world');
    expect(callArgs.command).toContain("'pa' '-p' 'hello world'");
    expect(callArgs.command).toContain('__PA_TMUX_EXIT_CODE');
  });

  it('passes notify metadata for pa tmux run --notify-on-complete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T13:45:09-05:00'));

    findManagedTmuxSessionByNameMock.mockReturnValue({
      name: 'personal-agent-long-task-20260305-134509',
    });

    const exitCode = await runCli([
      'tmux',
      'run',
      'long-task',
      '--notify-on-complete',
      '--notify-context',
      'group=alpha',
      '--',
      'echo',
      'hello',
    ]);

    expect(exitCode).toBe(0);

    const callArgs = startManagedTmuxSessionMock.mock.calls[0]?.[0] as {
      notifyOnComplete?: boolean;
      notifyContext?: string;
    };

    expect(callArgs.notifyOnComplete).toBe(true);
    expect(callArgs.notifyContext).toBe('group=alpha');
  });

  it('removes stale managed tmux logs via pa tmux clean', async () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;
    const logDirectory = join(stateRoot, 'tmux', 'logs');
    mkdirSync(logDirectory, { recursive: true });

    const activeLogPath = join(logDirectory, 'active.log');
    const staleLogPath = join(logDirectory, 'stale.log');

    writeFileSync(activeLogPath, 'active');
    writeFileSync(staleLogPath, 'stale');

    listManagedTmuxSessionsMock.mockReturnValue([
      {
        name: 'repo-code-review-20260305-120000',
        id: '$1',
        windows: 1,
        attachedClients: 0,
        createdEpochSeconds: 1700000000,
        createdAt: '2023-11-14T22:13:20.000Z',
        task: 'code-review',
        logPath: activeLogPath,
        command: 'pa -p "review"',
      },
    ]);

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['tmux', 'clean', '--json']);
    expect(exitCode).toBe(0);

    const payload = JSON.parse(logs[0] as string) as {
      staleLogFiles: string[];
      removed: string[];
    };

    expect(payload.staleLogFiles).toContain(staleLogPath);
    expect(payload.removed).toContain(staleLogPath);

    expect(existsSync(activeLogPath)).toBe(true);
    expect(existsSync(staleLogPath)).toBe(false);

    logSpy.mockRestore();
  });
});
