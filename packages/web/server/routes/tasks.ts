/**
 * Scheduled task routes
 * 
 * Handles CRUD operations and execution for scheduled tasks.
 */

import type { Express } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  buildScheduledTaskMarkdown,
  loadScheduledTasksForProfile,
  readScheduledTaskFileMetadata,
  resolveScheduledTaskForProfile,
  taskDirForProfile,
  validateScheduledTaskDefinition,
} from '../scheduledTasks.js';
import { startScheduledTaskRun } from '@personal-agent/daemon';
import { invalidateAppTopics, logError } from '../middleware/index.js';
import { findCurrentProfileTask, readRequiredTaskId } from '../taskService.js';

/**
 * Gets the current profile getter for use in route handlers.
 */
let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for task routes');
};

export function setTaskRoutesProfileGetter(fn: () => string): void {
  getCurrentProfileFn = fn;
}

export function registerCompanionTaskRunRoutes(router: Pick<Express, 'post'>): void {
  router.post('/api/tasks/:id/run', async (req, res) => {
    try {
      const resolvedTask = findCurrentProfileTask(req.params.id);
      if (!resolvedTask) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      if (!resolvedTask.task.prompt.trim()) {
        res.status(400).json({ error: 'Task has no prompt body' });
        return;
      }
      const result = await startScheduledTaskRun(resolvedTask.task.filePath);
      if (!result.accepted) {
        res.status(503).json({ error: result.reason ?? 'Could not start the task run.' });
        return;
      }
      res.json({ ok: true, accepted: result.accepted, runId: result.runId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}

function buildTaskDetailResponse(task: { filePath: string }, runtime?: { running?: boolean; lastStatus?: string; lastRunAt?: string; lastSuccessAt?: string; lastAttemptCount?: number; lastLogPath?: string }) {
  const metadata = readScheduledTaskFileMetadata(task.filePath);
  return {
    ...(runtime ?? {}),
    id: metadata.id,
    filePath: task.filePath,
    scheduleType: metadata.scheduleType,
    running: runtime?.running ?? false,
    enabled: metadata.enabled,
    cron: metadata.cron,
    at: metadata.at,
    model: metadata.model,
    cwd: metadata.cwd,
    timeoutSeconds: metadata.timeoutSeconds,
    prompt: metadata.promptBody,
    fileContent: metadata.fileContent,
  };
}

/**
 * Register task routes on the given router.
 */
export function registerTaskRoutes(router: Pick<Express, 'get' | 'post' | 'patch'>): void {
  router.get('/api/tasks', (_req, res) => {
    try {
      const loaded = loadScheduledTasksForProfile(getCurrentProfileFn());
      const runtimeByFilePath = new Map(loaded.runtimeEntries.map((task) => [task.filePath, task]));
      const runtimeById = new Map(
        loaded.runtimeEntries.flatMap((task) => task.id ? [[task.id, task] as const] : []),
      );

      const tasks = loaded.tasks.map((task) => {
        const runtime = loaded.runtimeState[task.key] ?? runtimeByFilePath.get(task.filePath) ?? runtimeById.get(task.id);
        return {
          id: task.id,
          filePath: task.filePath,
          scheduleType: task.schedule.type,
          running: runtime?.running ?? false,
          enabled: task.enabled,
          cron: task.schedule.type === 'cron' ? task.schedule.expression : undefined,
          at: task.schedule.type === 'at' ? task.schedule.at : undefined,
          prompt: task.prompt.split('\n')[0]?.slice(0, 120) ?? '',
          model: task.modelRef,
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
        taskId?: string;
        enabled?: boolean;
        cron?: string | null;
        at?: string | null;
        model?: string | null;
        cwd?: string | null;
        timeoutSeconds?: number | null;
        prompt?: string;
      };
      const profile = getCurrentProfileFn();
      const taskId = readRequiredTaskId(body.taskId);
      const filePath = join(taskDirForProfile(profile), `${taskId}.task.md`);
      const loaded = loadScheduledTasksForProfile(profile);

      if (existsSync(filePath) || loaded.tasks.some((task) => task.id === taskId)) {
        res.status(409).json({ error: `Task already exists: ${taskId}` });
        return;
      }

      const content = buildScheduledTaskMarkdown({
        taskId,
        profile,
        enabled: body.enabled ?? true,
        cron: body.cron,
        at: body.at,
        model: body.model,
        cwd: body.cwd,
        timeoutSeconds: body.timeoutSeconds,
        prompt: body.prompt ?? '',
      });

      validateScheduledTaskDefinition(filePath, content);

      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
      invalidateAppTopics('tasks');

      const savedTask = resolveScheduledTaskForProfile(profile, taskId);
      res.status(201).json({
        ok: true,
        task: buildTaskDetailResponse(savedTask.task, savedTask.runtime),
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
        enabled?: boolean;
        cron?: string | null;
        at?: string | null;
        model?: string | null;
        cwd?: string | null;
        timeoutSeconds?: number | null;
        prompt?: string;
      };
      const resolvedTask = findCurrentProfileTask(req.params.id);
      if (!resolvedTask) { res.status(404).json({ error: 'Task not found' }); return; }

      const requestedKeys = Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined);
      const enabled = body.enabled;
      const toggleOnly = requestedKeys.length === 1 && requestedKeys[0] === 'enabled' && typeof enabled === 'boolean';

      if (toggleOnly) {
        let content = readFileSync(resolvedTask.task.filePath, 'utf-8');
        if (/enabled:\s*(true|false)/.test(content)) {
          content = content.replace(/enabled:\s*(true|false)/, `enabled: ${enabled}`);
        } else {
          content = content.replace(/^---\n/, `---\nenabled: ${enabled}\n`);
        }
        writeFileSync(resolvedTask.task.filePath, content, 'utf-8');
        invalidateAppTopics('tasks');

        const updatedTask = resolveScheduledTaskForProfile(getCurrentProfileFn(), resolvedTask.task.id);
        res.json({ ok: true, task: buildTaskDetailResponse(updatedTask.task, updatedTask.runtime) });
        return;
      }

      const schedule = resolvedTask.task.schedule;
      const nextContent = buildScheduledTaskMarkdown({
        taskId: resolvedTask.task.id,
        profile: resolvedTask.task.profile,
        enabled: body.enabled ?? resolvedTask.task.enabled,
        cron: body.cron !== undefined ? body.cron : schedule.type === 'cron' ? schedule.expression : undefined,
        at: body.at !== undefined ? body.at : schedule.type === 'at' ? schedule.at : undefined,
        model: body.model !== undefined ? body.model : resolvedTask.task.modelRef,
        cwd: body.cwd !== undefined ? body.cwd : resolvedTask.task.cwd,
        timeoutSeconds: body.timeoutSeconds !== undefined ? body.timeoutSeconds : resolvedTask.task.timeoutSeconds,
        prompt: body.prompt ?? resolvedTask.task.prompt,
      });

      validateScheduledTaskDefinition(resolvedTask.task.filePath, nextContent);

      writeFileSync(resolvedTask.task.filePath, nextContent, 'utf-8');
      invalidateAppTopics('tasks');

      const updatedTask = resolveScheduledTaskForProfile(getCurrentProfileFn(), resolvedTask.task.id);
      res.json({ ok: true, task: buildTaskDetailResponse(updatedTask.task, updatedTask.runtime) });
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
      const resolvedTask = findCurrentProfileTask(req.params.id);
      if (!resolvedTask?.runtime?.lastLogPath || !existsSync(resolvedTask.runtime.lastLogPath)) {
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
      const resolvedTask = findCurrentProfileTask(req.params.id);
      if (!resolvedTask) { res.status(404).json({ error: 'Task not found' }); return; }

      res.json(buildTaskDetailResponse(resolvedTask.task, resolvedTask.runtime));
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
      const resolvedTask = findCurrentProfileTask(req.params.id);
      if (!resolvedTask) { res.status(404).json({ error: 'Task not found' }); return; }
      if (!resolvedTask.task.prompt.trim()) { res.status(400).json({ error: 'Task has no prompt body' }); return; }

      const result = await startScheduledTaskRun(resolvedTask.task.filePath);
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
