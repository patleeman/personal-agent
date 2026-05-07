/**
 * Runs routes (app)
 *
 * Handles durable run listing, status, logs, cancel, import, and SSE events.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { pingDaemon, startBackgroundRun } from '@personal-agent/daemon';
import type { Express, Response } from 'express';

import {
  cancelDurableRun,
  getDurableRun,
  getDurableRunLog,
  getDurableRunLogCursor,
  listDurableRuns,
  readDurableRunLogDelta,
} from '../automation/durableRuns.js';
import { PA_CLIENT_JS } from '../extensions/pa-client.js';
import { invalidateAppTopics, logError } from '../middleware/index.js';
import type { ServerRouteContext } from './context.js';

// Lazy-load PA component CSS
let paComponentsCss: string | null = null;
const __dirname = new URL('.', import.meta.url).pathname;
const EXTENSIONS_DIR = join(__dirname, '..', 'extensions');

function getPaComponentsCss(): string {
  if (paComponentsCss === null) {
    try {
      paComponentsCss = readFileSync(join(EXTENSIONS_DIR, 'pa-components.css'), 'utf-8');
    } catch {
      paComponentsCss = '/* PA components not available */';
    }
  }

  return paComponentsCss;
}

const ACTIVE_RUN_POLL_INTERVAL_MS = 1_000;
const IDLE_RUN_POLL_INTERVAL_MS = 5_000;
const ACTIVE_RUN_LOG_POLL_INTERVAL_MS = 250;
const IDLE_RUN_LOG_POLL_INTERVAL_MS = 2_000;

function parseRunLogTail(raw: unknown): number {
  const normalized = typeof raw === 'string' ? raw.trim() : '';
  const parsed = /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : undefined;
  return Number.isSafeInteger(parsed) && (parsed as number) > 0 ? Math.min(1000, parsed as number) : 120;
}

function isRunStreamActive(snapshot: { detail: { run: { status?: { status?: string } | string } } }): boolean {
  const runStatus = typeof snapshot.detail.run.status === 'string' ? snapshot.detail.run.status : snapshot.detail.run.status?.status;

  return runStatus === 'queued' || runStatus === 'waiting' || runStatus === 'running' || runStatus === 'recovering';
}

function getRunStreamPollInterval(snapshot: { detail: { run: { status?: { status?: string } | string } } }): number {
  return isRunStreamActive(snapshot) ? ACTIVE_RUN_POLL_INTERVAL_MS : IDLE_RUN_POLL_INTERVAL_MS;
}

function getRunLogPollInterval(active: boolean): number {
  return active ? ACTIVE_RUN_LOG_POLL_INTERVAL_MS : IDLE_RUN_LOG_POLL_INTERVAL_MS;
}

let getDurableRunSnapshotFn: (runId: string, tail: number) => Promise<unknown | null> = async () => {
  throw new Error('not initialized');
};

function initializeRunsAppRoutesContext(context: Pick<ServerRouteContext, 'getDurableRunSnapshot'>): void {
  getDurableRunSnapshotFn = context.getDurableRunSnapshot;
}

export function registerRunAppRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch'>,
  context: Pick<ServerRouteContext, 'getDurableRunSnapshot'>,
): void {
  initializeRunsAppRoutesContext(context);

  function sendPaClient(_req: unknown, res: Response) {
    try {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(PA_CLIENT_JS);
    } catch (err) {
      logError('PA client serve error', {
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Failed to serve PA client' });
    }
  }

  function sendPaComponents(_req: unknown, res: Response) {
    try {
      res.setHeader('Content-Type', 'text/css');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(getPaComponentsCss());
    } catch (err) {
      logError('PA components serve error', {
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Failed to serve PA components' });
    }
  }

  // Serve PA client assets for extension iframes. The /api aliases
  // avoid renderer-dev-server history fallback when iframe srcdoc fetches them.
  router.get('/pa/client.js', sendPaClient);
  router.get('/api/pa/client.js', sendPaClient);
  router.get('/pa/components.css', sendPaComponents);
  router.get('/api/pa/components.css', sendPaComponents);

  // POST /api/runs — create a durable agent run from an assembled prompt.
  router.post('/api/runs', async (req, res) => {
    try {
      const { prompt, source } = req.body;

      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }

      if (!(await pingDaemon())) {
        res.status(503).json({ error: 'Daemon is not responding. Ensure the desktop app is running.' });
        return;
      }

      const appName = typeof source === 'string' && source.startsWith('app:') ? source.slice(4) : 'custom';
      const result = await startBackgroundRun({
        taskSlug: `app-${appName}`,
        cwd: process.cwd(),
        agent: {
          prompt,
          noSession: true,
        },
        source: {
          type: 'app',
          id: appName,
        },
      });

      if (!result.accepted) {
        res.status(503).json({ error: result.reason ?? 'Could not start run.' });
        return;
      }

      invalidateAppTopics('runs');
      res.status(201).json({ runId: result.runId, logPath: result.logPath });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

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

  router.get('/api/runs/:id/events', async (req, res) => {
    const runId = req.params.id;
    const tail = parseRunLogTail(req.query.tail);
    try {
      const initial = await getDurableRunSnapshotFn(runId, tail);
      if (!initial) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const writeEvent = (event: unknown) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      let closed = false;
      let detailPollTimer: ReturnType<typeof setTimeout> | null = null;
      let logPollTimer: ReturnType<typeof setTimeout> | null = null;
      let logPath = (initial as { log: { path: string } }).log.path;
      let logCursor = getDurableRunLogCursor(logPath);
      let runActive = isRunStreamActive(initial as { detail: { run: { status?: { status?: string } | string } } });
      const heartbeat = setInterval(() => {
        if (!closed) res.write(': heartbeat\n\n');
      }, 15_000);

      const stopStream = () => {
        closed = true;
        clearInterval(heartbeat);
        if (detailPollTimer) {
          clearTimeout(detailPollTimer);
          detailPollTimer = null;
        }
        if (logPollTimer) {
          clearTimeout(logPollTimer);
          logPollTimer = null;
        }
      };

      const scheduleDetailPoll = (delayMs: number) => {
        if (closed) {
          return;
        }

        detailPollTimer = setTimeout(() => {
          void pollDetailOnce();
        }, delayMs);
      };

      const scheduleLogPoll = (delayMs: number) => {
        if (closed) {
          return;
        }

        logPollTimer = setTimeout(() => {
          void pollLogOnce();
        }, delayMs);
      };

      const pollDetailOnce = async () => {
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

          const typedNext = next as { detail: { run: { status?: { status?: string } | string } }; log: { path: string; log: string } };
          runActive = isRunStreamActive(typedNext);
          if (typedNext.log.path !== logPath) {
            logPath = typedNext.log.path;
            logCursor = getDurableRunLogCursor(logPath);
            writeEvent({ type: 'snapshot', detail: typedNext.detail, log: typedNext.log });
          } else {
            writeEvent({ type: 'detail', detail: typedNext.detail });
          }
          scheduleDetailPoll(getRunStreamPollInterval(typedNext));
        } catch {
          scheduleDetailPoll(ACTIVE_RUN_POLL_INTERVAL_MS);
        }
      };

      const pollLogOnce = async () => {
        if (closed) {
          return;
        }

        try {
          const delta = readDurableRunLogDelta(logPath, logCursor);
          if (closed) {
            return;
          }

          if (delta?.reset) {
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

            const typedNext = next as {
              detail: { run: { status?: { status?: string } | string } };
              log: { path: string; log: string };
            };
            runActive = isRunStreamActive(typedNext);
            logPath = typedNext.log.path;
            logCursor = getDurableRunLogCursor(logPath);
            writeEvent({ type: 'snapshot', detail: typedNext.detail, log: typedNext.log });
          } else if (delta) {
            logCursor = delta.nextCursor;
            if (delta.delta.length > 0) {
              writeEvent({ type: 'log_delta', path: delta.path, delta: delta.delta });
            }
          }
        } finally {
          scheduleLogPoll(getRunLogPollInterval(runActive));
        }
      };

      writeEvent({ type: 'snapshot', detail: (initial as { detail: unknown }).detail, log: (initial as { log: unknown }).log });
      scheduleDetailPoll(getRunStreamPollInterval(initial as { detail: { run: { status?: { status?: string } | string } } }));
      scheduleLogPoll(getRunLogPollInterval(runActive));

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
      invalidateAppTopics('runs');
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
