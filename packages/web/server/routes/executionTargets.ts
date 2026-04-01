/**
 * Execution targets routes
 * 
 * Handles execution target CRUD and workspace folder management.
 */

import type { Express } from 'express';
import {
  listExecutionTargets,
  saveExecutionTarget,
  deleteExecutionTarget,
  type SaveExecutionTargetInput,
} from '@personal-agent/core';
import { invalidateAppTopics, logError } from '../middleware/index.js';

let readExecutionTargetsStateFn: () => Promise<unknown> = async () => {
  throw new Error('readExecutionTargetsState not initialized for execution target routes');
};

let browseRemoteTargetDirectoryFn: (input: { targetId: string; cwd?: string; baseCwd?: string }) => Promise<unknown> = async () => {
  throw new Error('browseRemoteTargetDirectory not initialized');
};

export function setExecutionTargetRoutesGetters(
  readState: () => Promise<unknown>,
  browseDir: (input: { targetId: string; cwd?: string; baseCwd?: string }) => Promise<unknown>,
): void {
  readExecutionTargetsStateFn = readState;
  browseRemoteTargetDirectoryFn = browseDir;
}

export function registerExecutionTargetRoutes(router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>): void {
  router.get('/api/execution-targets', async (_req, res) => {
    try {
      const state = await readExecutionTargetsStateFn();
      res.json(state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/execution-targets', async (req, res) => {
    try {
      saveExecutionTarget({
        target: req.body as SaveExecutionTargetInput,
      });
      const state = await readExecutionTargetsStateFn();
      invalidateAppTopics('executionTargets');
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes('required') || message.startsWith('Invalid execution target') ? 400 : 500).json({ error: message });
    }
  });

  router.patch('/api/execution-targets/:id', async (req, res) => {
    try {
      saveExecutionTarget({
        target: { ...(req.body as SaveExecutionTargetInput), id: req.params.id },
      });
      const state = await readExecutionTargetsStateFn();
      invalidateAppTopics('executionTargets');
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes('required') || message.startsWith('Invalid execution target') ? 400 : 500).json({ error: message });
    }
  });

  router.delete('/api/execution-targets/:id', async (req, res) => {
    try {
      if (!deleteExecutionTarget({ targetId: req.params.id })) {
        res.status(404).json({ error: 'Execution target not found.' });
        return;
      }
      const state = await readExecutionTargetsStateFn();
      invalidateAppTopics('executionTargets');
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.startsWith('Invalid execution target') ? 400 : 500).json({ error: message });
    }
  });

  router.post('/api/execution-targets/:targetId/folders', async (req, res) => {
    try {
      const { cwd, baseCwd } = req.body as { cwd?: string; baseCwd?: string };
      const result = await browseRemoteTargetDirectoryFn({
        targetId: req.params.targetId,
        cwd,
        baseCwd,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('not found')
        ? 404
        : message.includes('Directory does not exist') || message.includes('Not a directory') || message.endsWith('required')
          ? 400
          : 500;
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(status).json({ error: message });
    }
  });
}
