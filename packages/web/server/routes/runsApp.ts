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
import { logError } from '../middleware/index.js';

const ACTIVE_RUN_POLL_INTERVAL_MS = 1_000;
const IDLE_RUN_POLL_INTERVAL_MS = 5_000;

function parseRunLogTail(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : undefined;
  return Number.isFinite(parsed) && (parsed as number) > 0
    ? Math.min(1000, parsed as number)
    : 120;
}

function getRunStreamPollInterval(snapshot: { detail: { run: { status?: { status?: string } | string } } }): number {
  const runStatus = typeof snapshot.detail.run.status === 'string'
    ? snapshot.detail.run.status
    : snapshot.detail.run.status?.status;

  return runStatus === 'queued'
    || runStatus === 'waiting'
    || runStatus === 'running'
    || runStatus === 'recovering'
    ? ACTIVE_RUN_POLL_INTERVAL_MS
    : IDLE_RUN_POLL_INTERVAL_MS;
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
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      const heartbeat = setInterval(() => {
        if (!closed) res.write(': heartbeat\n\n');
      }, 15_000);

      const stopStream = () => {
        closed = true;
        clearInterval(heartbeat);
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
      };

      const schedulePoll = (delayMs: number) => {
        if (closed) {
          return;
        }

        pollTimer = setTimeout(() => {
          void pollOnce();
        }, delayMs);
      };

      const pollOnce = async () => {
        if (closed) {
          return;
        }

        try {
          const next = await getDurableRunSnapshotFn(runId, tail);
          if (closed) {
            return;
          }

          if (!next) {
            writeEvent({ type: 'deleted', runId });
            stopStream();
            res.end();
            return;
          }

          writeEvent({ type: 'snapshot', detail: (next as { detail: unknown }).detail, log: (next as { log: unknown }).log });
          schedulePoll(getRunStreamPollInterval(next as { detail: { run: { status?: { status?: string } | string } } }));
        } catch {
          schedulePoll(ACTIVE_RUN_POLL_INTERVAL_MS);
        }
      };

      writeEvent({ type: 'snapshot', detail: (initial as { detail: unknown }).detail, log: (initial as { log: unknown }).log });
      schedulePoll(getRunStreamPollInterval(initial as { detail: { run: { status?: { status?: string } | string } } }));

      req.on('close', () => {
        stopStream();
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

}
