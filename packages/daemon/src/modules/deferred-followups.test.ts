import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DaemonConfig } from '../config.js';
import type { DaemonEvent, DaemonPaths, EventPayload } from '../types.js';
import type { DaemonModuleContext } from './types.js';
import { createDeferredFollowUpsModule } from './deferred-followups.js';

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

interface PublishedEvent {
  type: string;
  payload?: EventPayload;
}

function createContext(stateRoot: string): {
  context: DaemonModuleContext;
  published: PublishedEvent[];
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
        taskDir: join(stateRoot, 'tasks'),
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      deferredFollowUps: {
        enabled: true,
        tickIntervalSeconds: 5,
        requeueDelaySeconds: 30,
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
        warn: () => undefined,
        error: () => undefined,
      },
    },
    published,
  };
}

describe('deferred follow-ups module', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('schedules deferred follow-ups and publishes due items', async () => {
    const stateRoot = createTempDir('deferred-module-state-');
    let currentTime = new Date('2026-03-08T12:00:00.000Z');

    const module = createDeferredFollowUpsModule(
      {
        enabled: true,
        tickIntervalSeconds: 5,
        requeueDelaySeconds: 30,
      },
      {
        now: () => currentTime,
        createId: () => 'resume-1',
      },
    );

    const { context, published } = createContext(stateRoot);

    await module.start(context);

    await module.handleEvent(createEvent('gateway.deferred-followup.schedule', {
      gateway: 'telegram',
      conversationId: '1::thread:22',
      sessionFile: '/tmp/sessions/1.thread-22.jsonl',
      prompt: 'Resume this conversation.',
      dueAt: '2026-03-08T12:05:00.000Z',
      initiatedByUserId: '42',
      telegramChatType: 'supergroup',
    }), context);

    await module.handleEvent(createEvent('timer.deferred-followups.tick'), context);

    const readyBeforeDue = published.filter((event) => event.type === 'gateway.deferred-followup.ready');
    expect(readyBeforeDue).toHaveLength(0);

    currentTime = new Date('2026-03-08T12:05:01.000Z');
    await module.handleEvent(createEvent('timer.deferred-followups.tick'), context);

    const readyEvents = published.filter((event) => event.type === 'gateway.deferred-followup.ready');
    expect(readyEvents).toHaveLength(1);
    expect(readyEvents[0]?.payload).toMatchObject({
      id: 'resume-1',
      gateway: 'telegram',
      conversationId: '1::thread:22',
      sessionFile: '/tmp/sessions/1.thread-22.jsonl',
      prompt: 'Resume this conversation.',
      initiatedByUserId: '42',
      telegramChatType: 'supergroup',
    });

    const status = module.getStatus?.() as { scheduledCount?: number; queuedCount?: number };
    expect(status.scheduledCount).toBe(0);
    expect(status.queuedCount).toBe(1);

    await module.stop?.(context);
  });

  it('removes delivered follow-ups from persisted state', async () => {
    const stateRoot = createTempDir('deferred-module-state-');
    let currentTime = new Date('2026-03-08T12:00:00.000Z');

    const module = createDeferredFollowUpsModule(
      {
        enabled: true,
        tickIntervalSeconds: 5,
        requeueDelaySeconds: 30,
      },
      {
        now: () => currentTime,
        createId: () => 'resume-2',
      },
    );

    const { context } = createContext(stateRoot);

    await module.start(context);

    await module.handleEvent(createEvent('gateway.deferred-followup.schedule', {
      gateway: 'discord',
      conversationId: 'channel-1',
      sessionFile: '/tmp/sessions/channel-1.jsonl',
      prompt: 'Resume now.',
      dueAt: '2026-03-08T12:00:00.000Z',
    }), context);

    await module.handleEvent(createEvent('timer.deferred-followups.tick'), context);

    await module.handleEvent(createEvent('gateway.deferred-followup.delivered', {
      id: 'resume-2',
    }), context);

    const status = module.getStatus?.() as { scheduledCount?: number; queuedCount?: number; deliveredCount?: number };
    expect(status.scheduledCount).toBe(0);
    expect(status.queuedCount).toBe(0);
    expect(status.deliveredCount).toBe(1);

    const stateFile = join(stateRoot, 'deferred-followups-state.json');
    expect(existsSync(stateFile)).toBe(true);

    const persisted = JSON.parse(readFileSync(stateFile, 'utf-8')) as {
      followUps: Record<string, unknown>;
    };

    expect(Object.keys(persisted.followUps)).toEqual([]);

    currentTime = new Date('2026-03-08T12:10:00.000Z');
    await module.handleEvent(createEvent('timer.deferred-followups.tick'), context);

    await module.stop?.(context);
  });

  it('requeues queued follow-ups and retries after delay', async () => {
    const stateRoot = createTempDir('deferred-module-state-');
    let currentTime = new Date('2026-03-08T12:00:00.000Z');

    const module = createDeferredFollowUpsModule(
      {
        enabled: true,
        tickIntervalSeconds: 5,
        requeueDelaySeconds: 60,
      },
      {
        now: () => currentTime,
        createId: () => 'resume-3',
      },
    );

    const { context, published } = createContext(stateRoot);

    await module.start(context);

    await module.handleEvent(createEvent('gateway.deferred-followup.schedule', {
      gateway: 'telegram',
      conversationId: '1',
      sessionFile: '/tmp/sessions/1.jsonl',
      prompt: 'Retry me.',
      dueAt: '2026-03-08T12:00:00.000Z',
    }), context);

    await module.handleEvent(createEvent('timer.deferred-followups.tick'), context);

    await module.handleEvent(createEvent('gateway.deferred-followup.requeue', {
      id: 'resume-3',
      delaySeconds: 120,
    }), context);

    currentTime = new Date('2026-03-08T12:01:59.000Z');
    await module.handleEvent(createEvent('timer.deferred-followups.tick'), context);

    let readyEvents = published.filter((event) => event.type === 'gateway.deferred-followup.ready');
    expect(readyEvents).toHaveLength(1);

    currentTime = new Date('2026-03-08T12:02:01.000Z');
    await module.handleEvent(createEvent('timer.deferred-followups.tick'), context);

    readyEvents = published.filter((event) => event.type === 'gateway.deferred-followup.ready');
    expect(readyEvents).toHaveLength(2);

    const status = module.getStatus?.() as { requeuedCount?: number; queuedCount?: number };
    expect(status.requeuedCount).toBe(1);
    expect(status.queuedCount).toBe(1);

    await module.stop?.(context);
  });

  it('replays queued follow-ups after restart by resetting them to scheduled', async () => {
    const stateRoot = createTempDir('deferred-module-state-');
    let currentTime = new Date('2026-03-08T12:00:00.000Z');

    const moduleA = createDeferredFollowUpsModule(
      {
        enabled: true,
        tickIntervalSeconds: 5,
        requeueDelaySeconds: 30,
      },
      {
        now: () => currentTime,
        createId: () => 'resume-4',
      },
    );

    const first = createContext(stateRoot);
    await moduleA.start(first.context);

    await moduleA.handleEvent(createEvent('gateway.deferred-followup.schedule', {
      gateway: 'telegram',
      conversationId: '1',
      sessionFile: '/tmp/sessions/1.jsonl',
      prompt: 'Resume after restart.',
      dueAt: '2026-03-08T12:00:00.000Z',
    }), first.context);

    await moduleA.handleEvent(createEvent('timer.deferred-followups.tick'), first.context);
    expect(first.published.filter((event) => event.type === 'gateway.deferred-followup.ready')).toHaveLength(1);

    await moduleA.stop?.(first.context);

    const moduleB = createDeferredFollowUpsModule(
      {
        enabled: true,
        tickIntervalSeconds: 5,
        requeueDelaySeconds: 30,
      },
      {
        now: () => currentTime,
        createId: () => 'resume-4b',
      },
    );

    const second = createContext(stateRoot);
    await moduleB.start(second.context);

    const replayedReadyEvents = second.published.filter((event) => event.type === 'gateway.deferred-followup.ready');
    expect(replayedReadyEvents).toHaveLength(1);
    expect(replayedReadyEvents[0]?.payload).toMatchObject({
      id: 'resume-4',
      prompt: 'Resume after restart.',
    });

    await moduleB.stop?.(second.context);
  });
});
