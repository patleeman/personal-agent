import { existsSync, readFileSync } from 'node:fs';
import {
  createStoredAutomation,
  startScheduledTaskRun,
  updateStoredAutomation,
  type StoredAutomation,
} from '@personal-agent/daemon';
import { invalidateAppTopics } from '../shared/appEvents.js';
import { loadScheduledTasksForProfile, toScheduledTaskMetadata, type TaskRuntimeEntry } from './scheduledTasks.js';
import { findTaskForProfile, readRequiredTaskId } from './taskService.js';

export interface ScheduledTaskCreateCapabilityInput {
  title: string;
  enabled?: boolean;
  cron?: string | null;
  at?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number | null;
  prompt: string;
}

export interface ScheduledTaskUpdateCapabilityInput {
  taskId: string;
  title?: string;
  enabled?: boolean;
  cron?: string | null;
  at?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number | null;
  prompt?: string;
}

function summarizePrompt(value: string): string {
  return value.split('\n')[0]?.slice(0, 120) ?? '';
}

function buildScheduledTaskSummary(task: StoredAutomation, runtime?: TaskRuntimeEntry) {
  return {
    id: task.id,
    title: task.title,
    filePath: task.legacyFilePath,
    scheduleType: task.schedule.type,
    running: runtime?.running ?? false,
    enabled: task.enabled,
    cron: task.schedule.type === 'cron' ? task.schedule.expression : undefined,
    at: task.schedule.type === 'at' ? task.schedule.at : undefined,
    prompt: summarizePrompt(task.prompt),
    model: task.modelRef,
    thinkingLevel: task.thinkingLevel,
    cwd: task.cwd,
    lastStatus: runtime?.lastStatus,
    lastRunAt: runtime?.lastRunAt,
    lastSuccessAt: runtime?.lastSuccessAt,
    lastAttemptCount: runtime?.lastAttemptCount,
  };
}

export function buildScheduledTaskDetail(task: StoredAutomation, runtime?: TaskRuntimeEntry) {
  const metadata = toScheduledTaskMetadata(task);
  return {
    ...(runtime ?? {}),
    id: metadata.id,
    title: metadata.title,
    filePath: task.legacyFilePath,
    scheduleType: metadata.scheduleType,
    running: runtime?.running ?? false,
    enabled: metadata.enabled,
    cron: metadata.cron,
    at: metadata.at,
    model: metadata.model,
    thinkingLevel: metadata.thinkingLevel,
    cwd: metadata.cwd,
    timeoutSeconds: metadata.timeoutSeconds,
    prompt: metadata.promptBody,
    lastStatus: runtime?.lastStatus,
    lastRunAt: runtime?.lastRunAt,
  };
}

export async function listScheduledTasksCapability(profile: string) {
  const loaded = loadScheduledTasksForProfile(profile);
  const runtimeById = new Map(
    loaded.runtimeEntries.flatMap((task) => task.id ? [[task.id, task] as const] : []),
  );

  return loaded.tasks.map((task) => buildScheduledTaskSummary(task, loaded.runtimeState[task.id] ?? runtimeById.get(task.id)));
}

export async function readScheduledTaskCapability(profile: string, taskId: string) {
  const resolvedTask = findTaskForProfile(profile, readRequiredTaskId(taskId));
  if (!resolvedTask) {
    throw new Error('Task not found');
  }

  return buildScheduledTaskDetail(resolvedTask.task, resolvedTask.runtime);
}

export async function createScheduledTaskCapability(profile: string, input: ScheduledTaskCreateCapabilityInput) {
  const task = createStoredAutomation({
    profile,
    title: input.title ?? '',
    enabled: input.enabled ?? true,
    cron: input.cron,
    at: input.at,
    modelRef: input.model,
    thinkingLevel: input.thinkingLevel,
    cwd: input.cwd,
    timeoutSeconds: input.timeoutSeconds,
    prompt: input.prompt ?? '',
  });

  invalidateAppTopics('tasks');

  const savedTask = findTaskForProfile(profile, task.id);
  return {
    ok: true as const,
    task: buildScheduledTaskDetail(savedTask?.task ?? task, savedTask?.runtime),
  };
}

export async function updateScheduledTaskCapability(profile: string, input: ScheduledTaskUpdateCapabilityInput) {
  const taskId = readRequiredTaskId(input.taskId);
  const resolvedTask = findTaskForProfile(profile, taskId);
  if (!resolvedTask) {
    throw new Error('Task not found');
  }

  const updatedTask = updateStoredAutomation(resolvedTask.task.id, {
    title: input.title,
    enabled: input.enabled,
    cron: input.cron,
    at: input.at,
    modelRef: input.model,
    thinkingLevel: input.thinkingLevel,
    cwd: input.cwd,
    timeoutSeconds: input.timeoutSeconds,
    prompt: input.prompt,
  });

  invalidateAppTopics('tasks');

  const refreshedTask = findTaskForProfile(profile, updatedTask.id);
  return {
    ok: true as const,
    task: buildScheduledTaskDetail(refreshedTask?.task ?? updatedTask, refreshedTask?.runtime),
  };
}

export async function readScheduledTaskLogCapability(profile: string, taskId: string) {
  const resolvedTask = findTaskForProfile(profile, readRequiredTaskId(taskId));
  if (!resolvedTask?.runtime?.lastLogPath) {
    throw new Error('No log available');
  }

  if (!existsSync(resolvedTask.runtime.lastLogPath)) {
    throw new Error('No log available');
  }

  return {
    log: readFileSync(resolvedTask.runtime.lastLogPath, 'utf-8'),
    path: resolvedTask.runtime.lastLogPath,
  };
}

export async function runScheduledTaskCapability(profile: string, taskId: string) {
  const resolvedTask = findTaskForProfile(profile, readRequiredTaskId(taskId));
  if (!resolvedTask) {
    throw new Error('Task not found');
  }

  if (!resolvedTask.task.prompt.trim()) {
    throw new Error('Task has no prompt body');
  }

  const result = await startScheduledTaskRun(resolvedTask.task.id);
  if (!result.accepted) {
    throw new Error(result.reason ?? 'Could not start the task run.');
  }

  return {
    ok: true as const,
    accepted: result.accepted,
    runId: result.runId,
  };
}
