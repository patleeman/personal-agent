import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConfig } from '../config.js';
import type { DaemonEvent, DaemonPaths, EventPayload } from '../types.js';
import type { DaemonModuleContext } from './types.js';
import { createSessionDeferredResumesModule } from './session-deferred-resumes.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createEvent(type: string, payload: EventPayload = {}): DaemonEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    version: 1,
    type,
    source: 'test',
    timestamp: new Date().toISOString(),
    payload,
  };
}

function createContext(stateRoot: string): DaemonModuleContext {
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
        taskDir: join(stateRoot, 'tasks'),
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      deferredFollowUps: {
        enabled: false,
        tickIntervalSeconds: 5,
        requeueDelaySeconds: 30,
      },
      sessionDeferredResumes: {
        enabled: true,
        tickIntervalSeconds: 5,
        retryDelaySeconds: 30,
      },
    },
  };

  const paths: DaemonPaths = {
    root: stateRoot,
    socketPath: join(stateRoot, 'daemon.sock'),
    pidFile: join(stateRoot, 'daemon.pid'),
    logDir: join(stateRoot, 'logs'),
    logFile: join(stateRoot, 'logs', 'daemon.log'),
  };

  mkdirSync(paths.logDir, { recursive: true });

  return {
    config: daemonConfig,
    paths,
    publish: () => true,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

describe('session deferred resumes module', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('schedules due session resumes and launches them', async () => {
    const stateRoot = createTempDir('session-deferred-resumes-state-');
    let currentTime = new Date('2026-03-08T12:00:00.000Z');
    const launchSessionDeferredResume = vi.fn(async () => undefined);

    const module = createSessionDeferredResumesModule(
      {
        enabled: true,
        tickIntervalSeconds: 5,
        retryDelaySeconds: 30,
      },
      {
        now: () => currentTime,
        createId: () => 'session-resume-1',
        launchSessionDeferredResume,
      },
    );

    const context = createContext(stateRoot);
    await module.start(context);

    await module.handleEvent(createEvent('session.deferred-resume.schedule', {
      sessionFile: '/tmp/sessions/1.jsonl',
      cwd: '/tmp/workspace',
      profile: 'assistant',
      prompt: 'check the logs and continue',
      dueAt: '2026-03-08T12:05:00.000Z',
    }), context);

    await module.handleEvent(createEvent('timer.session-deferred-resumes.tick'), context);
    expect(launchSessionDeferredResume).not.toHaveBeenCalled();

    currentTime = new Date('2026-03-08T12:05:01.000Z');
    await module.handleEvent(createEvent('timer.session-deferred-resumes.tick'), context);

    expect(launchSessionDeferredResume).toHaveBeenCalledWith(expect.objectContaining({
      id: 'session-resume-1',
      sessionFile: '/tmp/sessions/1.jsonl',
      cwd: '/tmp/workspace',
      profile: 'assistant',
      prompt: 'check the logs and continue',
    }));

    const status = module.getStatus?.() as { scheduledCount?: number; runningCount?: number; launchedCount?: number };
    expect(status.scheduledCount).toBe(0);
    expect(status.runningCount).toBe(1);
    expect(status.launchedCount).toBe(1);

    await module.stop?.(context);
  });

  it('removes running session resumes when the resumed session closes', async () => {
    const stateRoot = createTempDir('session-deferred-resumes-state-');
    const launchSessionDeferredResume = vi.fn(async () => undefined);

    const module = createSessionDeferredResumesModule(
      {
        enabled: true,
        tickIntervalSeconds: 5,
        retryDelaySeconds: 30,
      },
      {
        now: () => new Date('2026-03-08T12:00:00.000Z'),
        createId: () => 'session-resume-2',
        launchSessionDeferredResume,
      },
    );

    const context = createContext(stateRoot);
    await module.start(context);

    await module.handleEvent(createEvent('session.deferred-resume.schedule', {
      sessionFile: '/tmp/sessions/2.jsonl',
      cwd: '/tmp/workspace',
      prompt: 'continue',
      dueAt: '2026-03-08T12:00:00.000Z',
    }), context);

    await module.handleEvent(createEvent('timer.session-deferred-resumes.tick'), context);
    await module.handleEvent(createEvent('session.closed', {
      deferredResumeId: 'session-resume-2',
      sessionFile: '/tmp/sessions/2.jsonl',
    }), context);

    const status = module.getStatus?.() as { runningCount?: number; completedCount?: number };
    expect(status.runningCount).toBe(0);
    expect(status.completedCount).toBe(1);

    const stateFile = join(stateRoot, 'session-deferred-resumes-state.json');
    expect(existsSync(stateFile)).toBe(true);
    const persisted = JSON.parse(readFileSync(stateFile, 'utf-8')) as { resumes: Record<string, unknown> };
    expect(Object.keys(persisted.resumes)).toEqual([]);

    await module.stop?.(context);
  });

  it('removes running session resumes when the resumed run fails', async () => {
    const stateRoot = createTempDir('session-deferred-resumes-state-');
    const launchSessionDeferredResume = vi.fn(async () => undefined);

    const module = createSessionDeferredResumesModule(
      {
        enabled: true,
        tickIntervalSeconds: 5,
        retryDelaySeconds: 30,
      },
      {
        now: () => new Date('2026-03-08T12:00:00.000Z'),
        createId: () => 'session-resume-3',
        launchSessionDeferredResume,
      },
    );

    const context = createContext(stateRoot);
    await module.start(context);

    await module.handleEvent(createEvent('session.deferred-resume.schedule', {
      sessionFile: '/tmp/sessions/3.jsonl',
      cwd: '/tmp/workspace',
      prompt: 'continue',
      dueAt: '2026-03-08T12:00:00.000Z',
    }), context);

    await module.handleEvent(createEvent('timer.session-deferred-resumes.tick'), context);
    await module.handleEvent(createEvent('pi.run.failed', {
      deferredResumeId: 'session-resume-3',
      statusCode: 1,
    }), context);

    const status = module.getStatus?.() as { runningCount?: number; failedCount?: number };
    expect(status.runningCount).toBe(0);
    expect(status.failedCount).toBe(1);

    await module.stop?.(context);
  });
});
