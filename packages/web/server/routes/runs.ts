/**
 * Runs routes
 *
 * Handles durable run listing, status, logs, and management.
 */

import type { Express } from 'express';
import type { LiveSessionResourceOptions } from './context.js';
import {
  cancelDurableRun,
  getDurableRun,
  getDurableRunLog,
  listDurableRuns,
} from '../automation/durableRuns.js';
import {
  readRemoteExecutionRunConversationId,
  importRemoteExecutionRun,
} from '../workspace/remoteExecution.js';
import { resolveConversationSessionFile } from '../conversations/conversationService.js';
import { publishConversationSessionMetaChanged } from '../conversations/conversationService.js';
import {
  invalidateAppTopics,
  logError,
} from '../middleware/index.js';

/**
 * Gets the current profile getter for use in route handlers.
 */
let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for run routes');
};

let REPO_ROOT: string = '';
let getDefaultWebCwdFn: () => string = () => '/tmp';
let buildLiveSessionExtensionFactoriesFn: () => unknown[] = () => [];
let buildLiveSessionResourceOptionsFn: (profile?: string) => LiveSessionResourceOptions = () => ({
  additionalExtensionPaths: [],
  additionalSkillPaths: [],
  additionalPromptTemplatePaths: [],
  additionalThemePaths: [],
});

export function setRunsRoutesGetters(
  getCurrentProfile: () => string,
  repoRoot: string,
  getDefaultWebCwd: () => string,
  buildLiveSessionResourceOptions: (profile?: string) => LiveSessionResourceOptions,
  buildLiveSessionExtensionFactories: () => unknown[],
): void {
  getCurrentProfileFn = getCurrentProfile;
  REPO_ROOT = repoRoot;
  getDefaultWebCwdFn = getDefaultWebCwd;
  buildLiveSessionResourceOptionsFn = buildLiveSessionResourceOptions;
  buildLiveSessionExtensionFactoriesFn = buildLiveSessionExtensionFactories;
}

function parseRunLogTail(queryTail: unknown): number | undefined {
  if (typeof queryTail !== 'string') {
    return undefined;
  }
  const parsed = parseInt(queryTail, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function registerRunRoutes(router: Pick<Express, 'get' | 'post' | 'patch'>): void {
  router.get('/api/runs', async (_req, res) => {
    try {
      const runs = await listDurableRuns();
      res.json(runs);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/runs/:id', async (req, res) => {
    try {
      const result = await getDurableRun(req.params.id);
      if (!result) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch('/api/runs/:id/attention', async (req, res) => {
    try {
      const { read } = req.body as { read?: boolean };
      const profile = getCurrentProfileFn();
      if (read === false) {
        invalidateAppTopics('runs');
      }
      res.json({ ok: true });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/runs/:id/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const runId = req.params.id;
    const writeSnapshot = () => {
      void getDurableRun(runId).then((detail) => {
        if (detail) {
          res.write(`data: ${JSON.stringify(detail)}\n\n`);
        }
      }).catch(() => undefined);
    };

    writeSnapshot();

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15_000);

    const pollInterval = setInterval(writeSnapshot, 5_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(pollInterval);
    });
  });

  router.get('/api/runs/:id/log', async (req, res) => {
    try {
      const tail = parseRunLogTail(req.query.tail);
      const result = await getDurableRunLog(req.params.id, tail);
      if (!result) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/runs/:id/cancel', async (req, res) => {
    try {
      const result = await cancelDurableRun(req.params.id);
      if (!result.cancelled) {
        res.status(409).json({ error: result.reason ?? 'Could not cancel run.' });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/runs/:id/import', async (req, res) => {
    try {
      const detail = await getDurableRun(req.params.id);
      if (!detail) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const conversationId = readRemoteExecutionRunConversationId(detail.run);
      if (!conversationId) {
        res.status(409).json({ error: 'This run is not a remote execution run.' });
        return;
      }
      const sessionFile = resolveConversationSessionFile(conversationId) ?? detail.run.manifest?.source?.filePath;
      if (!sessionFile) {
        res.status(404).json({ error: 'Conversation not found for this remote run.' });
        return;
      }
      const result = await importRemoteExecutionRun({
        run: detail.run,
        sessionFile,
      });
      publishConversationSessionMetaChanged(conversationId);
      invalidateAppTopics('runs');
      res.json({ ok: true, runId: req.params.id, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('not found') ? 404 :
        message.includes('already been imported') || message.includes('has not completed') || message.includes('not a remote execution run') || message.includes('Wait for the current local turn') ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });
}

export function registerCompanionRunRoutes(router: Pick<Express, 'get'>): void {
  router.get('/api/runs', async (_req, res) => {
    try {
      res.json(await listDurableRuns());
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/runs/:id', async (req, res) => {
    try {
      const result = await getDurableRun(req.params.id);
      if (!result) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/runs/:id/log', async (req, res) => {
    try {
      const tail = parseRunLogTail(req.query.tail);
      const result = await getDurableRunLog(req.params.id, tail);
      if (!result) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}
