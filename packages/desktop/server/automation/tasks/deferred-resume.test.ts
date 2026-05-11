import {
  createEmptyDeferredResumeState,
  getActivityConversationLink,
  listProfileActivityEntries,
  loadDeferredResumeState,
  saveDeferredResumeState,
  scheduleDeferredResume,
  setConversationProjectLinks,
} from '@personal-agent/core';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DaemonConfig } from '../config.js';
import { createDeferredResumeConversationRunId } from '../runs/deferred-resume-conversations.js';
import { resolveDurableRunsRoot, scanDurableRun } from '../runs/store.js';
import type { DaemonEvent, DaemonPaths, EventPayload } from '../types.js';
import { createDeferredResumeModule } from './deferred-resume.js';
import type { DaemonModuleContext } from './types.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

interface PublishedEvent {
  type: string;
  payload?: EventPayload;
}

function createContext(
  taskDir: string,
  stateRoot: string,
  warn = vi.fn(),
): {
  context: DaemonModuleContext;
  published: PublishedEvent[];
  warn: ReturnType<typeof vi.fn>;
} {
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
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
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

  mkdirSync(paths.logDir, { recursive: true });

  const published: PublishedEvent[] = [];

  return {
    context: {
      config: daemonConfig,
      paths,
      publish: (type, payload) => {
        published.push({ type, payload });
        return true;
      },
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn,
        error: () => undefined,
      },
    },
    published,
    warn,
  };
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

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('deferred resume daemon module', () => {
  it('fires due resumes into activity and marks them ready', async () => {
    const repoRoot = createTempDir('deferred-resume-module-repo-');
    const taskDir = join(repoRoot, 'profiles', 'assistant', 'agent', 'tasks');
    mkdirSync(taskDir, { recursive: true });

    const stateRoot = createTempDir('deferred-resume-module-state-');
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
    };

    const sessionDir = join(stateRoot, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, 'conv-123.jsonl');
    writeFileSync(
      sessionFile,
      JSON.stringify({ type: 'session', id: 'conv-123', timestamp: '2026-03-10T12:00:00.000Z', cwd: '/tmp/workspace' }) + '\n',
    );

    setConversationProjectLinks({
      profile: 'assistant',
      conversationId: 'conv-123',
      relatedProjectIds: ['desktop-ui'],
      updatedAt: '2026-03-10T12:00:00.000Z',
    });

    const deferredState = createEmptyDeferredResumeState();
    scheduleDeferredResume(deferredState, {
      id: 'resume-123',
      sessionFile,
      prompt: 'check back in',
      dueAt: '2026-03-10T12:00:00.000Z',
      createdAt: '2026-03-10T11:55:00.000Z',
      attempts: 0,
    });
    saveDeferredResumeState(deferredState);

    const module = createDeferredResumeModule({
      now: () => new Date('2026-03-10T12:05:00.000Z'),
    });
    const { context, published } = createContext(taskDir, stateRoot);

    await module.start(context);
    await module.handleEvent(createEvent('timer.deferred-resume.tick'), context);

    const updatedState = loadDeferredResumeState();
    expect(updatedState.resumes['resume-123']).toMatchObject({
      status: 'ready',
      readyAt: '2026-03-10T12:05:00.000Z',
    });

    const activity = listProfileActivityEntries({ stateRoot, profile: 'assistant' });
    expect(activity).toHaveLength(1);
    expect(activity[0]?.entry.summary).toBe('Deferred resume fired. Open the conversation to continue.');
    expect(activity[0]?.entry.relatedProjectIds).toEqual(['desktop-ui']);
    expect(
      getActivityConversationLink({
        stateRoot,
        profile: 'assistant',
        activityId: activity[0]!.entry.id,
      })?.relatedConversationIds,
    ).toEqual(['conv-123']);

    expect(scanDurableRun(resolveDurableRunsRoot(stateRoot), createDeferredResumeConversationRunId('resume-123'))).toMatchObject({
      runId: createDeferredResumeConversationRunId('resume-123'),
      recoveryAction: 'resume',
      manifest: expect.objectContaining({
        kind: 'conversation',
        source: expect.objectContaining({
          type: 'deferred-resume',
          id: 'resume-123',
          filePath: sessionFile,
        }),
      }),
      status: expect.objectContaining({
        status: 'waiting',
      }),
      checkpoint: expect.objectContaining({
        step: 'deferred-resume.ready',
      }),
    });

    expect(published).toContainEqual({
      type: 'deferred-resume.tick.completed',
      payload: { activated: 1 },
    });
  });

  it('ignores unrelated events and does nothing when nothing is due', async () => {
    const repoRoot = createTempDir('deferred-resume-module-repo-');
    const taskDir = join(repoRoot, 'profiles', 'assistant', 'agent', 'tasks');
    mkdirSync(taskDir, { recursive: true });
    const stateRoot = createTempDir('deferred-resume-module-state-');
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
    };

    const module = createDeferredResumeModule({
      now: () => new Date('2026-03-10T12:05:00.000Z'),
    });
    const { context, published } = createContext(taskDir, stateRoot);

    await module.start(context);
    await module.handleEvent(createEvent('timer.tasks.tick'), context);
    await module.handleEvent(createEvent('timer.deferred-resume.tick'), context);

    expect(published).toEqual([]);
    expect(module.getStatus?.()).toMatchObject({
      knownResumes: 0,
      readyResumes: 0,
      activatedResumes: 0,
    });
  });
});
