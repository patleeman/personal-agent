import { existsSync, readFileSync } from 'node:fs';
import { clearTaskCallbackBinding, getTaskCallbackBinding, setTaskCallbackBinding } from '@personal-agent/core';
import {
  createStoredAutomation,
  deleteStoredAutomation,
  ensureAutomationThread,
  normalizeAutomationTargetTypeForSelection,
  startScheduledTaskRun,
  updateStoredAutomation,
  type StoredAutomation,
} from '@personal-agent/daemon';
import { invalidateAppTopics } from '../shared/appEvents.js';
import { readSessionMeta } from '../conversations/sessions.js';
import { loadScheduledTasksForProfile, toScheduledTaskMetadata, type TaskRuntimeEntry } from './scheduledTasks.js';
import { findTaskForProfile, readRequiredTaskId } from './taskService.js';
import { applyScheduledTaskThreadBinding, buildScheduledTaskThreadDetail, resolveScheduledTaskThreadBinding, type ScheduledTaskThreadInput } from './scheduledTaskThreads.js';

export interface ScheduledTaskCreateCapabilityInput extends ScheduledTaskThreadInput {
  title: string;
  enabled?: boolean;
  cron?: string | null;
  at?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number | null;
  prompt: string;
  targetType?: string | null;
  conversationBehavior?: 'steer' | 'followUp' | null;
  callbackConversationId?: string | null;
  deliverOnSuccess?: boolean | null;
  deliverOnFailure?: boolean | null;
  notifyOnSuccess?: 'none' | 'passive' | 'disruptive' | null;
  notifyOnFailure?: 'none' | 'passive' | 'disruptive' | null;
  requireAck?: boolean | null;
  autoResumeIfOpen?: boolean | null;
}

export interface ScheduledTaskUpdateCapabilityInput extends ScheduledTaskThreadInput {
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
  targetType?: string | null;
  conversationBehavior?: 'steer' | 'followUp' | null;
  callbackConversationId?: string | null;
  deliverOnSuccess?: boolean | null;
  deliverOnFailure?: boolean | null;
  notifyOnSuccess?: 'none' | 'passive' | 'disruptive' | null;
  notifyOnFailure?: 'none' | 'passive' | 'disruptive' | null;
  requireAck?: boolean | null;
  autoResumeIfOpen?: boolean | null;
}

function summarizePrompt(value: string): string {
  return value.split('\n')[0]?.slice(0, 120) ?? '';
}

function buildScheduledTaskSummary(task: StoredAutomation, runtime?: TaskRuntimeEntry, callbackBinding?: ReturnType<typeof getTaskCallbackBinding>) {
  const threadDetail = buildScheduledTaskThreadDetail(task);
  return {
    id: task.id,
    title: task.title,
    filePath: task.legacyFilePath,
    scheduleType: task.schedule.type,
    targetType: task.targetType,
    running: runtime?.running ?? false,
    enabled: task.enabled,
    cron: task.schedule.type === 'cron' ? task.schedule.expression : undefined,
    at: task.schedule.type === 'at' ? task.schedule.at : undefined,
    prompt: summarizePrompt(task.prompt),
    model: task.modelRef,
    thinkingLevel: task.thinkingLevel,
    cwd: task.cwd,
    threadConversationId: threadDetail.threadConversationId,
    threadTitle: threadDetail.threadTitle,
    conversationBehavior: task.conversationBehavior,
    ...(callbackBinding
      ? {
          callbackConversationId: callbackBinding.conversationId,
          deliverOnSuccess: callbackBinding.deliverOnSuccess,
          deliverOnFailure: callbackBinding.deliverOnFailure,
          notifyOnSuccess: callbackBinding.notifyOnSuccess,
          notifyOnFailure: callbackBinding.notifyOnFailure,
          requireAck: callbackBinding.requireAck,
          autoResumeIfOpen: callbackBinding.autoResumeIfOpen,
        }
      : {}),
    lastStatus: runtime?.lastStatus,
    lastRunAt: runtime?.lastRunAt,
    lastSuccessAt: runtime?.lastSuccessAt,
    lastAttemptCount: runtime?.lastAttemptCount,
  };
}

export function buildScheduledTaskDetail(task: StoredAutomation, runtime?: TaskRuntimeEntry, callbackBinding?: ReturnType<typeof getTaskCallbackBinding>) {
  const metadata = toScheduledTaskMetadata(task);
  return {
    ...(runtime ?? {}),
    id: metadata.id,
    title: metadata.title,
    filePath: task.legacyFilePath,
    scheduleType: metadata.scheduleType,
    targetType: metadata.targetType,
    running: runtime?.running ?? false,
    enabled: metadata.enabled,
    cron: metadata.cron,
    at: metadata.at,
    model: metadata.model,
    thinkingLevel: metadata.thinkingLevel,
    cwd: metadata.cwd,
    timeoutSeconds: metadata.timeoutSeconds,
    prompt: metadata.promptBody,
    conversationBehavior: task.conversationBehavior,
    ...(callbackBinding
      ? {
          callbackConversationId: callbackBinding.conversationId,
          deliverOnSuccess: callbackBinding.deliverOnSuccess,
          deliverOnFailure: callbackBinding.deliverOnFailure,
          notifyOnSuccess: callbackBinding.notifyOnSuccess,
          notifyOnFailure: callbackBinding.notifyOnFailure,
          requireAck: callbackBinding.requireAck,
          autoResumeIfOpen: callbackBinding.autoResumeIfOpen,
        }
      : {}),
    lastStatus: runtime?.lastStatus,
    lastRunAt: runtime?.lastRunAt,
    ...buildScheduledTaskThreadDetail(task),
  };
}

export async function listScheduledTasksCapability(profile: string) {
  const loaded = loadScheduledTasksForProfile(profile);
  const runtimeById = new Map(
    loaded.runtimeEntries.flatMap((task) => task.id ? [[task.id, task] as const] : []),
  );

  return loaded.tasks.map((task) => {
    const taskWithThread = task.threadMode === 'dedicated' && !task.threadConversationId
      ? ensureAutomationThread(task.id)
      : task;
    const callbackBinding = getTaskCallbackBinding({ profile, taskId: taskWithThread.id });
    return buildScheduledTaskSummary(taskWithThread, loaded.runtimeState[task.id] ?? runtimeById.get(task.id), callbackBinding);
  });
}

export async function readScheduledTaskCapability(profile: string, taskId: string) {
  const resolvedTask = findTaskForProfile(profile, readRequiredTaskId(taskId));
  if (!resolvedTask) {
    throw new Error('Task not found');
  }

  const task = resolvedTask.task.threadMode === 'dedicated' && !resolvedTask.task.threadConversationId
    ? ensureAutomationThread(resolvedTask.task.id)
    : resolvedTask.task;
  const callbackBinding = getTaskCallbackBinding({ profile, taskId: task.id });

  return buildScheduledTaskDetail(task, resolvedTask.runtime, callbackBinding);
}

function applyScheduledTaskCallbackBinding(
  profile: string,
  taskId: string,
  input: Pick<ScheduledTaskCreateCapabilityInput, 'callbackConversationId' | 'deliverOnSuccess' | 'deliverOnFailure' | 'notifyOnSuccess' | 'notifyOnFailure' | 'requireAck' | 'autoResumeIfOpen'>,
  targetType: string,
) {
  if (targetType === 'conversation') {
    clearTaskCallbackBinding({ profile, taskId });
    return;
  }

  const hasExplicitCallbackConfig = input.callbackConversationId !== undefined
    || input.deliverOnSuccess !== undefined
    || input.deliverOnFailure !== undefined
    || input.notifyOnSuccess !== undefined
    || input.notifyOnFailure !== undefined
    || input.requireAck !== undefined
    || input.autoResumeIfOpen !== undefined;
  if (!hasExplicitCallbackConfig) {
    return;
  }

  const callbackConversationId = input.callbackConversationId?.trim();
  if (!callbackConversationId) {
    clearTaskCallbackBinding({ profile, taskId });
    return;
  }

  const sessionMeta = readSessionMeta(callbackConversationId);
  if (!sessionMeta?.file?.trim()) {
    throw new Error('Callback conversation not found.');
  }

  setTaskCallbackBinding({
    profile,
    taskId,
    conversationId: callbackConversationId,
    sessionFile: sessionMeta.file,
    ...(input.deliverOnSuccess !== undefined && input.deliverOnSuccess !== null ? { deliverOnSuccess: input.deliverOnSuccess } : {}),
    ...(input.deliverOnFailure !== undefined && input.deliverOnFailure !== null ? { deliverOnFailure: input.deliverOnFailure } : {}),
    ...(input.notifyOnSuccess !== undefined && input.notifyOnSuccess !== null ? { notifyOnSuccess: input.notifyOnSuccess } : {}),
    ...(input.notifyOnFailure !== undefined && input.notifyOnFailure !== null ? { notifyOnFailure: input.notifyOnFailure } : {}),
    ...(input.requireAck !== undefined && input.requireAck !== null ? { requireAck: input.requireAck } : {}),
    ...(input.autoResumeIfOpen !== undefined && input.autoResumeIfOpen !== null ? { autoResumeIfOpen: input.autoResumeIfOpen } : {}),
  });
}

export async function createScheduledTaskCapability(profile: string, input: ScheduledTaskCreateCapabilityInput) {
  const targetType = normalizeAutomationTargetTypeForSelection(input.targetType);
  const threadSelection = resolveScheduledTaskThreadBinding({
    threadMode: targetType === 'conversation' && input.threadMode === 'none' ? 'dedicated' : input.threadMode,
    threadConversationId: input.threadConversationId,
    cwd: input.cwd,
  });
  if (targetType === 'conversation' && threadSelection.mode === 'none') {
    throw new Error('Conversation automations need a thread.');
  }

  const createdTask = createStoredAutomation({
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
    targetType,
    ...(targetType === 'conversation' ? { conversationBehavior: input.conversationBehavior } : {}),
  });

  const task = applyScheduledTaskThreadBinding(createdTask.id, {
    threadMode: threadSelection.mode,
    threadConversationId: threadSelection.conversationId,
    threadSessionFile: threadSelection.sessionFile,
    cwd: input.cwd,
  });

  applyScheduledTaskCallbackBinding(profile, task.id, input, targetType);
  invalidateAppTopics('tasks');

  const savedTask = findTaskForProfile(profile, task.id);
  const callbackBinding = getTaskCallbackBinding({ profile, taskId: task.id });
  return {
    ok: true as const,
    task: buildScheduledTaskDetail(savedTask?.task ?? task, savedTask?.runtime, callbackBinding),
  };
}

export async function updateScheduledTaskCapability(profile: string, input: ScheduledTaskUpdateCapabilityInput) {
  const taskId = readRequiredTaskId(input.taskId);
  const resolvedTask = findTaskForProfile(profile, taskId);
  if (!resolvedTask) {
    throw new Error('Task not found');
  }

  const targetType = input.targetType === undefined
    ? resolvedTask.task.targetType
    : normalizeAutomationTargetTypeForSelection(input.targetType);
  const threadSelection = resolveScheduledTaskThreadBinding({
    threadMode: targetType === 'conversation' && input.threadMode === 'none'
      ? 'dedicated'
      : (input.threadMode ?? resolvedTask.task.threadMode),
    threadConversationId: input.threadConversationId,
    cwd: input.cwd ?? resolvedTask.task.cwd,
  });
  if (targetType === 'conversation' && threadSelection.mode === 'none') {
    throw new Error('Conversation automations need a thread.');
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
    targetType,
    ...(targetType === 'conversation' ? { conversationBehavior: input.conversationBehavior } : {}),
  });

  const task = applyScheduledTaskThreadBinding(updatedTask.id, {
    threadMode: threadSelection.mode,
    threadConversationId: threadSelection.conversationId,
    threadSessionFile: threadSelection.sessionFile,
    cwd: input.cwd ?? updatedTask.cwd,
  });

  applyScheduledTaskCallbackBinding(profile, task.id, input, targetType);
  invalidateAppTopics('tasks');

  const refreshedTask = findTaskForProfile(profile, task.id);
  const callbackBinding = getTaskCallbackBinding({ profile, taskId: task.id });
  return {
    ok: true as const,
    task: buildScheduledTaskDetail(refreshedTask?.task ?? task, refreshedTask?.runtime, callbackBinding),
  };
}

export async function deleteScheduledTaskCapability(profile: string, taskId: string) {
  const normalizedTaskId = readRequiredTaskId(taskId);
  const resolvedTask = findTaskForProfile(profile, normalizedTaskId);
  if (!resolvedTask) {
    throw new Error('Task not found');
  }

  const deleted = deleteStoredAutomation(resolvedTask.task.id, { profile });
  if (!deleted) {
    throw new Error('Task not found');
  }

  clearTaskCallbackBinding({ profile, taskId: resolvedTask.task.id });
  invalidateAppTopics('tasks');

  return {
    ok: true as const,
    deleted: true,
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
