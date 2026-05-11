import { existsSync, readFileSync } from 'node:fs';

import { clearTaskCallbackBinding } from '@personal-agent/core';
import type { AutomationActivityEntry } from '@personal-agent/daemon';
import {
  createStoredAutomation,
  deleteStoredAutomation,
  ensureAutomationThread,
  listAutomationActivityEntries,
  normalizeAutomationTargetTypeForSelection,
  startScheduledTaskRun,
  updateStoredAutomation,
} from '@personal-agent/daemon';

import { readScheduledTaskSchedulerHealth } from '../automation/scheduledTaskCapability.js';
import { loadScheduledTasksForProfile, type TaskRuntimeEntry, toScheduledTaskMetadata } from '../automation/scheduledTasks.js';
import {
  applyScheduledTaskThreadBinding,
  buildScheduledTaskThreadDetail,
  resolveScheduledTaskThreadBinding,
} from '../automation/scheduledTaskThreads.js';
import { findTaskForProfile } from '../automation/taskService.js';
import { invalidateAppTopics } from '../middleware/index.js';
import type { ServerRouteContext } from '../routes/context.js';

interface AutomationMutationInput {
  title?: string;
  enabled?: boolean;
  cron?: string | null;
  at?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number | null;
  catchUpWindowSeconds?: number | null;
  prompt?: string;
  targetType?: string | null;
  threadMode?: string | null;
  threadConversationId?: string | null;
}

function buildTaskDetailResponse(
  task: Parameters<typeof toScheduledTaskMetadata>[0],
  runtime?: TaskRuntimeEntry,
  activity: AutomationActivityEntry[] = [],
) {
  const metadata = toScheduledTaskMetadata(task);
  const schedulerHealth = readScheduledTaskSchedulerHealth(task.profile);
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
    ...(metadata.catchUpWindowSeconds !== undefined ? { catchUpWindowSeconds: metadata.catchUpWindowSeconds } : {}),
    prompt: metadata.promptBody,
    activity,
    lastStatus: runtime?.lastStatus,
    lastRunAt: runtime?.lastRunAt,
    ...(schedulerHealth.lastEvaluatedAt ? { schedulerLastEvaluatedAt: schedulerHealth.lastEvaluatedAt } : {}),
    ...buildScheduledTaskThreadDetail(task),
  };
}

function getProfile(context?: Pick<ServerRouteContext, 'getCurrentProfile'>): string {
  if (!context) {
    throw new Error('Extension automations capability requires server route context.');
  }
  return context.getCurrentProfile();
}

export function createExtensionAutomationsCapability(context?: Pick<ServerRouteContext, 'getCurrentProfile'>) {
  return {
    async list() {
      const profile = getProfile(context);
      const loaded = loadScheduledTasksForProfile(profile);
      const runtimeById = new Map(loaded.runtimeEntries.flatMap((task) => (task.id ? [[task.id, task] as const] : [])));
      return loaded.tasks.map((task) => {
        const taskWithThread = task.threadMode === 'dedicated' && !task.threadConversationId ? ensureAutomationThread(task.id) : task;
        const runtime = loaded.runtimeState[task.id] ?? runtimeById.get(task.id);
        const threadDetail = buildScheduledTaskThreadDetail(taskWithThread);
        return {
          id: taskWithThread.id,
          title: taskWithThread.title,
          filePath: taskWithThread.legacyFilePath,
          scheduleType: taskWithThread.schedule.type,
          targetType: taskWithThread.targetType,
          running: runtime?.running ?? false,
          enabled: taskWithThread.enabled,
          cron: taskWithThread.schedule.type === 'cron' ? taskWithThread.schedule.expression : undefined,
          at: taskWithThread.schedule.type === 'at' ? taskWithThread.schedule.at : undefined,
          prompt: taskWithThread.prompt.split('\n')[0]?.slice(0, 120) ?? '',
          model: taskWithThread.modelRef,
          thinkingLevel: taskWithThread.thinkingLevel,
          cwd: taskWithThread.cwd,
          ...(taskWithThread.catchUpWindowSeconds !== undefined ? { catchUpWindowSeconds: taskWithThread.catchUpWindowSeconds } : {}),
          threadConversationId: threadDetail.threadConversationId,
          threadTitle: threadDetail.threadTitle,
          lastStatus: runtime?.lastStatus,
          lastRunAt: runtime?.lastRunAt,
          lastSuccessAt: runtime?.lastSuccessAt,
          lastAttemptCount: runtime?.lastAttemptCount,
        };
      });
    },
    async get(taskId: string) {
      const resolvedTask = findTaskForProfile(getProfile(context), taskId);
      if (!resolvedTask) throw new Error('Task not found');
      const task =
        resolvedTask.task.threadMode === 'dedicated' && !resolvedTask.task.threadConversationId
          ? ensureAutomationThread(resolvedTask.task.id)
          : resolvedTask.task;
      return buildTaskDetailResponse(task, resolvedTask.runtime, listAutomationActivityEntries(task.id));
    },
    async create(input: AutomationMutationInput) {
      const profile = getProfile(context);
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
        ...(input.catchUpWindowSeconds !== undefined ? { catchUpWindowSeconds: input.catchUpWindowSeconds } : {}),
        prompt: input.prompt ?? '',
        targetType,
      });
      const task = applyScheduledTaskThreadBinding(createdTask.id, {
        threadMode: threadSelection.mode,
        threadConversationId: threadSelection.conversationId,
        threadSessionFile: threadSelection.sessionFile,
        cwd: input.cwd,
      });
      invalidateAppTopics('tasks');
      const savedTask = findTaskForProfile(profile, task.id);
      return {
        ok: true,
        task: buildTaskDetailResponse(savedTask?.task ?? task, savedTask?.runtime, listAutomationActivityEntries(task.id)),
      };
    },
    async update(taskId: string, input: AutomationMutationInput) {
      const profile = getProfile(context);
      const resolvedTask = findTaskForProfile(profile, taskId);
      if (!resolvedTask) throw new Error('Task not found');
      const targetType =
        input.targetType === undefined ? resolvedTask.task.targetType : normalizeAutomationTargetTypeForSelection(input.targetType);
      const threadSelection = resolveScheduledTaskThreadBinding({
        threadMode:
          targetType === 'conversation' && input.threadMode === 'none' ? 'dedicated' : (input.threadMode ?? resolvedTask.task.threadMode),
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
        ...(input.catchUpWindowSeconds !== undefined ? { catchUpWindowSeconds: input.catchUpWindowSeconds } : {}),
        prompt: input.prompt,
        targetType,
      });
      const task = applyScheduledTaskThreadBinding(updatedTask.id, {
        threadMode: threadSelection.mode,
        threadConversationId: threadSelection.conversationId,
        threadSessionFile: threadSelection.sessionFile,
        cwd: input.cwd ?? updatedTask.cwd,
      });
      invalidateAppTopics('tasks');
      const refreshedTask = findTaskForProfile(profile, task.id);
      return {
        ok: true,
        task: buildTaskDetailResponse(refreshedTask?.task ?? task, refreshedTask?.runtime, listAutomationActivityEntries(task.id)),
      };
    },
    async delete(taskId: string) {
      const profile = getProfile(context);
      const resolvedTask = findTaskForProfile(profile, taskId);
      if (!resolvedTask) throw new Error('Task not found');
      const deleted = deleteStoredAutomation(resolvedTask.task.id, { profile });
      if (!deleted) throw new Error('Task not found');
      clearTaskCallbackBinding({ profile, taskId: resolvedTask.task.id });
      invalidateAppTopics('tasks');
      return { ok: true, deleted: true };
    },
    async run(taskId: string) {
      const resolvedTask = findTaskForProfile(getProfile(context), taskId);
      if (!resolvedTask) throw new Error('Task not found');
      if (!resolvedTask.task.prompt.trim()) throw new Error('Task has no prompt body');
      const result = await startScheduledTaskRun(resolvedTask.task.id);
      if (!result.accepted) throw new Error(result.reason ?? 'Could not start the task run.');
      return { ok: true, accepted: result.accepted, runId: result.runId };
    },
    async readLog(taskId: string) {
      const resolvedTask = findTaskForProfile(getProfile(context), taskId);
      if (!resolvedTask?.runtime?.lastLogPath || !existsSync(resolvedTask.runtime.lastLogPath)) {
        throw new Error('No log available');
      }
      return { log: readFileSync(resolvedTask.runtime.lastLogPath, 'utf-8'), path: resolvedTask.runtime.lastLogPath };
    },
    async readSchedulerHealth() {
      return readScheduledTaskSchedulerHealth(getProfile(context));
    },
  };
}
