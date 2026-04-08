import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import {
  createProjectActivityEntry,
  createReadyDeferredResume,
  getDurableSessionsDir,
  getTaskCallbackBinding,
  loadDeferredResumeState,
  resolveDeferredResumeStateFile,
  saveDeferredResumeState,
  setActivityConversationLinks,
  writeProfileActivityEntry,
} from '@personal-agent/core';
import type { TasksModuleConfig } from '../config.js';
import {
  deleteStoredAutomation,
  ensureLegacyTaskImports,
  getStoredAutomation,
  listStoredAutomations,
  loadAutomationRuntimeStateMap,
  loadAutomationSchedulerState,
  saveAutomationRuntimeStateMap,
  saveAutomationSchedulerState,
} from '../automation-store.js';
import {
  surfaceReadyDeferredResume,
} from '../conversation-wakeups.js';
import {
  markDeferredResumeConversationRunReady,
} from '../runs/deferred-resume-conversations.js';
import {
  appendDurableRunEvent,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  resolveRuntimeDbPath,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
  scanDurableRun,
} from '../runs/store.js';
import type { DaemonModule } from './types.js';
import {
  cronMatches,
  type ParsedCronExpression,
  type ParsedTaskDefinition,
} from './tasks-parser.js';
import {
  createEmptyTaskState,
  type TaskRuntimeState,
  type TaskStateFile,
} from './tasks-store.js';
import { runTaskInIsolatedPi, type TaskRunRequest, type TaskRunResult } from './tasks-runner.js';

const MISSED_RUN_EXAMPLE_LIMIT = 5;

interface MissedTaskRunSummary {
  count: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
  exampleScheduledAt: string[];
}

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

function normalizeTaskOutput(outputText?: string): string | undefined {
  if (!outputText) {
    return undefined;
  }

  const normalized = outputText.split('\0').join('').trim();
  return normalized.length > 0 ? normalized : undefined;
}

export interface TasksModuleDependencies {
  now?: () => Date;
  runTask?: (request: TaskRunRequest) => Promise<TaskRunResult>;
}

/**
 * Find Pi session IDs that were created within a ±5 minute window of a task run.
 * Sessions live at <stateRoot>/sync/pi-agent/sessions/<cwd-slug>/<ts>_<uuid>.jsonl.
 */
function findRelatedSessionIds(stateRoot: string, startedAt: string, endedAt: string): string[] {
  try {
    const sessionsBase = getDurableSessionsDir(stateRoot);
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

function sanitizeActivityIdSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'activity';
}

function toRunIdTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-');
}

function createScheduledTaskRunId(taskId: string, startedAt: string): string {
  return [
    'task',
    sanitizeActivityIdSegment(taskId),
    toRunIdTimestamp(startedAt),
    randomUUID().slice(0, 8),
  ].join('-');
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function copyTaskRunLogToDurableOutput(logPath: string | undefined, outputLogPath: string): void {
  if (!logPath || !existsSync(logPath)) {
    return;
  }

  const text = readFileSync(logPath, 'utf-8');
  writeFileSync(outputLogPath, text);
}

function toMinuteKey(at: Date): string {
  const rounded = new Date(at);
  rounded.setSeconds(0, 0);
  return rounded.toISOString();
}

function toMinuteStart(at: Date): Date {
  const rounded = new Date(at);
  rounded.setSeconds(0, 0);
  return rounded;
}

function toNextMinuteStart(after: Date): Date {
  const next = toMinuteStart(after);
  next.setMinutes(next.getMinutes() + 1);
  return next;
}

function formatTaskSchedule(task: ParsedTaskDefinition): string {
  if (task.schedule.type === 'cron') {
    return `cron ${task.schedule.expression}`;
  }

  return `at ${task.schedule.at}`;
}

function summarizeMissedCronRuns(
  expression: ParsedCronExpression,
  evaluatedAt: Date,
  currentTime: Date,
): MissedTaskRunSummary | undefined {
  const firstCandidate = toNextMinuteStart(evaluatedAt);
  const currentMinuteStart = toMinuteStart(currentTime);

  if (firstCandidate.getTime() >= currentMinuteStart.getTime()) {
    return undefined;
  }

  let count = 0;
  let firstScheduledAt: string | undefined;
  let lastScheduledAt: string | undefined;
  const exampleScheduledAt: string[] = [];

  for (let cursor = firstCandidate; cursor.getTime() < currentMinuteStart.getTime(); cursor = new Date(cursor.getTime() + 60_000)) {
    if (!cronMatches(expression, cursor)) {
      continue;
    }

    const scheduledAt = cursor.toISOString();
    count += 1;
    firstScheduledAt ??= scheduledAt;
    lastScheduledAt = scheduledAt;

    if (exampleScheduledAt.length < MISSED_RUN_EXAMPLE_LIMIT) {
      exampleScheduledAt.push(scheduledAt);
    }
  }

  if (!firstScheduledAt || !lastScheduledAt || count === 0) {
    return undefined;
  }

  return {
    count,
    firstScheduledAt,
    lastScheduledAt,
    exampleScheduledAt,
  };
}

function toMissedTaskActivitySummary(taskId: string, missedRunCount: number): string {
  if (missedRunCount === 1) {
    return `Scheduled task ${taskId} was missed while the daemon was offline.`;
  }

  return `Scheduled task ${taskId} missed ${missedRunCount} runs while the daemon was offline.`;
}

function toMissedTaskActivityDetails(input: {
  task: ParsedTaskDefinition;
  missedRuns: MissedTaskRunSummary;
}): string {
  const sections = [
    'Reason:\nDaemon was not running during the scheduled task window.',
    `Task:\n${input.task.title ?? input.task.id}`,
    `Schedule:\n${formatTaskSchedule(input.task)}`,
  ];

  if (!input.task.filePath.startsWith('/__automations__/')) {
    sections.push(`Legacy task file:\n${input.task.filePath}`);
  }

  if (input.missedRuns.count === 1) {
    sections.push(`Missed run:\n${input.missedRuns.firstScheduledAt}`);
  } else {
    const exampleLines = input.missedRuns.exampleScheduledAt.map((scheduledAt) => `- ${scheduledAt}`);
    const remainingCount = input.missedRuns.count - input.missedRuns.exampleScheduledAt.length;
    if (remainingCount > 0) {
      exampleLines.push(`- … ${remainingCount} more`);
    }

    sections.push([
      'Missed runs:',
      `Count: ${input.missedRuns.count}`,
      `First: ${input.missedRuns.firstScheduledAt}`,
      `Last: ${input.missedRuns.lastScheduledAt}`,
      ...(exampleLines.length > 0 ? ['', 'Examples:', ...exampleLines] : []),
    ].join('\n'));
  }

  sections.push('Next step:\nRun the task manually if it is still needed.');

  return sections.join('\n\n');
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
  let runtimeDbPath = '';
  let durableRunsRoot = '';
  let moduleStartedAtMs = 0;
  let taskState = createEmptyTaskState();

  const persistState = (logger: { warn: (message: string) => void }): void => {
    if (!runtimeDbPath) {
      return;
    }

    try {
      saveAutomationRuntimeStateMap(taskState.tasks, { dbPath: runtimeDbPath });
      saveAutomationSchedulerState({ lastEvaluatedAt: taskState.lastEvaluatedAt }, { dbPath: runtimeDbPath });
    } catch (error) {
      const message = (error as Error).message;
      state.lastError = message;
      logger.warn(`tasks state save failed: ${message}`);
    }
  };

  const writeScheduledTaskActivityEntry = (
    task: ParsedTaskDefinition,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void }; paths: { root: string; stateRoot: string } },
    activity: {
      activityId: string;
      createdAt: string;
      summary: string;
      details?: string;
      notificationState?: 'none' | 'queued' | 'sent' | 'failed';
      relatedConversationIds?: string[];
    },
  ): void => {
    writeProfileActivityEntry({
      stateRoot: context.paths.stateRoot,
      profile: task.profile,
      entry: createProjectActivityEntry({
        id: activity.activityId,
        createdAt: activity.createdAt,
        profile: task.profile,
        kind: 'scheduled-task',
        summary: activity.summary,
        details: activity.details,
        notificationState: activity.notificationState,
      }),
    });

    setActivityConversationLinks({
      stateRoot: context.paths.stateRoot,
      profile: task.profile,
      activityId: activity.activityId,
      relatedConversationIds: activity.relatedConversationIds ?? [],
      updatedAt: activity.createdAt,
    });
  };

  const formatTaskCallbackPrompt = (
    task: ParsedTaskDefinition,
    status: TaskRunOutcomeStatus,
    details: {
      outputText?: string;
      error?: string;
      logPath?: string;
      finishedAt: string;
    },
  ): string => {
    const lines = [
      status === 'success'
        ? `Scheduled task @${task.id} completed at ${details.finishedAt}.`
        : `Scheduled task @${task.id} failed at ${details.finishedAt}.`,
    ];

    if (details.error) {
      lines.push('', `Error: ${details.error}`);
    }

    if (details.outputText && details.outputText.trim().length > 0) {
      lines.push('', 'Task output:', details.outputText.trim());
    }

    if (details.logPath) {
      lines.push('', `Log: ${details.logPath}`);
    }

    lines.push('', 'Review this result, surface the important outcome to Patrick, and decide whether any follow-up is needed.');
    return lines.join('\n');
  };

  const deliverTaskCallbackWakeup = async (
    task: ParsedTaskDefinition,
    status: TaskRunOutcomeStatus,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void }; paths: { root: string; stateRoot: string } },
    details: {
      finishedAt: string;
      outputText?: string;
      error?: string;
      logPath?: string;
    },
  ): Promise<string[] | undefined> => {
    const binding = getTaskCallbackBinding({ stateRoot: context.paths.stateRoot, profile: task.profile, taskId: task.id });
    if (!binding) {
      return undefined;
    }

    const shouldDeliver = status === 'success' ? binding.deliverOnSuccess : binding.deliverOnFailure;
    if (!shouldDeliver) {
      return [binding.conversationId];
    }

    const wakeupId = [
      'task-callback',
      sanitizeActivityIdSegment(task.id),
      sanitizeActivityIdSegment(details.finishedAt.replace(/[.:]/g, '-')),
      status,
    ].join('-');
    const notifyLevel = status === 'success' ? binding.notifyOnSuccess : binding.notifyOnFailure;
    const title = status === 'success'
      ? `Scheduled task @${task.id} completed`
      : `Scheduled task @${task.id} failed`;
    const deferredResumeStateFile = resolveDeferredResumeStateFile(context.paths.stateRoot);
    const deferredState = loadDeferredResumeState(deferredResumeStateFile);
    const entry = createReadyDeferredResume(deferredState, {
      id: wakeupId,
      sessionFile: binding.sessionFile,
      prompt: formatTaskCallbackPrompt(task, status, details),
      dueAt: details.finishedAt,
      createdAt: details.finishedAt,
      readyAt: details.finishedAt,
      attempts: 0,
      kind: 'task-callback',
      title,
      source: {
        kind: 'scheduled-task',
        id: task.id,
      },
      delivery: {
        alertLevel: notifyLevel,
        autoResumeIfOpen: binding.autoResumeIfOpen,
        requireAck: binding.requireAck,
      },
    });
    saveDeferredResumeState(deferredState, deferredResumeStateFile);

    await markDeferredResumeConversationRunReady({
      daemonRoot: context.paths.root,
      deferredResumeId: entry.id,
      sessionFile: entry.sessionFile,
      prompt: entry.prompt,
      dueAt: entry.dueAt,
      createdAt: entry.createdAt,
      readyAt: entry.readyAt ?? details.finishedAt,
      profile: task.profile,
      conversationId: binding.conversationId,
    });

    surfaceReadyDeferredResume({
      entry,
      profile: task.profile,
      stateRoot: context.paths.stateRoot,
      conversationId: binding.conversationId,
    });

    return [binding.conversationId];
  };

  const writeTaskActivity = (
    task: ParsedTaskDefinition,
    status: TaskRunOutcomeStatus,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void }; paths: { root: string; stateRoot: string } },
    details: {
      startedAt?: string;
      finishedAt: string;
      outputText?: string;
      error?: string;
      logPath?: string;
      relatedConversationIdsOverride?: string[];
    },
  ): void => {
    try {
      const activityId = [
        'task',
        sanitizeActivityIdSegment(task.id),
        sanitizeActivityIdSegment(details.finishedAt.replace(/[.:]/g, '-')),
        status,
      ].join('-');

      // Find Pi sessions created during this task run for local attention linking.
      const relatedConversationIds = details.relatedConversationIdsOverride
        ?? (details.startedAt
          ? findRelatedSessionIds(context.paths.stateRoot, details.startedAt, details.finishedAt)
          : []);

      writeScheduledTaskActivityEntry(task, context, {
        activityId,
        createdAt: details.finishedAt,
        summary: toTaskActivitySummary(task.id, status),
        details: toTaskActivityDetails(details),
        notificationState: 'none',
        relatedConversationIds,
      });
    } catch (error) {
      context.logger.warn(`failed to write task activity id=${task.id}: ${(error as Error).message}`);
    }
  };

  const writeMissedTaskActivity = (
    task: ParsedTaskDefinition,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void }; paths: { root: string; stateRoot: string } },
    details: {
      detectedAt: string;
      missedRuns: MissedTaskRunSummary;
    },
  ): void => {
    try {
      const activityId = [
        'task',
        sanitizeActivityIdSegment(task.id),
        'missed',
        sanitizeActivityIdSegment(details.detectedAt.replace(/[.:]/g, '-')),
      ].join('-');

      writeScheduledTaskActivityEntry(task, context, {
        activityId,
        createdAt: details.detectedAt,
        summary: toMissedTaskActivitySummary(task.id, details.missedRuns.count),
        details: toMissedTaskActivityDetails({ task, missedRuns: details.missedRuns }),
      });
    } catch (error) {
      context.logger.warn(`failed to write missed task activity id=${task.id}: ${(error as Error).message}`);
    }
  };

  const createDurableTaskRunRecord = async (
    task: ParsedTaskDefinition,
    record: TaskRuntimeState,
    startedAt: string,
    runIdOverride?: string,
  ): Promise<{ runId: string; runPaths: ReturnType<typeof resolveDurableRunPaths>; attemptsRoot: string }> => {
    const runId = runIdOverride ?? createScheduledTaskRunId(task.id, startedAt);
    const runPaths = resolveDurableRunPaths(durableRunsRoot, runId);
    const attemptsRoot = join(runPaths.root, 'attempts');

    mkdirSync(runPaths.root, { recursive: true, mode: 0o700 });
    mkdirSync(attemptsRoot, { recursive: true, mode: 0o700 });

    saveDurableRunManifest(runPaths.manifestPath, createDurableRunManifest({
      id: runId,
      kind: 'scheduled-task',
      resumePolicy: 'rerun',
      createdAt: startedAt,
      spec: {
        taskId: task.id,
        title: task.title ?? task.id,
        filePath: task.filePath.startsWith('/__automations__/') ? undefined : task.filePath,
        profile: task.profile,
        scheduleType: task.schedule.type,
        schedule: formatTaskSchedule(task),
        cwd: task.cwd,
        modelRef: task.modelRef,
      },
      source: {
        type: 'scheduled-task',
        id: task.id,
        ...(task.filePath.startsWith('/__automations__/') ? {} : { filePath: task.filePath }),
      },
    }));

    saveDurableRunStatus(runPaths.statusPath, createInitialDurableRunStatus({
      runId,
      status: 'running',
      createdAt: startedAt,
      updatedAt: startedAt,
      activeAttempt: 0,
      startedAt,
    }));

    saveDurableRunCheckpoint(runPaths.checkpointPath, {
      version: 1,
      runId,
      updatedAt: startedAt,
      step: 'scheduled',
      payload: {
        taskId: task.id,
        filePath: task.filePath,
      },
    });

    await appendDurableRunEvent(runPaths.eventsPath, {
      version: 1,
      runId,
      timestamp: startedAt,
      type: 'run.created',
      payload: {
        kind: 'scheduled-task',
        taskId: task.id,
        schedule: formatTaskSchedule(task),
      },
    });

    record.activeRunId = runId;
    record.lastRunId = runId;
    return { runId, runPaths, attemptsRoot };
  };

  const executeTaskRun = async (
    task: ParsedTaskDefinition,
    record: TaskRuntimeState,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void }; publish: (type: string, payload?: Record<string, unknown>) => boolean; paths: { root: string; stateRoot: string } },
    controller: AbortController,
    options: { runIdOverride?: string } = {},
  ): Promise<void> => {
    const startedAt = record.runningStartedAt ?? now().toISOString();
    const durableRun = await createDurableTaskRunRecord(task, record, startedAt, options.runIdOverride);
    let finalResult: TaskRunResult | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      if (controller.signal.aborted) {
        break;
      }

      saveDurableRunStatus(durableRun.runPaths.statusPath, createInitialDurableRunStatus({
        runId: durableRun.runId,
        status: 'running',
        createdAt: startedAt,
        updatedAt: now().toISOString(),
        activeAttempt: attempt,
        startedAt,
      }));

      await appendDurableRunEvent(durableRun.runPaths.eventsPath, {
        version: 1,
        runId: durableRun.runId,
        timestamp: now().toISOString(),
        type: 'run.attempt.started',
        attempt,
        payload: {
          taskId: task.id,
        },
      });

      const result = await runTask({
        task: {
          ...task,
          timeoutSeconds: task.timeoutSeconds > 0 ? task.timeoutSeconds : defaultTimeoutSeconds,
        },
        attempt,
        runsRoot: durableRun.attemptsRoot,
        signal: controller.signal,
      });

      finalResult = result;
      record.lastLogPath = result.logPath;
      record.lastAttemptCount = attempt;

      saveDurableRunCheckpoint(durableRun.runPaths.checkpointPath, {
        version: 1,
        runId: durableRun.runId,
        updatedAt: result.endedAt,
        step: result.success ? 'completed' : (result.cancelled ? 'interrupted' : 'attempt-failed'),
        payload: {
          attempt,
          success: result.success,
          cancelled: result.cancelled,
          error: result.error,
          logPath: result.logPath,
        },
      });

      await appendDurableRunEvent(durableRun.runPaths.eventsPath, {
        version: 1,
        runId: durableRun.runId,
        timestamp: result.endedAt,
        type: result.success
          ? 'run.attempt.completed'
          : (result.cancelled ? 'run.interrupted' : 'run.attempt.failed'),
        attempt,
        payload: {
          taskId: task.id,
          logPath: result.logPath,
          error: result.error,
          timedOut: result.timedOut,
          cancelled: result.cancelled,
          exitCode: result.exitCode,
        },
      });

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

    if (finalResult?.logPath) {
      copyTaskRunLogToDurableOutput(finalResult.logPath, durableRun.runPaths.outputLogPath);
    }

    writeJsonFile(durableRun.runPaths.resultPath, {
      taskId: task.id,
      runId: durableRun.runId,
      startedAt,
      finishedAt,
      attemptCount: record.lastAttemptCount ?? 0,
      success: finalResult?.success ?? false,
      cancelled: finalResult?.cancelled ?? false,
      error: finalResult?.error,
      logPath: finalResult?.logPath,
      outputText: finalResult?.outputText,
    });

    if (finalResult?.success) {
      record.activeRunId = undefined;
      record.lastStatus = 'success';
      record.lastSuccessAt = finishedAt;
      record.lastError = undefined;
      state.successfulRuns += 1;

      if (task.schedule.type === 'at') {
        record.oneTimeResolvedAt = finishedAt;
        record.oneTimeResolvedStatus = 'success';
        record.oneTimeCompletedAt = finishedAt;
      }

      saveDurableRunStatus(durableRun.runPaths.statusPath, createInitialDurableRunStatus({
        runId: durableRun.runId,
        status: 'completed',
        createdAt: startedAt,
        updatedAt: finishedAt,
        activeAttempt: record.lastAttemptCount ?? 0,
        startedAt,
        completedAt: finishedAt,
      }));

      await appendDurableRunEvent(durableRun.runPaths.eventsPath, {
        version: 1,
        runId: durableRun.runId,
        timestamp: finishedAt,
        type: 'run.completed',
        payload: {
          taskId: task.id,
          logPath: finalResult.logPath,
        },
      });

      context.publish('tasks.run.completed', {
        taskId: task.id,
        filePath: task.filePath,
        completedAt: finishedAt,
        logPath: finalResult.logPath,
        runId: durableRun.runId,
      });
      context.logger.info(`task completed id=${task.id} run=${durableRun.runId} log=${finalResult.logPath}`);

      const callbackConversationIds = await deliverTaskCallbackWakeup(task, 'success', context, {
        finishedAt,
        outputText: finalResult.outputText,
        logPath: finalResult.logPath,
      });

      writeTaskActivity(task, 'success', context, {
        startedAt: finalResult.startedAt,
        finishedAt,
        outputText: finalResult.outputText,
        logPath: finalResult.logPath,
        relatedConversationIdsOverride: callbackConversationIds,
      });
    } else if (finalResult?.cancelled) {
      record.lastStatus = 'skipped';
      record.lastError = finalResult.error ?? 'Task run cancelled';
      state.skippedRuns += 1;

      saveDurableRunStatus(durableRun.runPaths.statusPath, createInitialDurableRunStatus({
        runId: durableRun.runId,
        status: 'interrupted',
        createdAt: startedAt,
        updatedAt: finishedAt,
        activeAttempt: record.lastAttemptCount ?? 0,
        startedAt,
        lastError: record.lastError,
      }));
    } else {
      record.activeRunId = undefined;
      record.lastStatus = 'failed';
      record.lastFailureAt = finishedAt;
      record.lastError = finalResult?.error ?? 'Task run failed';
      state.failedRuns += 1;

      if (task.schedule.type === 'at') {
        record.oneTimeResolvedAt = finishedAt;
        record.oneTimeResolvedStatus = 'failed';
      }

      saveDurableRunStatus(durableRun.runPaths.statusPath, createInitialDurableRunStatus({
        runId: durableRun.runId,
        status: 'failed',
        createdAt: startedAt,
        updatedAt: finishedAt,
        activeAttempt: record.lastAttemptCount ?? 0,
        startedAt,
        completedAt: finishedAt,
        lastError: record.lastError,
      }));

      await appendDurableRunEvent(durableRun.runPaths.eventsPath, {
        version: 1,
        runId: durableRun.runId,
        timestamp: finishedAt,
        type: 'run.failed',
        payload: {
          taskId: task.id,
          error: record.lastError,
          logPath: finalResult?.logPath,
        },
      });

      context.publish('tasks.run.failed', {
        taskId: task.id,
        filePath: task.filePath,
        failedAt: finishedAt,
        error: record.lastError,
        logPath: finalResult?.logPath,
        runId: durableRun.runId,
      });
      context.logger.warn(`task failed id=${task.id} run=${durableRun.runId} error=${record.lastError}`);

      const callbackConversationIds = await deliverTaskCallbackWakeup(task, 'failed', context, {
        finishedAt,
        outputText: finalResult?.outputText,
        error: record.lastError,
        logPath: finalResult?.logPath,
      });

      writeTaskActivity(task, 'failed', context, {
        startedAt: finalResult?.startedAt,
        finishedAt,
        outputText: finalResult?.outputText,
        error: record.lastError,
        logPath: finalResult?.logPath,
        relatedConversationIdsOverride: callbackConversationIds,
      });
    }

  };

  const startTaskRun = (
    task: ParsedTaskDefinition,
    record: TaskRuntimeState,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void }; publish: (type: string, payload?: Record<string, unknown>) => boolean; paths: { root: string; stateRoot: string } },
    options: { runIdOverride?: string } = {},
  ): void => {
    const controller = new AbortController();

    record.running = true;
    record.runningStartedAt = now().toISOString();
    record.lastStatus = 'running';
    record.lastError = undefined;

    const runPromise = executeTaskRun(task, record, context, controller, options)
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

  const handleRequestedTaskRun = async (
    payload: Record<string, unknown>,
    context: { logger: { info: (message: string) => void; warn: (message: string) => void }; publish: (type: string, payload?: Record<string, unknown>) => boolean; paths: { root: string; stateRoot: string } },
  ): Promise<void> => {
    const taskId = typeof payload.taskId === 'string' && payload.taskId.trim().length > 0
      ? payload.taskId.trim()
      : undefined;
    const runIdOverride = typeof payload.runId === 'string' && payload.runId.trim().length > 0
      ? payload.runId.trim()
      : undefined;

    if (!taskId) {
      context.logger.warn('ignoring requested task run without taskId');
      return;
    }

    try {
      ensureLegacyTaskImports({
        taskDir,
        defaultTimeoutSeconds,
        dbPath: runtimeDbPath,
      });
      const task = getStoredAutomation(taskId, { dbPath: runtimeDbPath });
      if (!task) {
        context.logger.warn(`ignoring requested task run for missing task id=${taskId}`);
        return;
      }
      const record = ensureTaskRecord(taskState, task);

      if (activeRuns.has(task.key)) {
        context.logger.warn(`ignoring requested task run while active run exists id=${task.id}`);
        return;
      }

      context.logger.info(`starting requested task run id=${task.id}${runIdOverride ? ` run=${runIdOverride}` : ''}`);
      startTaskRun(task, record, context, { runIdOverride });
      persistState(context.logger);
    } catch (error) {
      context.logger.warn(`failed to start requested task run id=${taskId}: ${(error as Error).message}`);
    }
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

  const recoverInterruptedTaskRuns = async (
    context: {
      logger: { info: (message: string) => void; warn: (message: string) => void };
      publish: (type: string, payload?: Record<string, unknown>) => boolean;
      paths: { root: string; stateRoot: string };
    },
  ): Promise<void> => {
    const recoveryTime = now();
    const recoveryIso = recoveryTime.toISOString();
    ensureLegacyTaskImports({
      taskDir,
      defaultTimeoutSeconds,
      dbPath: runtimeDbPath,
    });

    for (const task of listStoredAutomations({ dbPath: runtimeDbPath })) {

      const record = ensureTaskRecord(taskState, task);
      if (!task.enabled || !record.activeRunId || activeRuns.has(task.key)) {
        continue;
      }

      if (task.schedule.type === 'at' && record.oneTimeResolvedAt) {
        continue;
      }

      const scannedRun = scanDurableRun(durableRunsRoot, record.activeRunId);
      const shouldRecover = Boolean(
        scannedRun && (scannedRun.recoveryAction === 'rerun' || scannedRun.recoveryAction === 'resume'),
      );

      if (!shouldRecover) {
        continue;
      }

      if (task.schedule.type === 'cron' && cronMatches(task.schedule.parsed, recoveryTime)) {
        record.lastScheduledMinute = toMinuteKey(recoveryTime);
      }

      record.lastError = `Recovering interrupted run ${record.activeRunId}`;
      record.lastStatus = 'running';
      record.running = true;
      record.runningStartedAt = recoveryIso;

      context.logger.info(
        `recovering task id=${task.id} priorRun=${record.activeRunId} action=${scannedRun?.recoveryAction ?? 'unknown'}`,
      );
      startTaskRun(task, record, context);
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
        deleteStoredAutomation(record.id, { dbPath: runtimeDbPath });
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
      paths: { root: string; stateRoot: string };
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

      const importResult = ensureLegacyTaskImports({
        taskDir,
        defaultTimeoutSeconds,
        dbPath: runtimeDbPath,
      });
      const parsedTasks = listStoredAutomations({ dbPath: runtimeDbPath });
      const activeTaskKeys = new Set(parsedTasks.map((task) => task.key));

      state.knownTasks = parsedTasks.length;
      state.parseErrors = importResult.parseErrors.length;

      for (const issue of importResult.parseErrors) {
        context.logger.warn(`invalid task file ${issue.filePath}: ${issue.error}`);
      }

      reconcileDeletedTaskState(activeTaskKeys);

      const lastEvaluatedAtMs = taskState.lastEvaluatedAt
        ? Date.parse(taskState.lastEvaluatedAt)
        : Number.NaN;
      const lastEvaluatedAt = Number.isFinite(lastEvaluatedAtMs)
        ? new Date(lastEvaluatedAtMs)
        : undefined;
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
            if (!lastEvaluatedAt || task.schedule.atMs > lastEvaluatedAt.getTime()) {
              writeMissedTaskActivity(task, context, {
                detectedAt: nowIso,
                missedRuns: {
                  count: 1,
                  firstScheduledAt: new Date(task.schedule.atMs).toISOString(),
                  lastScheduledAt: new Date(task.schedule.atMs).toISOString(),
                  exampleScheduledAt: [new Date(task.schedule.atMs).toISOString()],
                },
              });
            }

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
            continue;
          }

          startTaskRun(task, record, context);
          continue;
        }

        if (lastEvaluatedAt) {
          const missedRuns = summarizeMissedCronRuns(task.schedule.parsed, lastEvaluatedAt, tickTime);
          if (missedRuns) {
            writeMissedTaskActivity(task, context, {
              detectedAt: nowIso,
              missedRuns,
            });
          }
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

      taskState.lastEvaluatedAt = nowIso;
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
    subscriptions: ['timer.tasks.tick', 'tasks.run.requested'],
    timers: [
      {
        name: 'tasks-tick',
        eventType: 'timer.tasks.tick',
        intervalMs: tickIntervalSeconds * 1000,
      },
    ],

    async start(context): Promise<void> {
      moduleStartedAtMs = now().getTime();
      runtimeDbPath = resolveRuntimeDbPath(context.paths.root);
      durableRunsRoot = resolveDurableRunsRoot(context.paths.root);

      mkdirSync(taskDir, { recursive: true, mode: 0o700 });
      mkdirSync(durableRunsRoot, { recursive: true, mode: 0o700 });

      ensureLegacyTaskImports({
        taskDir,
        defaultTimeoutSeconds,
        dbPath: runtimeDbPath,
      });
      taskState = createEmptyTaskState();
      taskState.tasks = loadAutomationRuntimeStateMap({ dbPath: runtimeDbPath });
      taskState.lastEvaluatedAt = loadAutomationSchedulerState({ dbPath: runtimeDbPath }).lastEvaluatedAt;
      state.runningTasks = 0;

      await recoverInterruptedTaskRuns(context);
      persistState(context.logger);
      await runTick(context);
    },

    async handleEvent(event, context): Promise<void> {
      if (event.type === 'tasks.run.requested') {
        await handleRequestedTaskRun(event.payload, context);
        return;
      }

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
        runtimeDbPath,
        runsRoot: durableRunsRoot,
        durableRunsRoot,
        knownTasks: state.knownTasks,
        parseErrors: state.parseErrors,
        runningTasks: state.runningTasks,
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
