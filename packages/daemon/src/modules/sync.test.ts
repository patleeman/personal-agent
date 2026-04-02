import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { listProfileActivityEntries } from '@personal-agent/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncModuleConfig, DaemonConfig } from '../config.js';
import type { DaemonEvent, DaemonPaths } from '../types.js';
import type { DaemonModuleContext } from './types.js';
import { createSyncModule } from './sync.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runGit(repoDir: string, args: string[]): void {
  const result = spawnSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
}

function runGitAllowFailure(repoDir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function readGitOutput(repoDir: string, args: string[]): string {
  const result = spawnSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf-8',
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }

  return (result.stdout ?? '').trim();
}

function createEvent(type: string): DaemonEvent {
  return {
    id: `evt_${Math.random().toString(16).slice(2)}`,
    version: 1,
    type,
    source: 'test',
    timestamp: new Date().toISOString(),
    payload: {},
  };
}

function createSyncConfig(repoDir: string, overrides: Partial<SyncModuleConfig> = {}): SyncModuleConfig {
  return {
    enabled: true,
    repoDir,
    branch: 'main',
    remote: 'origin',
    intervalSeconds: 120,
    autoResolveWithAgent: false,
    conflictResolverTaskSlug: 'sync-conflict-resolver',
    resolverCooldownMinutes: 30,
    autoResolveErrorsWithAgent: false,
    errorResolverTaskSlug: 'sync-error-resolver',
    errorResolverCooldownMinutes: 30,
    ...overrides,
  };
}

function createContext(stateRoot: string, syncConfig: SyncModuleConfig): DaemonModuleContext {
  const daemonConfig: DaemonConfig = {
    logLevel: 'error',
    queue: { maxDepth: 100 },
    ipc: {},
    modules: {
      maintenance: {
        enabled: false,
        cleanupIntervalMinutes: 60,
      },
      tasks: {
        enabled: false,
        taskDir: join(stateRoot, 'profiles', 'assistant', 'agent', 'tasks'),
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      sync: syncConfig,
    },
  };

  const paths: DaemonPaths = {
    stateRoot,
    root: stateRoot,
    socketPath: join(stateRoot, 'daemon.sock'),
    pidFile: join(stateRoot, 'daemon.pid'),
    logDir: join(stateRoot, 'logs'),
    logFile: join(stateRoot, 'logs', 'daemon.log'),
  };

  return {
    config: daemonConfig,
    paths,
    publish: () => true,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

function readInboxSummaries(stateRoot: string, profile = 'assistant'): string[] {
  return listProfileActivityEntries({ stateRoot, profile })
    .map(({ entry }) => entry.summary);
}

function initSyncRepoWithPendingChange(repoDir: string): string {
  runGit(repoDir, ['init', '-b', 'main']);

  const filePath = join(repoDir, 'profiles', 'assistant', 'agent', 'AGENTS.md');
  mkdirSync(join(repoDir, 'profiles', 'assistant', 'agent'), { recursive: true });
  writeFileSync(filePath, '# Assistant\n');
  runGit(repoDir, ['add', '-A']);
  runGit(repoDir, ['commit', '-m', 'chore: initial']);

  writeFileSync(filePath, `${readFileSync(filePath, 'utf-8')}\nUpdated\n`);
  return filePath;
}

function createGitIndexLock(repoDir: string, ageMs?: number): string {
  const lockPath = join(repoDir, '.git', 'index.lock');
  writeFileSync(lockPath, 'locked\n');

  if (ageMs !== undefined) {
    const timestamp = new Date(Date.now() - ageMs);
    utimesSync(lockPath, timestamp, timestamp);
  }

  return lockPath;
}

describe('sync module', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('enforces a minimum timer interval of 15 seconds', () => {
    const module = createSyncModule(createSyncConfig('/tmp/sync-repo', { intervalSeconds: 1 }));

    expect(module.timers).toHaveLength(1);
    expect(module.timers[0]?.intervalMs).toBe(15_000);
  });

  it('creates a commit for local staged changes during a sync run', async () => {
    const stateRoot = createTempDir('sync-module-repo-');
    const repoDir = stateRoot;

    runGit(repoDir, ['init', '-b', 'main']);

    const filePath = join(repoDir, 'profiles', 'assistant', 'agent', 'AGENTS.md');
    mkdirSync(join(repoDir, 'profiles', 'assistant', 'agent'), { recursive: true });
    writeFileSync(filePath, '# Assistant\n');
    runGit(repoDir, ['add', '-A']);
    runGit(repoDir, ['commit', '-m', 'chore: initial']);

    writeFileSync(filePath, `${readFileSync(filePath, 'utf-8')}\nUpdated\n`);

    const syncConfig = createSyncConfig(repoDir);
    const module = createSyncModule(syncConfig);
    const context = createContext(stateRoot, syncConfig);

    await module.start(context);
    await module.handleEvent(createEvent('sync.run.requested'), context);

    const commitCount = Number.parseInt(readGitOutput(repoDir, ['rev-list', '--count', 'HEAD']), 10);
    expect(commitCount).toBe(2);

    const status = module.getStatus?.() as Record<string, unknown>;
    expect(status.lastCommitAt).toBeTypeOf('string');
    expect(status.lastError).toBeUndefined();
  });

  it('repairs managed sync repo merge handling before syncing', async () => {
    const stateRoot = createTempDir('sync-module-repair-');
    const repoDir = stateRoot;

    runGit(repoDir, ['init', '-b', 'main']);
    writeFileSync(join(repoDir, '.gitignore'), '*\n');
    writeFileSync(join(repoDir, '.gitattributes'), '* text=auto\n');
    runGit(repoDir, ['add', '-f', '.gitignore', '.gitattributes']);
    runGit(repoDir, ['commit', '-m', 'chore: initial']);

    const syncConfig = createSyncConfig(repoDir);
    const module = createSyncModule(syncConfig);
    const context = createContext(stateRoot, syncConfig);

    await module.start(context);
    await module.handleEvent(createEvent('sync.run.requested'), context);

    const gitignore = readFileSync(join(repoDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('Sync everything under this repo by default.');
    expect(gitignore).not.toContain('!profiles/*/agent/AGENTS.md');
    expect(gitignore).not.toContain('!pi-agent/state/conversation-attention/**');

    const gitattributes = readFileSync(join(repoDir, '.gitattributes'), 'utf-8');
    expect(gitattributes).toContain('pi-agent/sessions/**/*.jsonl text eol=lf merge=union');
    expect(gitattributes).toContain('pi-agent/state/conversation-attention/*.json text eol=lf merge=personal-agent-conversation-attention');
    expect(gitattributes).not.toContain('pi-agent/deferred-resumes-state.json');

    expect(readGitOutput(repoDir, ['config', '--local', '--get', 'merge.personal-agent-conversation-attention.driver']))
      .toContain('sync merge-conversation-attention');

    const commitCount = Number.parseInt(readGitOutput(repoDir, ['rev-list', '--count', 'HEAD']), 10);
    expect(commitCount).toBe(2);
  });

  it('writes one inbox activity for repeated setup errors', async () => {
    const stateRoot = createTempDir('sync-module-error-');
    const repoDir = join(stateRoot, 'sync');

    const syncConfig = createSyncConfig(repoDir);
    const module = createSyncModule(syncConfig);
    const context = createContext(stateRoot, syncConfig);

    await module.start(context);
    await module.handleEvent(createEvent('timer.sync.tick'), context);
    await module.handleEvent(createEvent('timer.sync.tick'), context);

    const summaries = readInboxSummaries(stateRoot);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('Sync setup failed');
  });

  it('waits through repeated git index lock failures before notifying or starting a resolver', async () => {
    const stateRoot = createTempDir('sync-module-index-lock-');
    const repoDir = stateRoot;
    initSyncRepoWithPendingChange(repoDir);
    createGitIndexLock(repoDir);

    const fakeBin = join(stateRoot, 'bin');
    mkdirSync(fakeBin, { recursive: true });
    const fakePa = join(fakeBin, 'pa');
    const argsFile = join(stateRoot, 'index-lock-resolver-args.txt');
    writeFileSync(
      fakePa,
      [
        '#!/bin/sh',
        `printf '%s\n' "$@" > ${JSON.stringify(argsFile)}`,
        'echo "Durable run started"',
        'echo "Run run_sync_lock_123"',
        'echo "Inspect pa runs show run_sync_lock_123"',
        'exit 0',
      ].join('\n'),
    );
    chmodSync(fakePa, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ''}`;

    try {
      const syncConfig = createSyncConfig(repoDir, {
        autoResolveErrorsWithAgent: true,
      });
      const module = createSyncModule(syncConfig);
      const context = createContext(stateRoot, syncConfig);

      await module.start(context);
      await module.handleEvent(createEvent('timer.sync.tick'), context);
      await module.handleEvent(createEvent('timer.sync.tick'), context);

      expect(readInboxSummaries(stateRoot)).toHaveLength(0);
      expect(existsSync(argsFile)).toBe(false);

      let status = module.getStatus?.() as Record<string, unknown>;
      expect(String(status.lastError ?? '')).toContain('retrying later');
      expect(String(status.lastError ?? '')).toContain('attempt 2/3');

      await module.handleEvent(createEvent('timer.sync.tick'), context);

      const summaries = readInboxSummaries(stateRoot);
      expect(summaries.filter((summary) => summary.includes('Sync add failed'))).toHaveLength(1);
      expect(summaries.filter((summary) => summary.includes('Sync error resolver run started'))).toHaveLength(1);
      expect(existsSync(argsFile)).toBe(true);

      status = module.getStatus?.() as Record<string, unknown>;
      expect(String(status.lastError ?? '')).toContain('index.lock');
      expect(status.lastErrorResolverStartedAt).toBeTypeOf('string');
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('treats stale git index locks as real sync errors immediately', async () => {
    const stateRoot = createTempDir('sync-module-stale-index-lock-');
    const repoDir = stateRoot;
    initSyncRepoWithPendingChange(repoDir);
    createGitIndexLock(repoDir, 11 * 60_000);

    const syncConfig = createSyncConfig(repoDir);
    const module = createSyncModule(syncConfig);
    const context = createContext(stateRoot, syncConfig);

    await module.start(context);
    await module.handleEvent(createEvent('timer.sync.tick'), context);

    const summaries = readInboxSummaries(stateRoot);
    expect(summaries.filter((summary) => summary.includes('Sync add failed'))).toHaveLength(1);

    const status = module.getStatus?.() as Record<string, unknown>;
    expect(String(status.lastError ?? '')).toContain('index.lock');
  });

  it('starts an error resolver run for non-conflict sync failures and notifies inbox', async () => {
    const stateRoot = createTempDir('sync-module-error-resolver-');
    const repoDir = join(stateRoot, 'sync');

    const fakeBin = join(stateRoot, 'bin');
    mkdirSync(fakeBin, { recursive: true });
    const fakePa = join(fakeBin, 'pa');
    const argsFile = join(stateRoot, 'error-resolver-args.txt');
    writeFileSync(
      fakePa,
      [
        '#!/bin/sh',
        `printf '%s\n' "$@" > ${JSON.stringify(argsFile)}`,
        'echo "Durable run started"',
        'echo "Run run_sync_error_123"',
        'echo "Inspect pa runs show run_sync_error_123"',
        'exit 0',
      ].join('\n'),
    );
    chmodSync(fakePa, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ''}`;

    try {
      const syncConfig = createSyncConfig(repoDir, {
        autoResolveErrorsWithAgent: true,
      });
      const module = createSyncModule(syncConfig);
      const context = createContext(stateRoot, syncConfig);

      await module.start(context);
      await module.handleEvent(createEvent('timer.sync.tick'), context);
      await module.handleEvent(createEvent('timer.sync.tick'), context);

      const summaries = readInboxSummaries(stateRoot);
      expect(summaries.filter((summary) => summary.includes('Sync setup failed'))).toHaveLength(1);
      expect(summaries.filter((summary) => summary.includes('Sync error resolver run started'))).toHaveLength(1);

      const status = module.getStatus?.() as Record<string, unknown>;
      expect(status.lastErrorResolverStartedAt).toBeTypeOf('string');
      expect(String(status.lastErrorResolverResult ?? '')).toContain('run_sync_error_123');

      const resolverArgs = readFileSync(argsFile, 'utf-8');
      expect(resolverArgs).toContain('PERSONAL_AGENT_STATE_ROOT=');
      expect(resolverArgs).toContain('conversation-maintenance/assistant/sync-maintenance-state');
      expect(resolverArgs).toContain('PERSONAL_AGENT_PROFILES_ROOT=');
      expect(resolverArgs).toContain('tui');
      expect(resolverArgs).toContain('--profile');
      expect(resolverArgs).toContain('assistant');
      expect(resolverArgs).toContain('-p');
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('writes inbox activities when conflicts are detected and resolver starts', async () => {
    const stateRoot = createTempDir('sync-module-conflict-');
    const repoDir = join(stateRoot, 'sync');
    mkdirSync(repoDir, { recursive: true });

    runGit(repoDir, ['init', '-b', 'main']);

    const conflictFile = join(repoDir, 'pi-agent', 'sessions', 'chat.jsonl');
    mkdirSync(join(repoDir, 'pi-agent', 'sessions'), { recursive: true });
    writeFileSync(conflictFile, '{"turn":1}\n');
    runGit(repoDir, ['add', '-A']);
    runGit(repoDir, ['commit', '-m', 'initial']);

    runGit(repoDir, ['checkout', '-b', 'feature']);
    writeFileSync(conflictFile, '{"turn":2,"branch":"feature"}\n');
    runGit(repoDir, ['commit', '-am', 'feature update']);

    runGit(repoDir, ['checkout', 'main']);
    writeFileSync(conflictFile, '{"turn":2,"branch":"main"}\n');
    runGit(repoDir, ['commit', '-am', 'main update']);

    const mergeResult = runGitAllowFailure(repoDir, ['merge', '--no-edit', 'feature']);
    expect(mergeResult.status).not.toBe(0);

    const fakeBin = join(stateRoot, 'bin');
    mkdirSync(fakeBin, { recursive: true });
    const fakePa = join(fakeBin, 'pa');
    const argsFile = join(stateRoot, 'conflict-resolver-args.txt');
    writeFileSync(
      fakePa,
      [
        '#!/bin/sh',
        `printf '%s\n' "$@" > ${JSON.stringify(argsFile)}`,
        'echo "Durable run started"',
        'echo "Run run_sync_resolver_123"',
        'echo "Inspect pa runs show run_sync_resolver_123"',
        'exit 0',
      ].join('\n'),
    );
    chmodSync(fakePa, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ''}`;

    try {
      const syncConfig = createSyncConfig(repoDir, {
        autoResolveWithAgent: true,
      });
      const module = createSyncModule(syncConfig);
      const context = createContext(stateRoot, syncConfig);

      await module.start(context);
      await module.handleEvent(createEvent('timer.sync.tick'), context);

      const summaries = readInboxSummaries(stateRoot);
      expect(summaries.some((summary) => summary.includes('Sync blocked by merge conflicts'))).toBe(true);
      expect(summaries.some((summary) => summary.includes('Sync conflict resolver run started'))).toBe(true);

      const status = module.getStatus?.() as Record<string, unknown>;
      expect(status.lastResolverStartedAt).toBeTypeOf('string');
      expect(String(status.lastResolverResult ?? '')).toContain('run_sync_resolver_123');

      const resolverArgs = readFileSync(argsFile, 'utf-8');
      expect(resolverArgs).toContain('PERSONAL_AGENT_STATE_ROOT=');
      expect(resolverArgs).toContain('conversation-maintenance/assistant/sync-maintenance-state');
      expect(resolverArgs).toContain('PERSONAL_AGENT_PROFILES_ROOT=');
      expect(resolverArgs).toContain('tui');
      expect(resolverArgs).toContain('--profile');
      expect(resolverArgs).toContain('assistant');
      expect(resolverArgs).toContain('-p');
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
