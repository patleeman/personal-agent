import type { Express, Response } from 'express';

import { getDurableRunLogCursor, readDurableRunLogDelta } from '../automation/durableRuns.js';
import {
  cancelExecution,
  followUpExecution,
  getExecution,
  getExecutionLog,
  listConversationExecutions,
  listExecutions,
  rerunExecution,
} from '../executions/executionService.js';
import { invalidateAppTopics, logError } from '../middleware/index.js';

function parseLogTail(queryTail: unknown): number | undefined {
  if (typeof queryTail !== 'string') return undefined;
  const normalized = queryTail.trim();
  if (!/^\d+$/.test(normalized)) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(1000, parsed) : undefined;
}

const ACTIVE_EXECUTION_POLL_INTERVAL_MS = 1_000;
const IDLE_EXECUTION_POLL_INTERVAL_MS = 5_000;
const ACTIVE_EXECUTION_LOG_POLL_INTERVAL_MS = 500;
const IDLE_EXECUTION_LOG_POLL_INTERVAL_MS = 2_500;

function isExecutionActive(status: string | undefined): boolean {
  return status === 'queued' || status === 'waiting' || status === 'running' || status === 'recovering';
}

function handleError(res: Response, err: unknown): void {
  logError('request handler error', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ error: String(err) });
}

export function registerExecutionRoutes(router: Pick<Express, 'get' | 'post'>): void {
  router.get('/api/executions', async (_req, res) => {
    try {
      res.json(await listExecutions());
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/api/conversations/:id/executions', async (req, res) => {
    try {
      res.json(await listConversationExecutions(req.params.id));
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/api/executions/:id', async (req, res) => {
    try {
      const result = await getExecution(req.params.id);
      if (!result) {
        res.status(404).json({ error: 'Execution not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/api/executions/:id/events', async (req, res) => {
    const executionId = req.params.id;
    const tail = parseLogTail(req.query.tail);
    try {
      const [initialDetail, initialLog] = await Promise.all([getExecution(executionId), getExecutionLog(executionId, tail)]);
      if (!initialDetail || !initialLog) {
        res.status(404).json({ error: 'Execution not found' });
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
      let logPath = initialLog.path;
      let logCursor = getDurableRunLogCursor(logPath);
      let active = isExecutionActive(initialDetail.execution.status);
      const heartbeat = setInterval(() => {
        if (!closed) res.write(': heartbeat\n\n');
      }, 15_000);

      const stopStream = () => {
        closed = true;
        clearInterval(heartbeat);
        if (detailPollTimer) clearTimeout(detailPollTimer);
        if (logPollTimer) clearTimeout(logPollTimer);
      };

      const scheduleDetailPoll = (delayMs: number) => {
        if (!closed) detailPollTimer = setTimeout(() => void pollDetailOnce(), delayMs);
      };
      const scheduleLogPoll = (delayMs: number) => {
        if (!closed) logPollTimer = setTimeout(() => void pollLogOnce(), delayMs);
      };

      const pollDetailOnce = async () => {
        if (closed) return;
        try {
          const detail = await getExecution(executionId);
          if (closed) return;
          if (!detail) {
            writeEvent({ type: 'deleted', executionId });
            stopStream();
            res.end();
            return;
          }
          active = isExecutionActive(detail.execution.status);
          writeEvent({ type: 'detail', detail });
          scheduleDetailPoll(active ? ACTIVE_EXECUTION_POLL_INTERVAL_MS : IDLE_EXECUTION_POLL_INTERVAL_MS);
        } catch {
          scheduleDetailPoll(ACTIVE_EXECUTION_POLL_INTERVAL_MS);
        }
      };

      const pollLogOnce = async () => {
        if (closed) return;
        try {
          const delta = readDurableRunLogDelta(logPath, logCursor);
          if (closed) return;
          if (delta?.reset) {
            const log = await getExecutionLog(executionId, tail);
            if (!log) {
              writeEvent({ type: 'deleted', executionId });
              stopStream();
              res.end();
              return;
            }
            logPath = log.path;
            logCursor = getDurableRunLogCursor(logPath);
            writeEvent({ type: 'log', log });
          } else if (delta) {
            logCursor = delta.nextCursor;
            if (delta.delta.length > 0) writeEvent({ type: 'log_delta', path: delta.path, delta: delta.delta });
          }
        } finally {
          scheduleLogPoll(active ? ACTIVE_EXECUTION_LOG_POLL_INTERVAL_MS : IDLE_EXECUTION_LOG_POLL_INTERVAL_MS);
        }
      };

      writeEvent({ type: 'snapshot', detail: initialDetail, log: initialLog });
      scheduleDetailPoll(active ? ACTIVE_EXECUTION_POLL_INTERVAL_MS : IDLE_EXECUTION_POLL_INTERVAL_MS);
      scheduleLogPoll(active ? ACTIVE_EXECUTION_LOG_POLL_INTERVAL_MS : IDLE_EXECUTION_LOG_POLL_INTERVAL_MS);
      req.on('close', stopStream);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/api/executions/:id/log', async (req, res) => {
    try {
      const result = await getExecutionLog(req.params.id, parseLogTail(req.query.tail));
      if (!result) {
        res.status(404).json({ error: 'Execution not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/api/executions/:id/cancel', async (req, res) => {
    try {
      const result = await cancelExecution(req.params.id);
      if (!result.cancelled) {
        res.status(409).json({ error: result.reason ?? 'Could not cancel execution.' });
        return;
      }
      invalidateAppTopics('executions', 'runs');
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/api/executions/:id/rerun', async (req, res) => {
    try {
      const result = await rerunExecution(req.params.id);
      if (!result.accepted) {
        res.status(409).json({ error: result.reason ?? 'Could not rerun execution.' });
        return;
      }
      invalidateAppTopics('executions', 'runs');
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/api/executions/:id/follow-up', async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : undefined;
      const result = await followUpExecution(req.params.id, prompt);
      if (!result.accepted) {
        res.status(409).json({ error: result.reason ?? 'Could not continue execution.' });
        return;
      }
      invalidateAppTopics('executions', 'runs');
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });
}
