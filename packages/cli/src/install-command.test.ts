import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './index.js';

const originalEnv = process.env;
const originalCwd = process.cwd();
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

function createTestRepo(): { repo: string; stateRoot: string; profilesRoot: string } {
  const repo = createTempDir('personal-agent-cli-install-repo-');
  const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT;
  if (!stateRoot) {
    throw new Error('PERSONAL_AGENT_STATE_ROOT must be set in test setup');
  }
  const profilesRoot = join(stateRoot, 'sync', '_profiles');

  process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
  process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'sync');

  writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
  writeFile(
    join(repo, 'defaults/agent/settings.json'),
    JSON.stringify({
      defaultProvider: 'test-provider',
      defaultModel: 'test-model',
    }),
  );

  writeFile(join(profilesRoot, 'assistant.json'), '{"title":"Assistant"}\n');
  writeFile(
    join(profilesRoot, 'assistant', 'settings.json'),
    JSON.stringify({
      theme: 'cobalt2',
      packages: ['/existing-package'],
    }),
  );

  return { repo, stateRoot, profilesRoot };
}

function captureLogs(): string[] {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    logs.push(parts.map((part) => String(part ?? '')).join(' '));
  });
  return logs;
}

beforeEach(() => {
  const configPath = join(createTempDir('personal-agent-cli-install-config-'), 'config.json');
  writeFileSync(configPath, JSON.stringify({ defaultProfile: 'assistant' }));

  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_CONFIG_FILE: configPath,
    PERSONAL_AGENT_LOCAL_PROFILE_DIR: createTempDir('personal-agent-cli-install-local-default-'),
    PERSONAL_AGENT_STATE_ROOT: createTempDir('personal-agent-cli-install-state-'),
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('install command', () => {
  it('adds a package source to the active profile settings', async () => {
    const { repo, profilesRoot } = createTestRepo();
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    const logs = captureLogs();

    const exitCode = await runCli(['install', 'https://github.com/davebcn87/pi-autoresearch']);

    expect(exitCode).toBe(0);

    const settings = JSON.parse(
      readFileSync(join(profilesRoot, 'assistant', 'settings.json'), 'utf-8'),
    ) as { packages: string[] };

    expect(settings.packages).toEqual([
      '/existing-package',
      'https://github.com/davebcn87/pi-autoresearch',
    ]);
    expect(logs.join('\n')).toContain('Installed package source');
  });

  it('does not duplicate package sources already present in object entries', async () => {
    const { repo, profilesRoot } = createTestRepo();
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    writeFile(
      join(profilesRoot, 'assistant', 'settings.json'),
      JSON.stringify({
        packages: [
          {
            source: 'https://github.com/davebcn87/pi-autoresearch',
            skills: [],
          },
        ],
      }),
    );
    const logs = captureLogs();

    const exitCode = await runCli(['install', 'https://github.com/davebcn87/pi-autoresearch']);

    expect(exitCode).toBe(0);

    const settings = JSON.parse(
      readFileSync(join(profilesRoot, 'assistant', 'settings.json'), 'utf-8'),
    ) as { packages: Array<Record<string, unknown>> };

    expect(settings.packages).toHaveLength(1);
    expect(logs.join('\n')).toContain('already present');
  });

  it('writes to the local overlay when --local is used', async () => {
    const { repo } = createTestRepo();
    const localDir = createTempDir('personal-agent-cli-install-local-');
    mkdirSync(join(localDir, 'agent'), { recursive: true });

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR = localDir;

    const exitCode = await runCli(['install', '--local', 'npm:@scope/test-package@1.2.3']);

    expect(exitCode).toBe(0);

    const settings = JSON.parse(
      readFileSync(join(localDir, 'agent', 'settings.json'), 'utf-8'),
    ) as { packages: string[] };

    expect(settings.packages).toEqual(['npm:@scope/test-package@1.2.3']);
  });

  it('stores relative local package paths as absolute paths', async () => {
    const { repo, profilesRoot } = createTestRepo();
    const workingDir = createTempDir('personal-agent-cli-install-cwd-');
    const packageDir = join(workingDir, 'my-package');
    mkdirSync(packageDir, { recursive: true });

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.chdir(workingDir);
    const expectedStoredPath = resolve(process.cwd(), './my-package');

    const exitCode = await runCli(['install', './my-package']);

    expect(exitCode).toBe(0);

    const settings = JSON.parse(
      readFileSync(join(profilesRoot, 'assistant', 'settings.json'), 'utf-8'),
    ) as { packages: string[] };

    expect(settings.packages).toEqual([
      '/existing-package',
      expectedStoredPath,
    ]);
  });
});
