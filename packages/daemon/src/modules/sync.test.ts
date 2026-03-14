import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConfig } from '../config.js';
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

function createContext(repoDir: string): DaemonModuleContext {
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
        taskDir: join(repoDir, 'tasks'),
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      sync: {
        enabled: true,
        repoDir,
        branch: 'main',
        remote: 'origin',
        intervalSeconds: 120,
        autoResolveWithAgent: false,
        conflictResolverTaskSlug: 'sync-conflict-resolver',
        resolverCooldownMinutes: 30,
      },
    },
  };

  const paths: DaemonPaths = {
    root: repoDir,
    socketPath: join(repoDir, 'daemon.sock'),
    pidFile: join(repoDir, 'daemon.pid'),
    logDir: join(repoDir, 'logs'),
    logFile: join(repoDir, 'logs', 'daemon.log'),
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

describe('sync module', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('enforces a minimum timer interval of 15 seconds', () => {
    const module = createSyncModule({
      enabled: true,
      repoDir: '/tmp/sync-repo',
      branch: 'main',
      remote: 'origin',
      intervalSeconds: 1,
      autoResolveWithAgent: false,
      conflictResolverTaskSlug: 'sync-conflict-resolver',
      resolverCooldownMinutes: 30,
    });

    expect(module.timers).toHaveLength(1);
    expect(module.timers[0]?.intervalMs).toBe(15_000);
  });

  it('creates a commit for local staged changes during a sync run', async () => {
    const repoDir = createTempDir('sync-module-repo-');

    runGit(repoDir, ['init', '-b', 'main']);

    const filePath = join(repoDir, 'profiles', 'assistant', 'agent', 'AGENTS.md');
    mkdirSync(join(repoDir, 'profiles', 'assistant', 'agent'), { recursive: true });
    writeFileSync(filePath, '# Assistant\n');
    runGit(repoDir, ['add', '-A']);
    runGit(repoDir, ['commit', '-m', 'chore: initial']);

    writeFileSync(filePath, `${readFileSync(filePath, 'utf-8')}\nUpdated\n`);

    const module = createSyncModule({
      enabled: true,
      repoDir,
      branch: 'main',
      remote: 'origin',
      intervalSeconds: 120,
      autoResolveWithAgent: false,
      conflictResolverTaskSlug: 'sync-conflict-resolver',
      resolverCooldownMinutes: 30,
    });

    const context = createContext(repoDir);

    await module.start(context);
    await module.handleEvent(createEvent('sync.run.requested'), context);

    const commitCount = Number.parseInt(readGitOutput(repoDir, ['rev-list', '--count', 'HEAD']), 10);
    expect(commitCount).toBe(2);

    const status = module.getStatus?.() as Record<string, unknown>;
    expect(status.lastCommitAt).toBeTypeOf('string');
    expect(status.lastError).toBeUndefined();
  });
});
