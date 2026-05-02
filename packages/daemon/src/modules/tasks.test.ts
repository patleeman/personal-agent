import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { listProfileActivityEntries, loadDeferredResumeState, openSqliteDatabase, setTaskCallbackBinding } from '@personal-agent/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConfig } from '../config.js';
import {
  appendAutomationActivityEntry,
  closeAutomationDbs,
  createStoredAutomation,
  listAutomationActivityEntries,
  listStoredAutomations,
  loadAutomationRuntimeStateMap,
  loadAutomationSchedulerState,
  saveAutomationSchedulerState,
  setStoredAutomationThreadBinding,
} from '../automation-store.js';
import {
  createDurableRunManifest,
  createInitialDurableRunStatus,
  loadDurableRunManifest,
  loadDurableRunStatus,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  resolveRuntimeDbPath,
  saveDurableRunManifest,
  saveDurableRunStatus,
} from '../runs/store.js';
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

function createRequestedTaskRunEvent(taskId: string, runId?: string): DaemonEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    version: 1,
    type: 'tasks.run.requested',
    source: 'test',
    timestamp: new Date().toISOString(),
    payload: {
      taskId,
      ...(runId ? { runId } : {}),
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
    closeAutomationDbs();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('rejects fractional automation timeouts when storing tasks', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    expect(() => createStoredAutomation({
      dbPath,
      id: 'fractional-timeout',
      profile: 'assistant',
      title: 'Fractional timeout',
      enabled: true,
      cron: '0 * * * *',
      timeoutSeconds: 1.5,
      prompt: 'Run maintenance.',
    })).toThrow('timeoutSeconds must be a positive integer.');
  });

  it('rejects unsafe automation durations when storing tasks', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    expect(() => createStoredAutomation({
      dbPath,
      id: 'unsafe-timeout',
      profile: 'assistant',
      title: 'Unsafe timeout',
      enabled: true,
      cron: '0 * * * *',
      timeoutSeconds: Number.MAX_SAFE_INTEGER + 1,
      prompt: 'Run maintenance.',
    })).toThrow('timeoutSeconds must be a positive integer.');

    expect(() => createStoredAutomation({
      dbPath,
      id: 'huge-timeout',
      profile: 'assistant',
      title: 'Huge timeout',
      enabled: true,
      cron: '0 * * * *',
      timeoutSeconds: Number.MAX_SAFE_INTEGER,
      prompt: 'Run maintenance.',
    })).toThrow('timeoutSeconds must be a positive integer.');

    expect(() => createStoredAutomation({
      dbPath,
      id: 'unsafe-catch-up',
      profile: 'assistant',
      title: 'Unsafe catch-up',
      enabled: true,
      cron: '0 * * * *',
      timeoutSeconds: 60,
      catchUpWindowSeconds: Number.MAX_SAFE_INTEGER + 1,
      prompt: 'Run maintenance.',
    })).toThrow('catchUpWindowSeconds must be a positive integer.');

    expect(() => createStoredAutomation({
      dbPath,
      id: 'huge-catch-up',
      profile: 'assistant',
      title: 'Huge catch-up',
      enabled: true,
      cron: '0 * * * *',
      timeoutSeconds: 60,
      catchUpWindowSeconds: Number.MAX_SAFE_INTEGER,
      prompt: 'Run maintenance.',
    })).toThrow('catchUpWindowSeconds must be a positive integer.');
  });

  it('normalizes one-time automation timestamps when storing tasks', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    const automation = createStoredAutomation({
      dbPath,
      id: 'normalized-at',
      profile: 'assistant',
      title: 'Normalized at',
      enabled: true,
      at: '2026-03-02T10:00:00Z',
      timeoutSeconds: 60,
      prompt: 'Run maintenance.',
    });

    expect(automation.schedule).toEqual(expect.objectContaining({
      type: 'at',
      at: '2026-03-02T10:00:00.000Z',
    }));
  });

  it('rejects malformed one-time automation timestamps when storing tasks', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    expect(() => createStoredAutomation({
      dbPath,
      id: 'malformed-at',
      profile: 'assistant',
      title: 'Malformed at',
      enabled: true,
      at: '9999',
      timeoutSeconds: 60,
      prompt: 'Run maintenance.',
    })).toThrow('Invalid at timestamp: 9999');
  });

  it('does not floor fractional automation activity limits', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    createStoredAutomation({
      dbPath,
      id: 'activity-limit',
      profile: 'assistant',
      title: 'Activity limit',
      enabled: true,
      cron: '0 * * * *',
      prompt: 'Run maintenance.',
    });

    appendAutomationActivityEntry('activity-limit', {
      kind: 'missed',
      createdAt: '2026-03-02T10:00:00.000Z',
      count: 1,
      firstScheduledAt: '2026-03-02T10:00:00.000Z',
      lastScheduledAt: '2026-03-02T10:00:00.000Z',
      exampleScheduledAt: ['2026-03-02T10:00:00.000Z'],
      outcome: 'skipped',
    }, { dbPath });
    appendAutomationActivityEntry('activity-limit', {
      kind: 'missed',
      createdAt: '2026-03-02T11:00:00.000Z',
      count: 1,
      firstScheduledAt: '2026-03-02T11:00:00.000Z',
      lastScheduledAt: '2026-03-02T11:00:00.000Z',
      exampleScheduledAt: ['2026-03-02T11:00:00.000Z'],
      outcome: 'skipped',
    }, { dbPath });

    expect(listAutomationActivityEntries('activity-limit', { dbPath, limit: 1.5 })).toHaveLength(2);
  });

  it('does not clamp unsafe automation activity limits', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    createStoredAutomation({
      dbPath,
      id: 'unsafe-activity-limit',
      profile: 'assistant',
      title: 'Unsafe activity limit',
      enabled: true,
      cron: '0 * * * *',
      prompt: 'Run maintenance.',
    });

    for (let index = 0; index < 21; index += 1) {
      const hour = String(index).padStart(2, '0');
      appendAutomationActivityEntry('unsafe-activity-limit', {
        kind: 'missed',
        createdAt: `2026-03-02T${hour}:00:00.000Z`,
        count: 1,
        firstScheduledAt: `2026-03-02T${hour}:00:00.000Z`,
        lastScheduledAt: `2026-03-02T${hour}:00:00.000Z`,
        exampleScheduledAt: [`2026-03-02T${hour}:00:00.000Z`],
        outcome: 'skipped',
      }, { dbPath });
    }

    expect(listAutomationActivityEntries('unsafe-activity-limit', { dbPath, limit: Number.MAX_SAFE_INTEGER + 1 })).toHaveLength(20);
  });

  it('rejects unsafe automation activity counts', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    createStoredAutomation({
      dbPath,
      id: 'unsafe-activity-count',
      profile: 'assistant',
      title: 'Unsafe activity count',
      enabled: true,
      cron: '0 * * * *',
      prompt: 'Run maintenance.',
    });

    expect(() => appendAutomationActivityEntry('unsafe-activity-count', {
      kind: 'missed',
      createdAt: '2026-03-02T10:00:00.000Z',
      count: Number.MAX_SAFE_INTEGER + 1,
      firstScheduledAt: '2026-03-02T10:00:00.000Z',
      lastScheduledAt: '2026-03-02T10:00:00.000Z',
      exampleScheduledAt: ['2026-03-02T10:00:00.000Z'],
      outcome: 'skipped',
    }, { dbPath })).toThrow('Automation activity count must be a positive integer.');
  });

  it('rejects invalid automation activity timestamps with field errors', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);
    createStoredAutomation({
      dbPath,
      id: 'invalid-activity-time',
      profile: 'assistant',
      title: 'Invalid activity time',
      enabled: true,
      cron: '0 * * * *',
      prompt: 'Run maintenance.',
    });

    expect(() => appendAutomationActivityEntry('invalid-activity-time', {
      kind: 'missed',
      createdAt: 'not-a-date',
      count: 1,
      firstScheduledAt: '2026-03-02T10:00:00.000Z',
      lastScheduledAt: '2026-03-02T10:00:00.000Z',
      exampleScheduledAt: ['2026-03-02T10:00:00.000Z'],
      outcome: 'skipped',
    }, { dbPath })).toThrow('Automation activity createdAt must be a valid timestamp.');

    expect(() => appendAutomationActivityEntry('invalid-activity-time', {
      kind: 'missed',
      createdAt: '2026-03-02T10:00:00.000Z',
      count: 1,
      firstScheduledAt: 'not-a-date',
      lastScheduledAt: '2026-03-02T10:00:00.000Z',
      exampleScheduledAt: ['2026-03-02T10:00:00.000Z'],
      outcome: 'skipped',
    }, { dbPath })).toThrow('Automation activity firstScheduledAt must be a valid timestamp.');
  });

  it('skips persisted automation activity rows with malformed created times', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);
    createStoredAutomation({
      dbPath,
      id: 'corrupt-activity-time',
      profile: 'assistant',
      title: 'Corrupt activity time',
      enabled: true,
      cron: '0 * * * *',
      prompt: 'Run maintenance.',
    });
    appendAutomationActivityEntry('corrupt-activity-time', {
      kind: 'missed',
      createdAt: '2026-03-02T10:00:00.000Z',
      count: 1,
      firstScheduledAt: '2026-03-02T10:00:00.000Z',
      lastScheduledAt: '2026-03-02T10:00:00.000Z',
      exampleScheduledAt: ['2026-03-02T10:00:00.000Z'],
      outcome: 'skipped',
    }, { dbPath });
    openSqliteDatabase(dbPath)
      .prepare('UPDATE automation_activity SET created_at = ? WHERE automation_id = ?')
      .run('not-a-date', 'corrupt-activity-time');

    expect(listAutomationActivityEntries('corrupt-activity-time', { dbPath })).toEqual([]);
  });

  it('skips persisted automation activity rows with non-ISO created times', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);
    createStoredAutomation({
      dbPath,
      id: 'non-iso-activity-time',
      profile: 'assistant',
      title: 'Non ISO activity time',
      enabled: true,
      cron: '0 * * * *',
      prompt: 'Run maintenance.',
    });
    appendAutomationActivityEntry('non-iso-activity-time', {
      kind: 'missed',
      createdAt: '2026-03-02T10:00:00.000Z',
      count: 1,
      firstScheduledAt: '2026-03-02T10:00:00.000Z',
      lastScheduledAt: '2026-03-02T10:00:00.000Z',
      exampleScheduledAt: ['2026-03-02T10:00:00.000Z'],
      outcome: 'skipped',
    }, { dbPath });
    openSqliteDatabase(dbPath)
      .prepare('UPDATE automation_activity SET created_at = ? WHERE automation_id = ?')
      .run('1', 'non-iso-activity-time');

    expect(listAutomationActivityEntries('non-iso-activity-time', { dbPath })).toEqual([]);
  });

  it('drops non-ISO automation activity example timestamps', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);
    createStoredAutomation({
      dbPath,
      id: 'non-iso-activity-example-time',
      profile: 'assistant',
      title: 'Non ISO activity example time',
      enabled: true,
      cron: '0 * * * *',
      prompt: 'Run maintenance.',
    });

    appendAutomationActivityEntry('non-iso-activity-example-time', {
      kind: 'missed',
      createdAt: '2026-03-02T10:00:00.000Z',
      count: 1,
      firstScheduledAt: '2026-03-02T10:00:00.000Z',
      lastScheduledAt: '2026-03-02T10:00:00.000Z',
      exampleScheduledAt: ['1', '2026-03-02T10:00:00.000Z'],
      outcome: 'skipped',
    }, { dbPath });

    expect(listAutomationActivityEntries('non-iso-activity-example-time', { dbPath })[0]?.exampleScheduledAt).toEqual([
      '2026-03-02T10:00:00.000Z',
    ]);
  });

  it('sanitizes malformed persisted automation runtime state', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);
    createStoredAutomation({
      dbPath,
      id: 'corrupt-runtime-state',
      profile: 'assistant',
      title: 'Corrupt runtime state',
      enabled: true,
      cron: '0 * * * *',
      prompt: 'Run maintenance.',
    });
    openSqliteDatabase(dbPath).prepare(`
      INSERT INTO automation_state (
        automation_id, running_started_at, last_status, last_run_at, last_success_at,
        last_failure_at, last_attempt_count, one_time_resolved_at, one_time_resolved_status,
        one_time_completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'corrupt-runtime-state',
      'not-a-date',
      'weird',
      'bad-last-run',
      'bad-success',
      'bad-failure',
      Number.MAX_SAFE_INTEGER + 1,
      'bad-resolved',
      'weird-status',
      'bad-completed',
    );

    expect(loadAutomationRuntimeStateMap({ dbPath })['corrupt-runtime-state']).toEqual(expect.objectContaining({
      runningStartedAt: undefined,
      lastStatus: undefined,
      lastRunAt: undefined,
      lastSuccessAt: undefined,
      lastFailureAt: undefined,
      lastAttemptCount: undefined,
      oneTimeResolvedAt: undefined,
      oneTimeResolvedStatus: undefined,
      oneTimeCompletedAt: undefined,
    }));
  });

  it('sanitizes non-ISO persisted automation runtime timestamps', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);
    createStoredAutomation({
      dbPath,
      id: 'non-iso-runtime-state',
      profile: 'assistant',
      title: 'Non ISO runtime state',
      enabled: true,
      cron: '0 * * * *',
      prompt: 'Run maintenance.',
    });
    openSqliteDatabase(dbPath).prepare(`
      INSERT INTO automation_state (
        automation_id, running_started_at, last_run_at, last_success_at,
        last_failure_at, one_time_resolved_at, one_time_completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'non-iso-runtime-state',
      '1',
      '1',
      '1',
      '1',
      '1',
      '1',
    );

    expect(loadAutomationRuntimeStateMap({ dbPath })['non-iso-runtime-state']).toEqual(expect.objectContaining({
      runningStartedAt: undefined,
      lastRunAt: undefined,
      lastSuccessAt: undefined,
      lastFailureAt: undefined,
      oneTimeResolvedAt: undefined,
      oneTimeCompletedAt: undefined,
    }));
  });

  it('drops malformed persisted automation scheduler timestamps', () => {
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);
    saveAutomationSchedulerState({ lastEvaluatedAt: '2026-03-02T10:00:00.000Z' }, { dbPath });
    openSqliteDatabase(dbPath)
      .prepare('UPDATE automation_scheduler_state SET value = ? WHERE key = ?')
      .run('not-a-date', 'lastEvaluatedAt');

    expect(loadAutomationSchedulerState({ dbPath })).toEqual({});
  });

  it('normalizes malformed stored automation row timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T12:00:00.000Z'));
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);
    const automation = createStoredAutomation({
      dbPath,
      id: 'corrupt-automation-time',
      profile: 'assistant',
      title: 'Corrupt automation time',
      enabled: true,
      cron: '0 * * * *',
      prompt: 'Run maintenance.',
    });
    openSqliteDatabase(dbPath)
      .prepare('UPDATE automations SET created_at = ?, updated_at = ? WHERE id = ?')
      .run('not-a-date', 'also-not-a-date', automation.id);

    expect(listStoredAutomations({ dbPath })[0]).toEqual(expect.objectContaining({
      createdAt: '2026-03-02T12:00:00.000Z',
      updatedAt: '2026-03-02T12:00:00.000Z',
    }));
  });

  it('does not floor fractional task module timer config', () => {
    const module = createTasksModule({
      enabled: true,
      taskDir: createTempDir('tasks-module-definitions-'),
      tickIntervalSeconds: 5.5,
      maxRetries: 3,
      reapAfterDays: 7,
      defaultTimeoutSeconds: 1800,
    });

    expect(module.timers[0]?.intervalMs).toBe(30_000);
  });

  it('does not accept unsafe task module timer config', () => {
    const module = createTasksModule({
      enabled: true,
      taskDir: createTempDir('tasks-module-definitions-'),
      tickIntervalSeconds: Number.MAX_SAFE_INTEGER + 1,
      maxRetries: 3,
      reapAfterDays: 7,
      defaultTimeoutSeconds: 1800,
    });

    expect(module.timers[0]?.intervalMs).toBe(30_000);
  });

  it('falls back to the current clock when the task clock returns an invalid Date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'));
    const taskDir = createTempDir('tasks-invalid-clock-');
    const stateRoot = createTempDir('tasks-invalid-clock-state-');
    const { context } = createContext(taskDir, stateRoot);
    const module = createTasksModule(
      {
        enabled: true,
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
      { now: () => new Date(Number.NaN) },
    );

    await expect(module.start(context)).resolves.toBeUndefined();
    expect(module.getStatus?.().lastTickAt).toBe('2026-04-18T10:00:00.000Z');
    vi.useRealTimers();
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
      const status = module.getStatus?.() as { totalRuns?: number; runningTasks?: number };
      return (status.totalRuns ?? 0) === 1 && (status.runningTasks ?? 0) === 0;
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

  it('writes durable run records for scheduled task executions', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'nightly.task.md');

    writeFileSync(taskPath, `---\nid: nightly\nat: "2026-03-02T10:00:05.000Z"\nprofile: datadog\n---\nRun nightly update\n`);

    let currentTime = new Date('2026-03-02T10:00:00.000Z');

    const runTask = vi.fn(async (request: TaskRunRequest) => {
      const logPath = join(request.runsRoot, `${request.task.id}-attempt-${request.attempt}.log`);
      mkdirSync(request.runsRoot, { recursive: true });
      writeFileSync(logPath, 'nightly output\n');
      return createRunResult(request, true, currentTime.toISOString(), undefined, 'nightly output');
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

    currentTime = new Date('2026-03-02T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    await waitForCondition(() => {
      const status = module.getStatus?.() as { totalRuns?: number };
      return (status.totalRuns ?? 0) === 1;
    });

    const runsRoot = resolveDurableRunsRoot(stateRoot);
    const runIds = readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(runIds).toHaveLength(1);

    const runPaths = resolveDurableRunPaths(runsRoot, runIds[0] as string);
    expect(loadDurableRunManifest(runPaths.manifestPath)).toMatchObject({
      kind: 'scheduled-task',
      resumePolicy: 'rerun',
      source: {
        type: 'scheduled-task',
        id: 'nightly',
      },
    });
    expect(loadDurableRunStatus(runPaths.statusPath)).toMatchObject({
      status: 'completed',
      activeAttempt: 1,
      completedAt: '2026-03-02T10:00:10.000Z',
    });
    expect(readFileSync(runPaths.outputLogPath, 'utf-8')).toContain('nightly output');

    await module.stop?.(context);
  });

  it('starts requested task runs with the provided durable run id', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'run-now.task.md');
    const requestedRunId = 'task-run-now-requested';

    writeFileSync(taskPath, `---\nid: run-now\nat: "2026-03-03T10:00:00.000Z"\nprofile: datadog\n---\nRun immediately when requested\n`);

    const currentTime = new Date('2026-03-02T10:00:00.000Z');
    const runTask = vi.fn(async (request: TaskRunRequest) => {
      const logPath = join(request.runsRoot, `${request.task.id}-attempt-${request.attempt}.log`);
      mkdirSync(request.runsRoot, { recursive: true });
      writeFileSync(logPath, 'requested run output\n');
      return createRunResult(request, true, currentTime.toISOString(), undefined, 'requested run output');
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
    await module.handleEvent(createRequestedTaskRunEvent('run-now', requestedRunId), context);

    await waitForCondition(() => {
      const status = module.getStatus?.() as { totalRuns?: number };
      return (status.totalRuns ?? 0) === 1;
    });

    expect(runTask).toHaveBeenCalledTimes(1);

    const runPaths = resolveDurableRunPaths(resolveDurableRunsRoot(stateRoot), requestedRunId);
    expect(loadDurableRunManifest(runPaths.manifestPath)).toMatchObject({
      id: requestedRunId,
      source: {
        type: 'scheduled-task',
        id: 'run-now',
        filePath: taskPath,
      },
    });
    expect(loadDurableRunStatus(runPaths.statusPath)).toMatchObject({
      runId: requestedRunId,
      status: 'completed',
      completedAt: '2026-03-02T10:00:00.000Z',
    });

    await module.stop?.(context);
  });

  it('ignores requested task runs while a prior requested run is still active', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'run-now.task.md');
    const firstRunId = 'task-run-now-first';
    const secondRunId = 'task-run-now-second';

    writeFileSync(taskPath, `---\nid: run-now\nat: "2026-03-03T10:00:00.000Z"\nprofile: datadog\n---\nRun immediately when requested\n`);

    const currentTime = new Date('2026-03-02T10:00:00.000Z');
    let releaseRun: (() => void) | undefined;
    const runTask = vi.fn(async (request: TaskRunRequest) => {
      await new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
      return createRunResult(request, true, currentTime.toISOString(), undefined, 'requested run output');
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
    await module.handleEvent(createRequestedTaskRunEvent('run-now', firstRunId), context);
    await waitForCondition(() => runTask.mock.calls.length === 1);

    await module.handleEvent(createRequestedTaskRunEvent('run-now', secondRunId), context);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(runTask).toHaveBeenCalledTimes(1);
    expect(existsSync(resolveDurableRunPaths(resolveDurableRunsRoot(stateRoot), secondRunId).manifestPath)).toBe(false);

    releaseRun?.();

    await waitForCondition(() => {
      const status = module.getStatus?.() as { runningTasks?: number; totalRuns?: number };
      return (status.runningTasks ?? 0) === 0 && (status.totalRuns ?? 0) === 1;
    });

    await module.stop?.(context);
  });

  it('runs all due tasks as direct daemon subprocesses', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');

    writeFileSync(
      join(taskDir, 'default-mode.task.md'),
      `---\nid: default-mode\nat: "2026-03-02T10:00:00.000Z"\n---\nRun using default execution\n`,
    );

    writeFileSync(
      join(taskDir, 'second-run.task.md'),
      `---\nid: second-run\nat: "2026-03-02T10:00:00.000Z"\n---\nRun the second task\n`,
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

    const taskIds = runTask.mock.calls
      .map(([request]: [TaskRunRequest]) => request.task.id)
      .sort((left, right) => left.localeCompare(right));

    expect(taskIds).toEqual(['default-mode', 'second-run']);

    await module.stop?.(context);
  });

  it('does not write activity entries for successful task runs', async () => {
    const repoRoot = createTempDir('tasks-module-repo-');
    const taskDir = join(repoRoot, 'profiles', 'datadog', 'agent', 'tasks');
    mkdirSync(taskDir, { recursive: true });
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'daily-report.task.md');

    writeFileSync(taskPath, `---
id: daily-report
at: "2026-03-02T10:00:00.000Z"
profile: datadog
---
Write daily report
`);

    let currentTime = new Date('2026-03-02T09:59:00.000Z');

    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(
      request,
      true,
      currentTime.toISOString(),
      undefined,
      'Daily report generated successfully.',
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

    const { context } = createContext(taskDir, stateRoot);

    await module.start(context);

    currentTime = new Date('2026-03-02T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    await waitForCondition(() => {
      const status = module.getStatus?.() as { successfulRuns?: number };
      return (status.successfulRuns ?? 0) === 1;
    });

    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' })).toHaveLength(0);

    await module.stop?.(context);
  });

  it('keeps successful task runs out of both shared and daemon-internal activity state', async () => {
    const repoRoot = createTempDir('tasks-module-repo-');
    const taskDir = join(repoRoot, 'profiles', 'datadog', 'agent', 'tasks');
    mkdirSync(taskDir, { recursive: true });
    const stateRoot = createTempDir('tasks-module-state-');
    const daemonRoot = join(stateRoot, 'daemon');
    const taskPath = join(taskDir, 'memory-maintenance.task.md');

    writeFileSync(taskPath, `---
id: datadog-memory-maintenance
at: "2026-03-02T10:00:00.000Z"
profile: datadog
---
Maintain durable memory
`);

    let currentTime = new Date('2026-03-02T09:59:00.000Z');

    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(
      request,
      true,
      currentTime.toISOString(),
      undefined,
      'Completed the datadog memory-maintenance pass.\n\nFiles updated\n- /tmp/processed-conversations.json',
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

    const { context } = createContext(taskDir, stateRoot);
    context.paths.root = daemonRoot;
    context.paths.socketPath = join(daemonRoot, 'daemon.sock');
    context.paths.pidFile = join(daemonRoot, 'daemon.pid');
    context.paths.logDir = join(daemonRoot, 'logs');
    context.paths.logFile = join(daemonRoot, 'logs', 'daemon.log');
    mkdirSync(context.paths.logDir, { recursive: true });

    await module.start(context);

    currentTime = new Date('2026-03-02T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    await waitForCondition(() => {
      const status = module.getStatus?.() as { successfulRuns?: number };
      return (status.successfulRuns ?? 0) === 1;
    });

    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' })).toHaveLength(0);
    expect(listProfileActivityEntries({ stateRoot: daemonRoot, profile: 'datadog' })).toHaveLength(0);

    await module.stop?.(context);
  });

  it('recovers interrupted one-time task runs on startup instead of marking them missed', async () => {
    const repoRoot = createTempDir('tasks-module-repo-');
    const taskDir = join(repoRoot, 'profiles', 'datadog', 'agent', 'tasks');
    mkdirSync(taskDir, { recursive: true });
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'recover-me.task.md');
    const priorRunId = 'task-recover-me-prior';

    writeFileSync(taskPath, `---
id: recover-me
at: "2026-03-02T10:00:00.000Z"
profile: datadog
---
Recover me after restart
`);

    const runsRoot = resolveDurableRunsRoot(stateRoot);
    const priorRunPaths = resolveDurableRunPaths(runsRoot, priorRunId);
    saveDurableRunManifest(priorRunPaths.manifestPath, createDurableRunManifest({
      id: priorRunId,
      kind: 'scheduled-task',
      resumePolicy: 'rerun',
      createdAt: '2026-03-02T10:00:00.000Z',
      source: {
        type: 'scheduled-task',
        id: 'recover-me',
        filePath: taskPath,
      },
    }));
    saveDurableRunStatus(priorRunPaths.statusPath, createInitialDurableRunStatus({
      runId: priorRunId,
      status: 'running',
      createdAt: '2026-03-02T10:00:00.000Z',
      updatedAt: '2026-03-02T10:05:00.000Z',
      activeAttempt: 1,
      startedAt: '2026-03-02T10:00:00.000Z',
    }));

    writeFileSync(join(stateRoot, 'task-state.json'), JSON.stringify({
      version: 1,
      tasks: {
        [taskPath]: {
          id: 'recover-me',
          filePath: taskPath,
          scheduleType: 'at',
          running: true,
          runningStartedAt: '2026-03-02T10:00:00.000Z',
          activeRunId: priorRunId,
          lastRunId: priorRunId,
          lastStatus: 'running',
        },
      },
    }, null, 2));

    const currentTime = new Date('2026-03-02T10:30:00.000Z');
    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(
      request,
      true,
      currentTime.toISOString(),
      undefined,
      'Recovered successfully.',
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

    const { context } = createContext(taskDir, stateRoot);

    await module.start(context);

    await waitForCondition(() => {
      const status = module.getStatus?.() as { totalRuns?: number };
      if ((status.totalRuns ?? 0) !== 1) {
        return false;
      }

      const persistedState = loadAutomationRuntimeStateMap({ dbPath: resolveRuntimeDbPath(stateRoot) });
      const taskState = persistedState['recover-me'];
      return taskState?.activeRunId === undefined
        && taskState.lastRunId !== priorRunId
        && taskState.oneTimeResolvedStatus === 'success';
    });

    expect(runTask).toHaveBeenCalledTimes(1);

    const persistedState = loadAutomationRuntimeStateMap({ dbPath: resolveRuntimeDbPath(stateRoot) });
    expect(persistedState['recover-me']?.filePath).toBe(taskPath);
    expect(persistedState['recover-me']?.activeRunId).toBeUndefined();
    expect(persistedState['recover-me']?.lastRunId).not.toBe(priorRunId);
    expect(persistedState['recover-me']?.oneTimeResolvedStatus).toBe('success');

    await module.stop?.(context);
  });

  it('does not create shared activity entries when a one-time task is missed while the daemon was offline', async () => {
    const repoRoot = createTempDir('tasks-module-repo-');
    const taskDir = join(repoRoot, 'profiles', 'datadog', 'agent', 'tasks');
    mkdirSync(taskDir, { recursive: true });
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'daily-report.task.md');

    writeFileSync(taskPath, `---
id: daily-report
at: "2026-03-02T10:00:00.000Z"
profile: datadog
---
Write daily report
`);

    const currentTime = new Date('2026-03-02T10:30:00.000Z');
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

    expect(runTask).not.toHaveBeenCalled();
    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' })).toHaveLength(0);
    expect(listAutomationActivityEntries('daily-report', { dbPath: resolveRuntimeDbPath(stateRoot) })).toEqual([
      expect.objectContaining({
        automationId: 'daily-report',
        kind: 'missed',
        count: 1,
        outcome: 'skipped',
        firstScheduledAt: '2026-03-02T10:00:00.000Z',
        lastScheduledAt: '2026-03-02T10:00:00.000Z',
      }),
    ]);

    await module.stop?.(context);
  });

  it('does not create shared activity entries when cron runs are missed while the daemon is offline', async () => {
    const repoRoot = createTempDir('tasks-module-repo-');
    const taskDir = join(repoRoot, 'profiles', 'datadog', 'agent', 'tasks');
    mkdirSync(taskDir, { recursive: true });
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'hourly.task.md');

    writeFileSync(taskPath, `---
id: hourly
cron: "0 * * * *"
profile: datadog
---
Run hourly task
`);

    saveAutomationSchedulerState(
      { lastEvaluatedAt: '2026-03-02T09:59:30.000Z' },
      { dbPath: resolveRuntimeDbPath(stateRoot) },
    );

    let currentTime = new Date('2026-03-02T11:05:00.000Z');
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

    expect(runTask).not.toHaveBeenCalled();
    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' })).toHaveLength(0);

    currentTime = new Date('2026-03-02T11:05:30.000Z');
    await module.handleEvent(createTimerEvent(), context);

    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' })).toHaveLength(0);
    expect(listAutomationActivityEntries('hourly', { dbPath: resolveRuntimeDbPath(stateRoot) })).toEqual([
      expect.objectContaining({
        automationId: 'hourly',
        kind: 'missed',
        count: 2,
        outcome: 'skipped',
        firstScheduledAt: '2026-03-02T10:00:00.000Z',
        lastScheduledAt: '2026-03-02T11:00:00.000Z',
      }),
    ]);
    const persistedState = loadAutomationSchedulerState({ dbPath: resolveRuntimeDbPath(stateRoot) });
    expect(persistedState.lastEvaluatedAt).toBe('2026-03-02T11:05:30.000Z');

    await module.stop?.(context);
  });

  it('runs one catch-up cron execution when the latest missed slot is still within the automation window', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    createStoredAutomation({
      dbPath,
      id: 'morning-brief',
      profile: 'assistant',
      title: 'Morning brief',
      enabled: true,
      cron: '0 10 * * *',
      catchUpWindowSeconds: 15 * 60,
      prompt: 'Assemble the morning briefing.',
    });
    setStoredAutomationThreadBinding('morning-brief', { dbPath, mode: 'none' });

    saveAutomationSchedulerState(
      { lastEvaluatedAt: '2026-03-02T09:59:30.000-05:00' },
      { dbPath },
    );

    expect(listStoredAutomations({ dbPath })[0]?.catchUpWindowSeconds).toBe(15 * 60);

    const currentTime = new Date('2026-03-02T10:10:00.000-05:00');
    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(request, true, currentTime.toISOString()));

    const module = createTasksModule(
      {
        enabled: true,
        taskDir,
        tickIntervalSeconds: 1,
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

    expect(runTask).toHaveBeenCalledTimes(1);
    expect(runTask.mock.calls[0]?.[0].task.id).toBe('morning-brief');
    expect(listAutomationActivityEntries('morning-brief', { dbPath })).toEqual([
      expect.objectContaining({
        automationId: 'morning-brief',
        kind: 'missed',
        count: 1,
        outcome: 'catch-up-started',
        firstScheduledAt: '2026-03-02T15:00:00.000Z',
        lastScheduledAt: '2026-03-02T15:00:00.000Z',
      }),
    ]);

    await module.stop?.(context);
  });

  it('keeps cron automations skipped when the missed slot is outside the catch-up window', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    createStoredAutomation({
      dbPath,
      id: 'morning-brief',
      profile: 'assistant',
      title: 'Morning brief',
      enabled: true,
      cron: '0 10 * * *',
      catchUpWindowSeconds: 5 * 60,
      prompt: 'Assemble the morning briefing.',
    });
    setStoredAutomationThreadBinding('morning-brief', { dbPath, mode: 'none' });

    saveAutomationSchedulerState(
      { lastEvaluatedAt: '2026-03-02T09:59:30.000-05:00' },
      { dbPath },
    );

    let currentTime = new Date('2026-03-02T10:10:00.000-05:00');
    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(request, true, currentTime.toISOString()));

    const module = createTasksModule(
      {
        enabled: true,
        taskDir,
        tickIntervalSeconds: 1,
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

    expect(runTask).not.toHaveBeenCalled();
    expect(listAutomationActivityEntries('morning-brief', { dbPath })).toEqual([
      expect.objectContaining({
        automationId: 'morning-brief',
        kind: 'missed',
        count: 1,
        outcome: 'skipped',
        firstScheduledAt: '2026-03-02T15:00:00.000Z',
        lastScheduledAt: '2026-03-02T15:00:00.000Z',
      }),
    ]);

    currentTime = new Date('2026-03-02T10:10:30.000-05:00');
    await module.handleEvent(createTimerEvent(), context);

    expect(runTask).not.toHaveBeenCalled();

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

  it('creates a conversation callback wakeup for bound task completions', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const taskPath = join(taskDir, 'watch-prod.task.md');

    writeFileSync(taskPath, `---\nid: watch-prod\nat: "2026-03-02T10:00:05.000Z"\nprofile: datadog\n---\nWatch the prod gates\n`);

    setTaskCallbackBinding({
      stateRoot,
      profile: 'datadog',
      taskId: 'watch-prod',
      conversationId: 'conv-123',
      sessionFile: '/tmp/conv-123.jsonl',
      notifyOnSuccess: 'disruptive',
      notifyOnFailure: 'disruptive',
    });

    let currentTime = new Date('2026-03-02T10:00:00.000Z');
    const runTask = vi.fn(async (request: TaskRunRequest) => createRunResult(
      request,
      true,
      currentTime.toISOString(),
      undefined,
      'Confirm Kubernetes Mutations is waiting for approval.',
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

    const { context } = createContext(taskDir, stateRoot);

    await module.start(context);

    currentTime = new Date('2026-03-02T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    await waitForCondition(() => {
      const state = loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json'));
      return Object.keys(state.resumes).length === 1;
    });

    const activityEntries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(activityEntries).toHaveLength(1);
    expect(activityEntries[0]?.entry.summary).toContain('Scheduled task @watch-prod completed');

    const deferredState = loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json'));
    const callback = Object.values(deferredState.resumes)[0];
    expect(callback).toEqual(expect.objectContaining({
      kind: 'task-callback',
      status: 'ready',
      title: 'Scheduled task @watch-prod completed',
    }));

    await module.stop?.(context);
  });

  it('runs one-time conversation automations directly in their bound thread', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    createStoredAutomation({
      dbPath,
      id: 'conversation-check',
      profile: 'assistant',
      title: 'Conversation check',
      enabled: true,
      at: '2026-03-02T10:00:05.000Z',
      cwd: '/tmp/workspace',
      prompt: 'Check the deployment again.',
      targetType: 'conversation',
      conversationBehavior: 'followUp',
    });

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

    currentTime = new Date('2026-03-02T10:00:10.000Z');
    await module.handleEvent(createTimerEvent(), context);

    await waitForCondition(() => {
      const runtimeState = loadAutomationRuntimeStateMap({ dbPath });
      return runtimeState['conversation-check']?.lastStatus === 'success';
    });

    const deferredState = loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json'));
    expect(Object.keys(deferredState.resumes)).toHaveLength(0);

    const runtimeState = loadAutomationRuntimeStateMap({ dbPath });
    expect(runtimeState['conversation-check']).toEqual(expect.objectContaining({
      lastStatus: 'success',
      lastAttemptCount: 1,
      oneTimeResolvedStatus: 'success',
    }));
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(runTask.mock.calls[0]?.[0].task).toEqual(expect.objectContaining({
      id: 'conversation-check',
      targetType: 'conversation',
      threadMode: 'dedicated',
      threadConversationId: expect.any(String),
      threadSessionFile: expect.any(String),
      conversationBehavior: 'followUp',
    }));

    const runId = runtimeState['conversation-check']?.lastRunId;
    expect(runId).toBeTruthy();
    const runStatus = loadDurableRunStatus(resolveDurableRunPaths(resolveDurableRunsRoot(stateRoot), runId!).statusPath);
    expect(runStatus).toEqual(expect.objectContaining({ status: 'completed' }));

    await module.stop?.(context);
  });

  it('reruns recurring conversation automations after the prior run completes', async () => {
    const taskDir = createTempDir('tasks-module-definitions-');
    const stateRoot = createTempDir('tasks-module-state-');
    const dbPath = resolveRuntimeDbPath(stateRoot);

    createStoredAutomation({
      dbPath,
      id: 'hourly-check',
      profile: 'assistant',
      title: 'Hourly check',
      enabled: true,
      cron: '0 * * * *',
      cwd: '/tmp/workspace',
      prompt: 'Check the deployment again.',
      targetType: 'conversation',
    });

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

    currentTime = new Date('2026-03-02T10:00:00.000Z');
    await module.handleEvent(createTimerEvent(), context);
    await waitForCondition(() => {
      const status = module.getStatus?.() as { runningTasks?: number; successfulRuns?: number };
      return (status.runningTasks ?? 0) === 0 && (status.successfulRuns ?? 0) === 1;
    });

    currentTime = new Date('2026-03-02T11:00:00.000Z');
    await module.handleEvent(createTimerEvent(), context);
    await waitForCondition(() => {
      const status = module.getStatus?.() as { runningTasks?: number; successfulRuns?: number };
      return (status.runningTasks ?? 0) === 0 && (status.successfulRuns ?? 0) === 2;
    });

    const deferredState = loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json'));
    expect(Object.keys(deferredState.resumes)).toHaveLength(0);

    const runtimeState = loadAutomationRuntimeStateMap({ dbPath });
    expect(runtimeState['hourly-check']).toEqual(expect.objectContaining({
      lastStatus: 'success',
      lastError: undefined,
    }));
    const status = module.getStatus?.() as { skippedRuns?: number; successfulRuns?: number };
    expect(status.skippedRuns).toBe(0);
    expect(status.successfulRuns).toBe(2);
    expect(runTask).toHaveBeenCalledTimes(2);
    expect(runTask.mock.calls.every((call) => Boolean(call[0].task.threadSessionFile))).toBe(true);

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

    const persistedState = loadAutomationRuntimeStateMap({ dbPath: resolveRuntimeDbPath(stateRoot) });
    expect(Object.keys(persistedState).length).toBe(0);

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

    const persistedState = loadAutomationRuntimeStateMap({ dbPath: resolveRuntimeDbPath(stateRoot) });
    expect(Object.keys(persistedState).length).toBe(0);

    await module.stop?.(context);
  });
});
