import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import {
  createProjectActivityEntry,
  writeProfileActivityEntry,
} from '@personal-agent/core';
import type { TasksModuleConfig } from '../config.js';
import type { DaemonModule } from './types.js';
import {
  cronMatches,
  parseTaskDefinition,
  type ParsedTaskDefinition,
  type ParsedTaskOutput,
  type ParsedTaskOutputTarget,
} from './tasks-parser.js';
import {
  createEmptyTaskState,
  loadTaskState,
  saveTaskState,
  type TaskRuntimeState,
  type TaskStateFile,
} from './tasks-store.js';
import { runTaskInIsolatedPi, type TaskRunRequest, type TaskRunResult } from './tasks-runner.js';

const TASK_FILE_SUFFIX = '.task.md';
const GATEWAY_NOTIFICATION_MAX_MESSAGE_CHARS = 12_000;

type TaskRunOutcomeStatus = 'success' | 'failed';

interface RunningTaskHandle {
  controller: AbortController;
  promise: Promise<void>;
}

interface TasksModuleState {
  knownTasks: number;
  parseErrors: number;
  runningTasks: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  skippedRuns: number;
  lastTickAt?: string;
  lastRunAt?: string;
  lastError?: string;
}

function truncateGatewayNotificationMessage(message: string): string {
  if (message.length <= GATEWAY_NOTIFICATION_MAX_MESSAGE_CHARS) {
    return message;
  }

  const marker = '\n\n[message truncated]';
  const budget = Math.max(0, GATEWAY_NOTIFICATION_MAX_MESSAGE_CHARS - marker.length);
  return `${message.slice(0, budget)}${marker}`;
}

function normalizeTaskOutput(outputText?: string): string | undefined {
  if (!outputText) {
    return undefined;
  }

  const normalized = outputText.split('\0').join('').trim();
  return normalized.length > 0 ? normalized : undefined;
}

function toTaskOutputMessage(input: {
  taskId: string;
  status: TaskRunOutcomeStatus;
  outputText?: string;
  error?: string;
}): string {
  const outputText = normalizeTaskOutput(input.outputText);

  if (input.status === 'success') {
    if (!outputText) {
      return `🗓️ Scheduled task ${input.taskId} completed.`;
    }

    return truncateGatewayNotificationMessage(outputText);
  }

  const errorLine = input.error ? `Reason: ${input.error}` : 'Reason: task run failed.';

  if (!outputText) {
    return truncateGatewayNotificationMessage(`⚠️ Scheduled task ${input.taskId} failed.\n${errorLine}`);
  }

  return truncateGatewayNotificationMessage(
    `⚠️ Scheduled task ${input.taskId} failed.\n${errorLine}\n\nOutput:\n${outputText}`,
  );
}

function shouldPublishTaskOutput(output: ParsedTaskOutput, status: TaskRunOutcomeStatus): boolean {
  if (output.when === 'always') {
    return true;
  }

  if (output.when === 'success') {
    return status === 'success';
  }

  return status === 'failed';
}

function toGatewayNotificationPayload(target: ParsedTaskOutputTarget): {
  gateway: 'telegram';
  destinationId: string;
  messageThreadId?: number;
} {
  return {
    gateway: 'telegram',
    destinationId: target.chatId,
    messageThreadId: target.messageThreadId,
  };
}

export interface TasksModuleDependencies {
  now?: () => Date;
  runTask?: (request: TaskRunRequest) => Promise<TaskRunResult>;
}

/**
 * Find Pi session IDs that were created within a ±5 minute window of a task run.
 * Sessions live at ~/.local/state/personal-agent/pi-agent/sessions/<cwd-slug>/<ts>_<uuid>.jsonl
 */
function findRelatedSessionIds(startedAt: string, endedAt: string): string[] {
  try {
    const sessionsBase = join(homedir(), '.local', 'state', 'personal-agent', 'pi-agent', 'sessions');
    if (!existsSync(sessionsBase)) return [];

    const startMs = new Date(startedAt).getTime() - 60_000;   // 1 min before
    const endMs   = new Date(endedAt).getTime()   + 60_000;   // 1 min after

    const ids: string[] = [];
    const cwdDirs = readdirSync(sessionsBase, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(sessionsBase, d.name));

    for (const dir of cwdDirs) {
      const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        // filename: 2026-03-10T19-41-53-445Z_UUID.jsonl
        // Format: 2026-03-10T19-41-53-445Z — last segment is ms before Z
        const normalized = file.slice(0, 24)
          .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
        const fileMs = new Date(normalized).getTime();
        if (!isNaN(fileMs) && fileMs >= startMs && fileMs <= endMs) {
          const uuid = file.slice(25, file.length - 5); // strip timestamp_ and .jsonl
          if (uuid) ids.push(uuid);
        }
      }
    }
    return ids;
  } catch {
    return [];
  }
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'task';
}

function sanitizeActivityIdSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'activity';
}

function toMinuteKey(at: Date): string {
  const rounded = new Date(at);
  rounded.setSeconds(0, 0);
  return rounded.toISOString();
}

function collectTaskFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [resolve(rootDir)];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (entry.name.endsWith(TASK_FILE_SUFFIX)) {
        output.push(fullPath);
      }
    }
  }

  output.sort();
  return output;
}

function ensureTaskRecord(taskState: TaskStateFile, task: ParsedTaskDefinition): TaskRuntimeState {
  const existing = taskState.tasks[task.key];

  if (existing) {
    existing.id = task.id;
    existing.filePath = task.filePath;
    existing.scheduleType = task.schedule.type;
    return existing;
  }

  const created: TaskRuntimeState = {
    id: task.id,
    filePath: task.filePath,
    scheduleType: task.schedule.type,
    running: false,
  };

  taskState.tasks[task.key] = created;
  return created;
}

function inferRepoRootFromTaskFile(filePath: string, profile: string): string | undefined {
  const normalizedPath = resolve(filePath).replace(/\\/g, '/');
  const marker = `/profiles/${profile}/agent/tasks/`;
  const markerIndex = normalizedPath.indexOf(marker);

  if (markerIndex >= 0) {
    return normalizedPath.slice(0, markerIndex) || '/';
  }

  const fallbackMarker = `/profiles/${profile}/agent/tasks`;
  const fallbackIndex = normalizedPath.indexOf(fallbackMarker);
  if (fallbackIndex >= 0) {
    return normalizedPath.slice(0, fallbackIndex) || '/';
  }

  return undefined;
}

function shouldQueueTaskNotification(task: ParsedTaskDefinition, status: TaskRunOutcomeStatus): boolean {
  if (!task.output) {
    return false;
  }

  return shouldPublishTaskOutput(task.output, status);
}

function toTaskActivitySummary(taskId: string, status: TaskRunOutcomeStatus): string {
  if (status === 'success') {
    return `Scheduled task ${taskId} completed.`;
  }

  return `Scheduled task ${taskId} failed.`;
}

function toTaskActivityDetails(input: {
  outputText?: string;
  error?: string;
  logPath?: string;
}): string | undefined {
  const sections: string[] = [];

  const outputText = normalizeTaskOutput(input.outputText);
  if (outputText) {
    sections.push(`Output:\n${outputText}`);
  }

  if (input.error) {
    sections.push(`Error:\n${input.error}`);
  }

  if (input.logPath) {
    sections.push(`Log:\n${input.logPath}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

export function createTasksModule(
  config: TasksModuleConfig,
  dependencies: TasksModuleDependencies = {},
): DaemonModule {
  const now = dependencies.now ?? (() => new Date());
  const runTask = dependencies.runTask ?? ((request: TaskRunRequest) => runTaskInIsolatedPi(request));

  const taskDir = resolve(config.taskDir);
  const tickIntervalSeconds = Math.max(5, Math.floor(config.tickIntervalSeconds));
  const maxRetries = Math.max(1, Math.floor(config.maxRetries));
  const reapAfterDays = Math.max(0, Math.floor(config.reapAfterDays));
  const defaultTimeoutSeconds = Math.max(30, Math.floor(config.defaultTimeoutSeconds));
  const runTasksInTmuxByDefault = config.runTasksInTmux ?? false;

  const state: TasksModuleState = {
    knownTasks: 0,
    parseErrors: 0,
    runningTasks: 0,
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    skippedRuns: 0,
  };

  const activeRuns = new Map<string, RunningTaskHandle>();
  let stopping = false;
  let tickInProgress = false;
  let stateFile = '';
  let runsRoot = '';
  let moduleStartedAtMs = 0;
  let taskState = createEmptyTaskState();

  const persistState = (logger: { warn: (message: string) => void }): void => {
    if (!stateFile) {
      return;
    }

    try {
      saveTaskState(stateFile, taskState);
    } catch (error) {
      const message = (error as Error).message;
      state.lastError = message;
      logger.warn(`tasks state save failed: ${message}`);
    }
  };

  const publishTaskOutputNotifications = (
    task: ParsedTaskDefinition,
    status: TaskRunOutcomeStatus,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void }; publish: (type: string, payload?: Record<string, unknown>) => boolean },
    details: {
      finishedAt: string;
      outputText?: string;
      error?: string;
      logPath?: string;
    },
  ): void => {
    if (!task.output) {
      return;
    }

    if (!shouldPublishTaskOutput(task.output, status)) {
      return;
    }

    const message = toTaskOutputMessage({
      taskId: task.id,
      status,
      outputText: details.outputText,
      error: details.error,
    });

    for (const target of task.output.targets) {
      const routedTarget = toGatewayNotificationPayload(target);
      const accepted = context.publish('gateway.notification', {
        gateway: routedTarget.gateway,
        destinationId: routedTarget.destinationId,
        ...(typeof routedTarget.messageThreadId === 'number' ? { messageThreadId: routedTarget.messageThreadId } : {}),
        message,
        taskId: task.id,
        status,
        createdAt: details.finishedAt,
        logPath: details.logPath,
      });

      if (!accepted) {
        context.logger.warn(
          `failed to enqueue gateway notification task=${task.id} gateway=${routedTarget.gateway} destination=${routedTarget.destinationId}`,
        );
      }
    }
  };

  const writeTaskActivity = (
    task: ParsedTaskDefinition,
    status: TaskRunOutcomeStatus,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void } },
    details: {
      startedAt?: string;
      finishedAt: string;
      outputText?: string;
      error?: string;
      logPath?: string;
    },
  ): void => {
    try {
      const repoRoot = inferRepoRootFromTaskFile(task.filePath, task.profile);
      if (!repoRoot) {
        context.logger.warn(`unable to infer repo root for task activity id=${task.id} file=${task.filePath}`);
        return;
      }

      const activityId = [
        'task',
        sanitizeActivityIdSegment(task.id),
        sanitizeActivityIdSegment(details.finishedAt.replace(/[.:]/g, '-')),
        status,
      ].join('-');

      // Find Pi sessions created during this task run for cross-linking
      const relatedConversationIds = details.startedAt
        ? findRelatedSessionIds(details.startedAt, details.finishedAt)
        : [];

      writeProfileActivityEntry({
        repoRoot,
        profile: task.profile,
        entry: createProjectActivityEntry({
          id: activityId,
          createdAt: details.finishedAt,
          profile: task.profile,
          kind: 'scheduled-task',
          summary: toTaskActivitySummary(task.id, status),
          details: toTaskActivityDetails(details),
          relatedConversationIds: relatedConversationIds.length > 0 ? relatedConversationIds : undefined,
          notificationState: shouldQueueTaskNotification(task, status) ? 'queued' : 'none',
        }),
      });
    } catch (error) {
      context.logger.warn(`failed to write task activity id=${task.id}: ${(error as Error).message}`);
    }
  };

  const executeTaskRun = async (
    task: ParsedTaskDefinition,
    record: TaskRuntimeState,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void }; publish: (type: string, payload?: Record<string, unknown>) => boolean },
    controller: AbortController,
  ): Promise<void> => {
    let finalResult: TaskRunResult | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      if (controller.signal.aborted) {
        break;
      }

      const result = await runTask({
        task: {
          ...task,
          timeoutSeconds: task.timeoutSeconds > 0 ? task.timeoutSeconds : defaultTimeoutSeconds,
        },
        attempt,
        runsRoot,
        signal: controller.signal,
        runInTmux: task.runInTmux ?? runTasksInTmuxByDefault,
      });

      finalResult = result;
      record.lastLogPath = result.logPath;
      record.lastAttemptCount = attempt;

      if (result.success || result.cancelled) {
        break;
      }

      if (attempt < maxRetries) {
        context.logger.warn(`task ${task.id} failed attempt ${attempt}, retrying`);
      }
    }

    record.running = false;
    record.runningStartedAt = undefined;

    const finishedAt = finalResult?.endedAt ?? now().toISOString();
    record.lastRunAt = finishedAt;
    state.lastRunAt = finishedAt;
    state.totalRuns += 1;

    if (finalResult?.success) {
      record.lastStatus = 'success';
      record.lastSuccessAt = finishedAt;
      record.lastError = undefined;
      state.successfulRuns += 1;

      if (task.schedule.type === 'at') {
        record.oneTimeResolvedAt = finishedAt;
        record.oneTimeResolvedStatus = 'success';
        record.oneTimeCompletedAt = finishedAt;
      }

      context.publish('tasks.run.completed', {
        taskId: task.id,
        filePath: task.filePath,
        completedAt: finishedAt,
        logPath: finalResult.logPath,
      });
      context.logger.info(`task completed id=${task.id} log=${finalResult.logPath}`);

      writeTaskActivity(task, 'success', context, {
        startedAt: finalResult.startedAt,
        finishedAt,
        outputText: finalResult.outputText,
        logPath: finalResult.logPath,
      });

      publishTaskOutputNotifications(task, 'success', context, {
        finishedAt,
        outputText: finalResult.outputText,
        logPath: finalResult.logPath,
      });
    } else if (finalResult?.cancelled) {
      record.lastStatus = 'skipped';
      record.lastError = finalResult.error ?? 'Task run cancelled';
      state.skippedRuns += 1;

      if (task.schedule.type === 'at') {
        record.oneTimeResolvedAt = finishedAt;
        record.oneTimeResolvedStatus = 'skipped';
      }
    } else {
      record.lastStatus = 'failed';
      record.lastFailureAt = finishedAt;
      record.lastError = finalResult?.error ?? 'Task run failed';
      state.failedRuns += 1;

      if (task.schedule.type === 'at') {
        record.oneTimeResolvedAt = finishedAt;
        record.oneTimeResolvedStatus = 'failed';
      }

      context.publish('tasks.run.failed', {
        taskId: task.id,
        filePath: task.filePath,
        failedAt: finishedAt,
        error: record.lastError,
        logPath: finalResult?.logPath,
      });
      context.logger.warn(`task failed id=${task.id} error=${record.lastError}`);

      writeTaskActivity(task, 'failed', context, {
        startedAt: finalResult?.startedAt,
        finishedAt,
        outputText: finalResult?.outputText,
        error: record.lastError,
        logPath: finalResult?.logPath,
      });

      publishTaskOutputNotifications(task, 'failed', context, {
        finishedAt,
        outputText: finalResult?.outputText,
        error: record.lastError,
        logPath: finalResult?.logPath,
      });
    }

  };

  const startTaskRun = (
    task: ParsedTaskDefinition,
    record: TaskRuntimeState,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void }; publish: (type: string, payload?: Record<string, unknown>) => boolean },
  ): void => {
    const controller = new AbortController();

    record.running = true;
    record.runningStartedAt = now().toISOString();
    record.lastStatus = 'running';
    record.lastError = undefined;

    const runPromise = executeTaskRun(task, record, context, controller)
      .catch((error) => {
        const message = (error as Error).message;
        record.running = false;
        record.runningStartedAt = undefined;
        record.lastStatus = 'failed';
        record.lastFailureAt = now().toISOString();
        record.lastError = message;
        state.failedRuns += 1;
        state.lastError = message;
        context.logger.warn(`task execution crash id=${task.id} error=${message}`);
      })
      .finally(() => {
        activeRuns.delete(task.key);
        state.runningTasks = activeRuns.size;
        persistState(context.logger);
      });

    activeRuns.set(task.key, {
      controller,
      promise: runPromise,
    });

    state.runningTasks = activeRuns.size;
  };

  const reconcileDeletedTaskState = (activeTaskKeys: Set<string>): void => {
    for (const key of Object.keys(taskState.tasks)) {
      if (activeTaskKeys.has(key)) {
        continue;
      }

      if (activeRuns.has(key)) {
        continue;
      }

      delete taskState.tasks[key];
    }
  };

  const reapResolvedOneTimeTasks = (
    currentTimeMs: number,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void } },
  ): void => {
    if (reapAfterDays <= 0) {
      return;
    }

    const reapAfterMs = reapAfterDays * 24 * 60 * 60 * 1000;

    for (const [key, record] of Object.entries(taskState.tasks)) {
      if (record.scheduleType !== 'at') {
        continue;
      }

      const resolvedAt = record.oneTimeCompletedAt ?? record.oneTimeResolvedAt;
      if (!resolvedAt) {
        continue;
      }

      const resolvedAtMs = Date.parse(resolvedAt);
      if (!Number.isFinite(resolvedAtMs)) {
        continue;
      }

      if (currentTimeMs - resolvedAtMs < reapAfterMs) {
        continue;
      }

      try {
        if (existsSync(record.filePath)) {
          rmSync(record.filePath, { force: true });
        }

        const taskRunDir = join(runsRoot, sanitizePathSegment(record.id));
        if (existsSync(taskRunDir)) {
          rmSync(taskRunDir, { recursive: true, force: true });
        }

        delete taskState.tasks[key];
        context.logger.info(`reaped resolved one-time task id=${record.id} status=${record.oneTimeResolvedStatus ?? 'unknown'}`);
      } catch (error) {
        context.logger.warn(`failed to reap resolved one-time task id=${record.id}: ${(error as Error).message}`);
      }
    }
  };

  const runTick = async (
    context: {
      logger: { info: (message: string) => void; warn: (message: string) => void };
      publish: (type: string, payload?: Record<string, unknown>) => boolean;
    },
  ): Promise<void> => {
    if (tickInProgress || stopping) {
      return;
    }

    tickInProgress = true;

    try {
      const tickTime = now();
      const nowMs = tickTime.getTime();
      const nowIso = tickTime.toISOString();

      state.lastTickAt = nowIso;
      state.lastError = undefined;

      const files = collectTaskFiles(taskDir);
      const parsedTasks: ParsedTaskDefinition[] = [];
      const activeTaskKeys = new Set<string>();
      let parseErrors = 0;

      for (const filePath of files) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const parsed = parseTaskDefinition({
            filePath,
            rawContent: content,
            defaultTimeoutSeconds,
          });
          parsedTasks.push(parsed);
          activeTaskKeys.add(parsed.key);
        } catch (error) {
          parseErrors += 1;
          context.logger.warn(`invalid task file ${filePath}: ${(error as Error).message}`);
        }
      }

      state.knownTasks = parsedTasks.length;
      state.parseErrors = parseErrors;

      reconcileDeletedTaskState(activeTaskKeys);

      const minuteKey = toMinuteKey(tickTime);

      for (const task of parsedTasks) {
        const record = ensureTaskRecord(taskState, task);

        if (!task.enabled) {
          continue;
        }

        if (task.schedule.type === 'at') {
          if (record.oneTimeResolvedAt) {
            continue;
          }

          if (task.schedule.atMs < moduleStartedAtMs) {
            record.lastStatus = 'skipped';
            record.lastRunAt = nowIso;
            record.lastError = 'Task skipped because daemon was offline at scheduled time';
            record.oneTimeResolvedAt = nowIso;
            record.oneTimeResolvedStatus = 'skipped';
            state.skippedRuns += 1;
            continue;
          }

          if (nowMs < task.schedule.atMs) {
            continue;
          }

          if (activeRuns.has(task.key)) {
            record.lastStatus = 'skipped';
            record.lastRunAt = nowIso;
            record.lastError = 'Task skipped because a previous run is still active';
            record.oneTimeResolvedAt = nowIso;
            record.oneTimeResolvedStatus = 'skipped';
            state.skippedRuns += 1;
            continue;
          }

          startTaskRun(task, record, context);
          continue;
        }

        if (!cronMatches(task.schedule.parsed, tickTime)) {
          continue;
        }

        if (record.lastScheduledMinute === minuteKey) {
          continue;
        }

        record.lastScheduledMinute = minuteKey;

        if (activeRuns.has(task.key)) {
          record.lastStatus = 'skipped';
          record.lastRunAt = nowIso;
          record.lastError = 'Task skipped because a previous run is still active';
          state.skippedRuns += 1;
          continue;
        }

        startTaskRun(task, record, context);
      }

      reapResolvedOneTimeTasks(nowMs, context);

      state.runningTasks = activeRuns.size;
      persistState(context.logger);

      context.publish('tasks.tick.completed', {
        knownTasks: state.knownTasks,
        parseErrors: state.parseErrors,
        runningTasks: state.runningTasks,
        at: nowIso,
      });
    } catch (error) {
      const message = (error as Error).message;
      state.lastError = message;
      context.logger.warn(`tasks tick failed: ${message}`);
    } finally {
      tickInProgress = false;
    }
  };

  return {
    name: 'tasks',
    enabled: config.enabled,
    subscriptions: ['timer.tasks.tick'],
    timers: [
      {
        name: 'tasks-tick',
        eventType: 'timer.tasks.tick',
        intervalMs: tickIntervalSeconds * 1000,
      },
    ],

    async start(context): Promise<void> {
      moduleStartedAtMs = now().getTime();
      stateFile = join(context.paths.root, 'task-state.json');
      runsRoot = join(context.paths.root, 'task-runs');

      mkdirSync(taskDir, { recursive: true, mode: 0o700 });
      mkdirSync(runsRoot, { recursive: true, mode: 0o700 });

      taskState = loadTaskState(stateFile, context.logger);
      state.runningTasks = 0;

      await runTick(context);
    },

    async handleEvent(event, context): Promise<void> {
      if (event.type !== 'timer.tasks.tick') {
        return;
      }

      await runTick(context);
    },

    async stop(context): Promise<void> {
      stopping = true;

      const activeHandles = [...activeRuns.values()];
      for (const handle of activeHandles) {
        handle.controller.abort();
      }

      await Promise.allSettled(activeHandles.map((handle) => handle.promise));

      state.runningTasks = activeRuns.size;
      persistState(context.logger);
    },

    getStatus(): Record<string, unknown> {
      return {
        taskDir,
        stateFile,
        runsRoot,
        knownTasks: state.knownTasks,
        parseErrors: state.parseErrors,
        runningTasks: state.runningTasks,
        runTasksInTmuxByDefault,
        totalRuns: state.totalRuns,
        successfulRuns: state.successfulRuns,
        failedRuns: state.failedRuns,
        skippedRuns: state.skippedRuns,
        lastTickAt: state.lastTickAt,
        lastRunAt: state.lastRunAt,
        lastError: state.lastError,
      };
    },
  };
}
