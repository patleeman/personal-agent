/**
 * Runs routes
 *
 * Handles durable run listing, status, logs, and management.
 */

import type { Express } from 'express';
import {
  cancelDurableRun,
  getDurableRun,
  getDurableRunLog,
  listDurableRuns,
} from '../automation/durableRuns.js';
import {
  invalidateAppTopics,
  logError,
} from '../middleware/index.js';

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
