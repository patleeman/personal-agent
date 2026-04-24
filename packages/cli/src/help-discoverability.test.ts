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

function captureLogs(): string[] {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    logs.push(parts.map((part) => String(part ?? '')).join(' '));
  });
  return logs;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_CONFIG_FILE: join(createTempDir('pa-config-'), 'config.json'),
    PERSONAL_AGENT_DAEMON_CONFIG: join(createTempDir('pa-daemon-config-'), 'daemon.json'),
    PERSONAL_AGENT_LOCAL_PROFILE_DIR: createTempDir('pa-local-'),
    PERSONAL_AGENT_STATE_ROOT: createTempDir('pa-state-'),
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('subcommand help discoverability', () => {
  it.each([
    {
      argv: ['install', '--help'],
      expected: ['Install', 'Usage: pa install <source> [-l | --local]', 'pa install https://github.com/davebcn87/pi-autoresearch'],
    },
    {
      argv: ['daemon', '--help'],
      expected: ['Daemon', 'pa daemon status [--json]', 'pa daemon service [install|status|uninstall|help]'],
    },
    {
      argv: ['daemon', 'service', '--help'],
      expected: ['Daemon service', 'pa daemon service install', 'pa daemon service uninstall'],
    },
  ])('shows useful help for $argv', async ({ argv, expected }) => {
    const logs = captureLogs();

    const exitCode = await runCli(argv);

    expect(exitCode).toBe(0);
    const output = logs.join('\n');
    for (const snippet of expected) {
      expect(output).toContain(snippet);
    }
  });

  it('treats unsupported task and run CLI entrypoints like unknown commands', async () => {
    const errors: string[] = [];

    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map((part) => String(part ?? '')).join(' '));
    });

    await expect(runCli(['tasks'])).resolves.toBe(1);
    await expect(runCli(['help', 'runs'])).resolves.toBe(1);

    expect(errors.join('\n')).toContain('Unknown top-level command or option: tasks');
    expect(errors.join('\n')).toContain('Unknown top-level command: runs');
  });


});
