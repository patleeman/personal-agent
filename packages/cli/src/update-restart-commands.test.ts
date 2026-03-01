import { mkdtempSync } from 'fs';
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
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };
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
