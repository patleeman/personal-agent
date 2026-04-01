/**
 * Runs routes (app)
 *
 * Handles durable run listing, status, logs, cancel, import, and SSE events.
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import {
  getDurableRun,
  getDurableRunLog,
  listDurableRuns,
  cancelDurableRun,
} from '../automation/durableRuns.js';
import {
  importRemoteExecutionRun,
  readRemoteExecutionRunConversationId,
} from '../workspace/remoteExecution.js';
import { resolveConversationSessionFile, publishConversationSessionMetaChanged } from '../conversations/conversationService.js';
import { invalidateAppTopics, logError } from '../middleware/index.js';

function parseRunLogTail(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : undefined;
  return Number.isFinite(parsed) && (parsed as number) > 0
    ? Math.min(1000, parsed as number)
    : 120;
}

let getDurableRunSnapshotFn: (runId: string, tail: number) => Promise<unknown | null> = async () => {
  throw new Error('not initialized');
};

function initializeRunsAppRoutesContext(
  context: Pick<ServerRouteContext, 'getDurableRunSnapshot'>,
): void {
  getDurableRunSnapshotFn = context.getDurableRunSnapshot;
}

export function registerRunAppRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch'>,
  context: Pick<ServerRouteContext, 'getDurableRunSnapshot'>,
): void {
  initializeRunsAppRoutesContext(context);
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
      if (!result) { res.status(404).json({ error: 'Run not found' }); return; }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/runs/:id/events', async (req, res) => {
    const runId = req.params.id;
    const tail = parseRunLogTail(req.query.tail);
    try {
      const initial = await getDurableRunSnapshotFn(runId, tail);
      if (!initial) { res.status(404).json({ error: 'Run not found' }); return; }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const writeEvent = (event: unknown) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      let closed = false;
      const heartbeat = setInterval(() => {
        if (!closed) res.write(': heartbeat\n\n');
      }, 15_000);

      const poll = setInterval(async () => {
        if (closed) return;
        try {
          const next = await getDurableRunSnapshotFn(runId, tail);
          if (!next) {
            writeEvent({ type: 'deleted', runId });
            closed = true;
            clearInterval(heartbeat);
            clearInterval(poll);
            res.end();
            return;
          }
          writeEvent({ type: 'snapshot', detail: (next as { detail: unknown }).detail, log: (next as { log: unknown }).log });
        } catch { /* ignore */ }
      }, 5_000);

      writeEvent({ type: 'snapshot', detail: (initial as { detail: unknown }).detail, log: (initial as { log: unknown }).log });

      req.on('close', () => {
        closed = true;
        clearInterval(heartbeat);
        clearInterval(poll);
      });
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
      if (!result) { res.status(404).json({ error: 'Run not found' }); return; }
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
      if (!result.cancelled) { res.status(409).json({ error: result.reason ?? 'Could not cancel run.' }); return; }
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
      if (!detail) { res.status(404).json({ error: 'Run not found' }); return; }
      const conversationId = readRemoteExecutionRunConversationId(detail.run);
      if (!conversationId) { res.status(409).json({ error: 'This run is not a remote execution run.' }); return; }
      const sessionFile = resolveConversationSessionFile(conversationId) ?? (detail.run as { manifest?: { source?: { filePath?: string } } }).manifest?.source?.filePath;
      if (!sessionFile) { res.status(404).json({ error: 'Conversation not found for this remote run.' }); return; }
      const result = await importRemoteExecutionRun({ run: detail.run, sessionFile });
      publishConversationSessionMetaChanged(conversationId);
      invalidateAppTopics('runs');
      res.json({ ok: true, runId: req.params.id, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(String(err));
      const status = message.includes('not found') ? 404 :
        message.includes('already been imported') || message.includes('has not completed') || message.includes('not a remote execution run') || message.includes('Wait for the current local turn') ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });
}
