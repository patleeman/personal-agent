import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyRepoManagedTaskDir,
  normalizeDaemonTaskDirOverride,
  syncDaemonTaskScopeToProfile,
} from './daemonProfileSync.js';
import type { DaemonStatus } from '@personal-agent/daemon';

const originalEnv = process.env;
const tempDirs: string[] = [];

beforeEach(() => {
  const stateRoot = createTempDir();
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_STATE_ROOT: stateRoot,
    PERSONAL_AGENT_PROFILES_ROOT: join(stateRoot, 'sync', 'profiles'),
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-daemon-profile-sync-'));
  tempDirs.push(dir);
  return dir;
}

function createDaemonStatus(taskDir: string): DaemonStatus {
  return {
    running: true,
    pid: 123,
    startedAt: '2026-03-12T11:00:00.000Z',
    socketPath: '/tmp/personal-agentd.sock',
    queue: {
      maxDepth: 1000,
      currentDepth: 0,
      droppedEvents: 0,
      processedEvents: 0,
    },
    modules: [
      {
        name: 'tasks',
        enabled: true,
        subscriptions: ['timer.tasks.tick'],
        handledEvents: 0,
        detail: {
          taskDir,
        },
      },
    ],
  };
}

describe('daemonProfileSync', () => {
  it('classifies repo-managed task directories', () => {
    const repoRoot = '/repo';

    expect(classifyRepoManagedTaskDir(undefined, repoRoot)).toBe('missing');
    expect(classifyRepoManagedTaskDir('/repo/profiles', repoRoot)).toBe('profiles-root');
    expect(classifyRepoManagedTaskDir('/repo/profiles/datadog/agent/tasks', repoRoot)).toBe('profile-task-dir');
    expect(classifyRepoManagedTaskDir('/repo/custom/tasks', repoRoot)).toBe('other');
  });

  it('removes a repo-managed taskDir override and preserves other daemon settings', () => {
    const dir = createTempDir();
    const configFile = join(dir, 'daemon.json');

    writeFileSync(configFile, JSON.stringify({
      logLevel: 'debug',
      modules: {
        tasks: {
          taskDir: '/repo/profiles',
          maxRetries: 5,
        },
      },
    }, null, 2));

    const result = normalizeDaemonTaskDirOverride({
      repoRoot: '/repo',
      daemonConfigFile: configFile,
    });

    expect(result).toEqual({ changed: true });
    expect(JSON.parse(readFileSync(configFile, 'utf-8'))).toEqual({
      logLevel: 'debug',
      modules: {
        tasks: {
          maxRetries: 5,
        },
      },
    });
  });

  it('preserves custom taskDir overrides outside the repo profiles tree', () => {
    const dir = createTempDir();
    const configFile = join(dir, 'daemon.json');

    writeFileSync(configFile, JSON.stringify({
      modules: {
        tasks: {
          taskDir: '/custom/tasks',
        },
      },
    }, null, 2));

    const result = normalizeDaemonTaskDirOverride({
      repoRoot: '/repo',
      daemonConfigFile: configFile,
    });

    expect(result).toEqual({ changed: false });
    expect(JSON.parse(readFileSync(configFile, 'utf-8'))).toEqual({
      modules: {
        tasks: {
          taskDir: '/custom/tasks',
        },
      },
    });
  });

  it('restarts the daemon when the running task scope does not match the active profile', async () => {
    const dir = createTempDir();
    const configFile = join(dir, 'daemon.json');

    writeFileSync(configFile, JSON.stringify({
      modules: {
        tasks: {
          taskDir: '/repo/profiles',
        },
      },
    }, null, 2));

    const stopDaemonGracefully = vi.fn(async () => {});
    const startDaemonDetached = vi.fn(async () => {});

    const result = await syncDaemonTaskScopeToProfile({
      profile: 'datadog',
      repoRoot: '/repo',
      daemonConfigFile: configFile,
    }, {
      pingDaemon: vi.fn(async () => true),
      getDaemonStatus: vi.fn(async () => createDaemonStatus('/repo/profiles')),
      stopDaemonGracefully,
      startDaemonDetached,
    });

    expect(result).toMatchObject({
      configUpdated: true,
      daemonWasRunning: true,
      daemonRestarted: true,
      desiredTaskDir: join(process.env.PERSONAL_AGENT_STATE_ROOT!, 'sync', 'tasks'),
      runningTaskDir: '/repo/profiles',
    });
    expect(stopDaemonGracefully).toHaveBeenCalledTimes(1);
    expect(startDaemonDetached).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(configFile, 'utf-8'))).toEqual({});
  });

  it('restarts the daemon when running in legacy repo task scope', async () => {
    const stopDaemonGracefully = vi.fn(async () => {});
    const startDaemonDetached = vi.fn(async () => {});

    const result = await syncDaemonTaskScopeToProfile({
      profile: 'datadog',
      repoRoot: '/repo',
    }, {
      pingDaemon: vi.fn(async () => true),
      getDaemonStatus: vi.fn(async () => createDaemonStatus('/repo/profiles/datadog/agent/tasks')),
      stopDaemonGracefully,
      startDaemonDetached,
    });

    expect(result).toMatchObject({
      configUpdated: false,
      daemonWasRunning: true,
      daemonRestarted: true,
      desiredTaskDir: join(process.env.PERSONAL_AGENT_STATE_ROOT!, 'sync', 'tasks'),
      runningTaskDir: '/repo/profiles/datadog/agent/tasks',
    });
    expect(stopDaemonGracefully).toHaveBeenCalledTimes(1);
    expect(startDaemonDetached).toHaveBeenCalledTimes(1);
  });
});
