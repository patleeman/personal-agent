import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConfig } from '../config.js';
import type { DaemonEvent, DaemonPaths, EventPayload } from '../types.js';
import type { DaemonModuleContext } from './types.js';
import { createTasksModule } from './tasks.js';
import type { TaskRunRequest, TaskRunResult } from './tasks-runner.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTimerEvent(): DaemonEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    version: 1,
    type: 'timer.tasks.tick',
    source: 'test',
    timestamp: new Date().toISOString(),
    payload: {
      timer: 'tasks-tick',
    },
  };
}

interface PublishedEvent {
  type: string;
  payload?: EventPayload;
}

function createContext(taskDir: string, stateRoot: string): {
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
        enabled: true,
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
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

async function waitForCondition(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createRunResult(
  request: TaskRunRequest,
  success: boolean,
  nowIso: string,
  error?: string,
  outputText?: string,
): TaskRunResult {
  return {
    success,
    startedAt: nowIso,
    endedAt: nowIso,
    exitCode: success ? 0 : 1,
    signal: null,
    timedOut: false,
    cancelled: false,
    logPath: join(request.runsRoot, `${request.task.id}-attempt-${request.attempt}.log`),
    error,
    outputText,
  };
}

describe('tasks module scheduling', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('retries one-time tasks up to 3 attempts and resolves on success', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'nightly.task.md');

    writeFileSync(taskPath, `---\nid: nightly\nat: "2026-03-02T10:00:05.000Z"\n---\nRun nightly update\n`);

    let currentTime = new Date('2026-03-02T10:00:00.000Z');

    const runTask = vi.fn(async (request: TaskRunRequest) => {
      const nowIso = currentTime.toISOString();
      if (request.attempt < 3) {
        return createRunResult(request, false, nowIso, `failed attempt ${request.attempt}`);
      }

      return createRunResult(request, true, nowIso);
    });

    const module = createTasksModule(
      {
        enabled: true,
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      {
        now: () => currentTime,
        runTask,
      },
    );

    const { context, published } = createContext(taskDir, stateRoot);

    await module.start(context);

    currentTime = new Date('2026-03-02T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    await waitForCondition(() => {
      const status = module.getStatus?.() as { totalRuns?: number };
      return (status.totalRuns ?? 0) === 1;
    });

    expect(runTask).toHaveBeenCalledTimes(3);

    const status = module.getStatus?.() as {
      successfulRuns?: number;
      failedRuns?: number;
      runningTasks?: number;
    };

    expect(status.successfulRuns).toBe(1);
    expect(status.failedRuns).toBe(0);
    expect(status.runningTasks).toBe(0);

    currentTime = new Date('2026-03-02T10:01:00.000Z');
    await module.handleEvent(createTimerEvent(), context);

    expect(runTask).toHaveBeenCalledTimes(3);
    expect(published.some((event) => event.type === 'tasks.run.completed')).toBe(true);

    await module.stop?.(context);
  });

  it('passes daemon execution mode from module defaults with per-task overrides', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');

    writeFileSync(
      join(taskDir, 'default-mode.task.md'),
      `---\nid: default-mode\nat: "2026-03-02T10:00:00.000Z"\n---\nRun using module default\n`,
    );

    writeFileSync(
      join(taskDir, 'override-mode.task.md'),
      `---\nid: override-mode\nat: "2026-03-02T10:00:00.000Z"\nrunInTmux: true\n---\nRun with tmux override\n`,
    );

    let currentTime = new Date('2026-03-02T09:59:00.000Z');
    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(request, true, currentTime.toISOString()));

    const module = createTasksModule(
      {
        enabled: true,
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
        runTasksInTmux: false,
      },
      {
        now: () => currentTime,
        runTask,
      },
    );

    const { context } = createContext(taskDir, stateRoot);

    await module.start(context);

    currentTime = new Date('2026-03-02T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    await waitForCondition(() => {
      const status = module.getStatus?.() as { totalRuns?: number };
      return (status.totalRuns ?? 0) === 2;
    });

    const runModes = runTask.mock.calls
      .map(([request]: [TaskRunRequest]) => ({ id: request.task.id, runInTmux: request.runInTmux }))
      .sort((left, right) => left.id.localeCompare(right.id));

    expect(runModes).toEqual([
      { id: 'default-mode', runInTmux: false },
      { id: 'override-mode', runInTmux: true },
    ]);

    await module.stop?.(context);
  });

  it('publishes gateway notifications for configured task outputs', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'reminder.task.md');

    writeFileSync(taskPath, `---
id: reminder
at: "2026-03-02T10:00:00.000Z"
output:
  when: always
  targets:
    - gateway: telegram
      chatId: "123"
      messageThreadId: 22
---
Send reminder
`);

    let currentTime = new Date('2026-03-02T09:59:00.000Z');

    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(
      request,
      true,
      currentTime.toISOString(),
      undefined,
      'Reminder: stand up and stretch.',
    ));

    const module = createTasksModule(
      {
        enabled: true,
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      {
        now: () => currentTime,
        runTask,
      },
    );

    const { context, published } = createContext(taskDir, stateRoot);

    await module.start(context);

    currentTime = new Date('2026-03-02T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    await waitForCondition(() => {
      const status = module.getStatus?.() as { totalRuns?: number };
      return (status.totalRuns ?? 0) === 1;
    });

    const notifications = published.filter((event) => event.type === 'gateway.notification');
    expect(notifications.length).toBe(1);
    expect(notifications[0]?.payload).toMatchObject({
      gateway: 'telegram',
      destinationId: '123',
      messageThreadId: 22,
      taskId: 'reminder',
      status: 'success',
    });

    const message = notifications[0]?.payload?.message;
    expect(typeof message).toBe('string');
    expect(String(message)).toContain('Reminder: stand up and stretch.');

    await module.stop?.(context);
  });

  it('publishes failure outputs when task output.when is failure', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'failing.task.md');

    writeFileSync(taskPath, `---
id: failing
at: "2026-03-02T10:00:00.000Z"
output:
  when: failure
  targets:
    - gateway: telegram
      chatId: "channel-1"
---
This run should fail
`);

    let currentTime = new Date('2026-03-02T09:59:00.000Z');

    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(
      request,
      false,
      currentTime.toISOString(),
      'pi exited with code 1',
      'failure output',
    ));

    const module = createTasksModule(
      {
        enabled: true,
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 1,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      {
        now: () => currentTime,
        runTask,
      },
    );

    const { context, published } = createContext(taskDir, stateRoot);

    await module.start(context);

    currentTime = new Date('2026-03-02T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    await waitForCondition(() => {
      const status = module.getStatus?.() as { totalRuns?: number };
      return (status.totalRuns ?? 0) === 1;
    });

    const notifications = published.filter((event) => event.type === 'gateway.notification');
    expect(notifications.length).toBe(1);
    expect(notifications[0]?.payload).toMatchObject({
      gateway: 'telegram',
      destinationId: 'channel-1',
      taskId: 'failing',
      status: 'failed',
    });

    await module.stop?.(context);
  });

  it('skips overlapping cron runs when prior run is still active', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'heartbeat.task.md');

    writeFileSync(taskPath, `---\nid: heartbeat\ncron: "* * * * *"\n---\nHeartbeat task\n`);

    let currentTime = new Date('2026-03-02T10:00:00.000Z');

    let releaseRun: (() => void) | undefined;
    const runTask = vi.fn(async (request: TaskRunRequest) => {
      await new Promise<void>((resolve) => {
        releaseRun = resolve;
      });

      return createRunResult(request, true, currentTime.toISOString());
    });

    const module = createTasksModule(
      {
        enabled: true,
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      {
        now: () => currentTime,
        runTask,
      },
    );

    const { context } = createContext(taskDir, stateRoot);

    await module.start(context);

    await waitForCondition(() => runTask.mock.calls.length === 1);

    currentTime = new Date('2026-03-02T10:01:00.000Z');
    await module.handleEvent(createTimerEvent(), context);

    const midStatus = module.getStatus?.() as { skippedRuns?: number; runningTasks?: number };
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(midStatus.skippedRuns).toBe(1);
    expect(midStatus.runningTasks).toBe(1);

    releaseRun?.();

    await waitForCondition(() => {
      const status = module.getStatus?.() as { runningTasks?: number; totalRuns?: number };
      return (status.runningTasks ?? 0) === 0 && (status.totalRuns ?? 0) === 1;
    });

    await module.stop?.(context);
  });

  it('reaps completed one-time tasks after 7 days', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'cleanup.task.md');

    writeFileSync(taskPath, `---\nid: cleanup\nat: "2026-03-02T10:00:00.000Z"\n---\nCleanup task\n`);

    let currentTime = new Date('2026-03-02T09:59:00.000Z');

    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(request, true, currentTime.toISOString()));

    const module = createTasksModule(
      {
        enabled: true,
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      {
        now: () => currentTime,
        runTask,
      },
    );

    const { context } = createContext(taskDir, stateRoot);

    await module.start(context);

    currentTime = new Date('2026-03-02T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    await waitForCondition(() => {
      const status = module.getStatus?.() as { totalRuns?: number };
      return (status.totalRuns ?? 0) === 1;
    });

    expect(existsSync(taskPath)).toBe(true);

    currentTime = new Date('2026-03-10T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    expect(existsSync(taskPath)).toBe(false);

    const persistedStatePath = join(stateRoot, 'task-state.json');
    expect(existsSync(persistedStatePath)).toBe(true);

    const persistedState = JSON.parse(readFileSync(persistedStatePath, 'utf-8')) as {
      tasks: Record<string, unknown>;
    };

    expect(Object.keys(persistedState.tasks).length).toBe(0);

    await module.stop?.(context);
  });

  it('reaps skipped one-time tasks after 7 days', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'missed.task.md');

    writeFileSync(taskPath, `---\nid: missed\nat: "2026-03-02T09:00:00.000Z"\n---\nMissed task\n`);

    let currentTime = new Date('2026-03-02T10:00:00.000Z');

    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(request, true, currentTime.toISOString()));

    const module = createTasksModule(
      {
        enabled: true,
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      {
        now: () => currentTime,
        runTask,
      },
    );

    const { context } = createContext(taskDir, stateRoot);

    await module.start(context);

    expect(runTask).toHaveBeenCalledTimes(0);
    expect(existsSync(taskPath)).toBe(true);

    currentTime = new Date('2026-03-10T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    expect(existsSync(taskPath)).toBe(false);

    const persistedStatePath = join(stateRoot, 'task-state.json');
    expect(existsSync(persistedStatePath)).toBe(true);

    const persistedState = JSON.parse(readFileSync(persistedStatePath, 'utf-8')) as {
      tasks: Record<string, unknown>;
    };

    expect(Object.keys(persistedState.tasks).length).toBe(0);

    await module.stop?.(context);
  });
});
