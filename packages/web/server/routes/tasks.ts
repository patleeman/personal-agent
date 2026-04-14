/**
 * Scheduled task routes
 *
 * Handles CRUD operations and execution for scheduled tasks.
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import { existsSync, readFileSync } from 'node:fs';
import {
  createStoredAutomation,
  ensureAutomationThread,
  startScheduledTaskRun,
  updateStoredAutomation,
  type StoredAutomation,
} from '@personal-agent/daemon';
import { invalidateAppTopics, logError } from '../middleware/index.js';
import { findTaskForProfile } from '../automation/taskService.js';
import {
  loadScheduledTasksForProfile,
  toScheduledTaskMetadata,
  type TaskRuntimeEntry,
} from '../automation/scheduledTasks.js';
import { applyScheduledTaskThreadBinding, buildScheduledTaskThreadDetail, resolveScheduledTaskThreadBinding } from '../automation/scheduledTaskThreads.js';

/**
 * Gets the current profile getter for use in route handlers.
 */
let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for task routes');
};

function initializeTaskRoutesContext(context: Pick<ServerRouteContext, 'getCurrentProfile'>): void {
  getCurrentProfileFn = context.getCurrentProfile;
}

function buildTaskDetailResponse(
  task: StoredAutomation,
  runtime?: TaskRuntimeEntry,
) {
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
    ...buildScheduledTaskThreadDetail(task),
  };
}

/**
 * Register task routes on the given router.
 */
export function registerTaskRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile'>,
): void {
  initializeTaskRoutesContext(context);
  router.get('/api/tasks', (_req, res) => {
    try {
      const loaded = loadScheduledTasksForProfile(getCurrentProfileFn());
      const runtimeById = new Map(
        loaded.runtimeEntries.flatMap((task) => task.id ? [[task.id, task] as const] : []),
      );

      const tasks = loaded.tasks.map((task) => {
        const runtime = loaded.runtimeState[task.id] ?? runtimeById.get(task.id);
        return {
          id: task.id,
          title: task.title,
          filePath: task.legacyFilePath,
          scheduleType: task.schedule.type,
          running: runtime?.running ?? false,
          enabled: task.enabled,
          cron: task.schedule.type === 'cron' ? task.schedule.expression : undefined,
          at: task.schedule.type === 'at' ? task.schedule.at : undefined,
          prompt: task.prompt.split('\n')[0]?.slice(0, 120) ?? '',
          model: task.modelRef,
          thinkingLevel: task.thinkingLevel,
          cwd: task.cwd,
          lastStatus: runtime?.lastStatus,
          lastRunAt: runtime?.lastRunAt,
          lastSuccessAt: runtime?.lastSuccessAt,
          lastAttemptCount: runtime?.lastAttemptCount,
        };
      });

      res.json(tasks);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/tasks', (req, res) => {
    try {
      const body = req.body as {
        title?: string;
        enabled?: boolean;
        cron?: string | null;
        at?: string | null;
        model?: string | null;
        thinkingLevel?: string | null;
        cwd?: string | null;
        timeoutSeconds?: number | null;
        prompt?: string;
        threadMode?: string | null;
        threadConversationId?: string | null;
      };
      const profile = getCurrentProfileFn();
      const threadSelection = resolveScheduledTaskThreadBinding({
        threadMode: body.threadMode,
        threadConversationId: body.threadConversationId,
        cwd: body.cwd,
      });
      const createdTask = createStoredAutomation({
        profile,
        title: body.title ?? '',
        enabled: body.enabled ?? true,
        cron: body.cron,
        at: body.at,
        modelRef: body.model,
        thinkingLevel: body.thinkingLevel,
        cwd: body.cwd,
        timeoutSeconds: body.timeoutSeconds,
        prompt: body.prompt ?? '',
      });
      const task = applyScheduledTaskThreadBinding(createdTask.id, {
        threadMode: threadSelection.mode,
        threadConversationId: threadSelection.conversationId,
        threadSessionFile: threadSelection.sessionFile,
        cwd: body.cwd,
      });

      invalidateAppTopics('tasks');

      const savedTask = findTaskForProfile(profile, task.id);
      res.status(201).json({
        ok: true,
        task: buildTaskDetailResponse(savedTask?.task ?? task, savedTask?.runtime),
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch('/api/tasks/:id', (req, res) => {
    try {
      const body = req.body as {
        title?: string;
        enabled?: boolean;
        cron?: string | null;
        at?: string | null;
        model?: string | null;
        thinkingLevel?: string | null;
        cwd?: string | null;
        timeoutSeconds?: number | null;
        prompt?: string;
        threadMode?: string | null;
        threadConversationId?: string | null;
      };
      const resolvedTask = findTaskForProfile(getCurrentProfileFn(), req.params.id);
      if (!resolvedTask) { res.status(404).json({ error: 'Task not found' }); return; }

      const threadSelection = resolveScheduledTaskThreadBinding({
        threadMode: body.threadMode,
        threadConversationId: body.threadConversationId,
        cwd: body.cwd ?? resolvedTask.task.cwd,
      });

      const updatedTask = updateStoredAutomation(resolvedTask.task.id, {
        title: body.title,
        enabled: body.enabled,
        cron: body.cron,
        at: body.at,
        modelRef: body.model,
        thinkingLevel: body.thinkingLevel,
        cwd: body.cwd,
        timeoutSeconds: body.timeoutSeconds,
        prompt: body.prompt,
      });
      const task = applyScheduledTaskThreadBinding(updatedTask.id, {
        threadMode: threadSelection.mode,
        threadConversationId: threadSelection.conversationId,
        threadSessionFile: threadSelection.sessionFile,
        cwd: body.cwd ?? updatedTask.cwd,
      });

      invalidateAppTopics('tasks');

      const refreshedTask = findTaskForProfile(getCurrentProfileFn(), task.id);
      res.json({ ok: true, task: buildTaskDetailResponse(refreshedTask?.task ?? task, refreshedTask?.runtime) });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/tasks/:id/log', (req, res) => {
    try {
      const resolvedTask = findTaskForProfile(getCurrentProfileFn(), req.params.id);
      if (!resolvedTask?.runtime?.lastLogPath) {
        res.status(404).json({ error: 'No log available' }); return;
      }
      if (!existsSync(resolvedTask.runtime.lastLogPath)) {
        res.status(404).json({ error: 'No log available' }); return;
      }
      const log = readFileSync(resolvedTask.runtime.lastLogPath, 'utf-8');
      res.json({ log, path: resolvedTask.runtime.lastLogPath });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/tasks/:id', (req, res) => {
    try {
      const resolvedTask = findTaskForProfile(getCurrentProfileFn(), req.params.id);
      if (!resolvedTask) { res.status(404).json({ error: 'Task not found' }); return; }

      const task = resolvedTask.task.threadMode === 'dedicated' && !resolvedTask.task.threadConversationId
        ? ensureAutomationThread(resolvedTask.task.id)
        : resolvedTask.task;
      res.json(buildTaskDetailResponse(task, resolvedTask.runtime));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/tasks/:id/run', async (req, res) => {
    try {
      const resolvedTask = findTaskForProfile(getCurrentProfileFn(), req.params.id);
      if (!resolvedTask) { res.status(404).json({ error: 'Task not found' }); return; }
      if (!resolvedTask.task.prompt.trim()) { res.status(400).json({ error: 'Task has no prompt body' }); return; }

      const result = await startScheduledTaskRun(resolvedTask.task.id);
      if (!result.accepted) {
        res.status(503).json({ error: result.reason ?? 'Could not start the task run.' });
        return;
      }

      res.json({ ok: true, accepted: result.accepted, runId: result.runId });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}
