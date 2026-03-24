import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfigRoot, getDurableSessionsDir, getStateRoot } from '@personal-agent/core';
import type { AppEvent } from './appEvents.js';
import { startAppEventMonitor, stopAppEventMonitor, subscribeAppEvents } from './appEvents.js';

const originalEnv = process.env;
const tempDirs: string[] = [];
const ALL_TOPICS = [
  'activity',
  'projects',
  'sessions',
  'tasks',
  'runs',
  'automation',
  'daemon',
  'gateway',
  'sync',
  'webUi',
  'executionTargets',
  'workspace',
] as const;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if ((Date.now() - startedAt) >= timeoutMs) {
      throw new Error('Timed out waiting for app event monitor update.');
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_STATE_ROOT: createTempDir('pa-web-app-events-state-'),
  };
});

afterEach(async () => {
  stopAppEventMonitor();
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('app event monitor', () => {
  it('invalidates sessions when a session file changes', async () => {
    const repoRoot = createTempDir('pa-web-app-events-repo-');
    const sessionsDir = getDurableSessionsDir();
    const taskStateFile = join(getStateRoot(), 'daemon', 'task-state.json');
    const profileConfigFile = join(getConfigRoot(), 'profile.json');
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(dirname(taskStateFile), { recursive: true });
    mkdirSync(dirname(profileConfigFile), { recursive: true });
    writeFileSync(taskStateFile, '{}\n', 'utf-8');
    writeFileSync(profileConfigFile, '{"defaultProfile":"assistant"}\n', 'utf-8');

    const events: AppEvent[] = [];
    const unsubscribe = subscribeAppEvents((event) => {
      events.push(event);
    });

    startAppEventMonitor({
      repoRoot,
      sessionsDir,
      taskStateFile,
      profileConfigFile,
      getCurrentProfile: () => 'assistant',
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    events.length = 0;

    writeFileSync(join(sessionsDir, 'conv-1.jsonl'), '{"type":"session"}\n', 'utf-8');

    await waitFor(() => events.some((event) => event.type === 'invalidate' && event.topics.includes('sessions')));
    unsubscribe();
  });

  it('rebuilds watches and invalidates all topics when the active profile changes', async () => {
    const repoRoot = createTempDir('pa-web-app-events-repo-');
    const sessionsDir = getDurableSessionsDir();
    const taskStateFile = join(getStateRoot(), 'daemon', 'task-state.json');
    const profileConfigFile = join(getConfigRoot(), 'profile.json');
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(dirname(taskStateFile), { recursive: true });
    mkdirSync(dirname(profileConfigFile), { recursive: true });
    writeFileSync(taskStateFile, '{}\n', 'utf-8');
    writeFileSync(profileConfigFile, '{"defaultProfile":"assistant"}\n', 'utf-8');

    let currentProfile = 'assistant';
    const events: AppEvent[] = [];
    const unsubscribe = subscribeAppEvents((event) => {
      events.push(event);
    });

    startAppEventMonitor({
      repoRoot,
      sessionsDir,
      taskStateFile,
      profileConfigFile,
      getCurrentProfile: () => currentProfile,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    events.length = 0;

    currentProfile = 'other';
    writeFileSync(profileConfigFile, '{"defaultProfile":"other"}\n', 'utf-8');

    await waitFor(() => events.some((event) => event.type === 'invalidate' && event.topics.length === ALL_TOPICS.length));
    expect(events.some((event) => event.type === 'invalidate' && ALL_TOPICS.every((topic) => event.topics.includes(topic)))).toBe(true);
    unsubscribe();
  });
});
