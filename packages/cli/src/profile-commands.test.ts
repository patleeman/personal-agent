/**
 * P0: CLI profile command failure paths
 * Tests for profile command edge cases and error handling
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './index.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createTestRepo(stateRoot?: string): string {
  const repo = createTempDir('personal-agent-cli-repo-');
  writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

  if (stateRoot) {
    process.env.PERSONAL_AGENT_PROFILES_ROOT = join(stateRoot, 'sync', 'profiles');
    process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'sync');
    writeFile(join(stateRoot, 'sync', 'profiles', 'datadog.json'), '{"title":"Datadog"}\n');
    writeFile(join(stateRoot, 'sync', 'profiles', 'datadog', 'agent', 'AGENTS.md'), '# Datadog\n');
  }

  return repo;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PI_SESSION_DIR: createTempDir('pi-session-')
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('profile command failure paths', () => {
  it('fails when profile use is called without a profile name', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['profile', 'use']);

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('profile use requires a profile name'))).toBe(true);

    errorSpy.mockRestore();
  });

  it('fails when profile use is called with unknown profile', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['profile', 'use', 'nonexistent-profile']);

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('Unknown profile'))).toBe(true);

    errorSpy.mockRestore();
  });

  it('fails when profile subcommand is unknown', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['profile', 'unknown-subcommand']);

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('Unknown profile subcommand'))).toBe(true);

    errorSpy.mockRestore();
  });

  it('succeeds when profile use is called with valid profile name', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['profile', 'use', 'datadog']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Default profile set to: datadog'))).toBe(true);

    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { defaultProfile: string };
    expect(config.defaultProfile).toBe('datadog');

    logSpy.mockRestore();
  });

  it('profile list shows profiles with default marker', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    await runCli(['profile', 'use', 'datadog']);

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['profile', 'list']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Profiles:'))).toBe(true);
    expect(logs.some((line) => line.includes('datadog'))).toBe(true);
    expect(logs.some((line) => line.includes('shared'))).toBe(true);

    logSpy.mockRestore();
  });

  it('profile show displays resolved profile details', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    await runCli(['profile', 'use', 'datadog']);

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['profile', 'show']);

    expect(exitCode).toBe(0);

    const jsonLine = logs.find((line) => line.includes('"name":'));
    expect(jsonLine).toBeDefined();

    const parsed = JSON.parse(jsonLine!);
    expect(parsed.name).toBe('datadog');
    expect(parsed.layers).toBeDefined();
    expect(Array.isArray(parsed.layers)).toBe(true);

    logSpy.mockRestore();
  });

  it('profile show with explicit name displays that profile', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['profile', 'show', 'shared']);

    expect(exitCode).toBe(0);

    const jsonLine = logs.find((line) => line.includes('"name":'));
    expect(jsonLine).toBeDefined();

    const parsed = JSON.parse(jsonLine!);
    expect(parsed.name).toBe('shared');

    logSpy.mockRestore();
  });

  it('profile list shows warning when no profiles exist', async () => {
    const repo = createTempDir('personal-agent-cli-repo-empty-');
    const stateRoot = createTempDir('personal-agent-cli-state-');

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = join(stateRoot, 'sync', 'profiles');
    process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'sync');

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['profile', 'list']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('No profiles found'))).toBe(true);

    logSpy.mockRestore();
  });
});
