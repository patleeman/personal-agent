/**
 * Traces Routes
 *
 * Aggregation endpoints for the Traces monitoring page.
 * All queries filter by ?range=1h|6h|24h|7d|30d which maps to a timestamp threshold.
 */

import {
  queryAgentLoop,
  queryAutoMode,
  queryCacheEfficiency,
  queryCacheEfficiencyAggregate,
  queryCompactionAggregates,
  queryCompactions,
  queryContextPointerUsage,
  queryContextSessions,
  queryCostByConversation,
  queryModelUsage,
  querySummary,
  querySystemPromptAggregate,
  querySystemPromptTrend,
  queryThroughput,
  queryTokensDaily,
  queryToolFlow,
  queryToolHealth,
} from '@personal-agent/core';
import type { Express } from 'express';

import { logError } from '../middleware/index.js';

function parseRangeParam(range: unknown): string {
  const valid = ['1h', '6h', '24h', '7d', '30d'];
  const value = typeof range === 'string' ? range.trim() : '24h';
  if (!valid.includes(value)) return '24h';

  const now = Date.now();
  const ms: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - ms[value]).toISOString();
}

export function registerTraceRoutes(router: Pick<Express, 'get' | 'post' | 'patch'>): void {
  // ── Summary (pulse row) ──────────────────────────────────────────────────
  router.get('/api/traces/summary', (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const summary = querySummary(since);
      res.json(summary);
    } catch (err) {
      logError('traces summary error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Model usage ──────────────────────────────────────────────────────────
  router.get('/api/traces/model-usage', (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const models = queryModelUsage(since);
      const throughput = queryThroughput(since);
      res.json({ models, throughput });
    } catch (err) {
      logError('traces model-usage error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Cost by conversation ─────────────────────────────────────────────────
  router.get('/api/traces/cost-by-conversation', (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const rows = queryCostByConversation(since);
      res.json(rows);
    } catch (err) {
      logError('traces cost-by-conversation error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Tool health ──────────────────────────────────────────────────────────
  router.get('/api/traces/tool-health', (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const tools = queryToolHealth(since);
      res.json(tools);
    } catch (err) {
      logError('traces tool-health error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Context pressure + compactions ───────────────────────────────────────
  router.get('/api/traces/context', (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const sessions = queryContextSessions(since);
      const compactions = queryCompactions(since);
      const compactionAggs = queryCompactionAggregates(since);
      res.json({ sessions, compactions, compactionAggs });
    } catch (err) {
      logError('traces context error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Agent loop ───────────────────────────────────────────────────────────
  router.get('/api/traces/agent-loop', (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const loop = queryAgentLoop(since);
      res.json(loop);
    } catch (err) {
      logError('traces agent-loop error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Token daily (heatmap data) ───────────────────────────────────────────
  router.get('/api/traces/tokens-daily', (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const daily = queryTokensDaily(since);
      res.json(daily);
    } catch (err) {
      logError('traces tokens-daily error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Tool flow / trajectories ────────────────────────────────────────────
  router.get('/api/traces/tool-flow', (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const flow = queryToolFlow(since);
      res.json(flow);
    } catch (err) {
      logError('traces tool-flow error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/traces/cache-efficiency', async (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const [series, aggregate] = await Promise.all([queryCacheEfficiency(since), queryCacheEfficiencyAggregate(since)]);
      res.json({ series, aggregate });
    } catch (err) {
      logError('traces cache-efficiency error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── System prompt trend ────────────────────────────────────────────────
  router.get('/api/traces/system-prompt', async (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const [series, aggregate] = await Promise.all([querySystemPromptTrend(since), querySystemPromptAggregate(since)]);
      res.json({ series, aggregate });
    } catch (err) {
      logError('traces system-prompt error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/traces/auto-mode', (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const autoMode = queryAutoMode(since);
      res.json(autoMode);
    } catch (err) {
      logError('traces auto-mode error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Context pointer usage ───────────────────────────────────────────────
  router.get('/api/traces/context-pointers', (req, res) => {
    try {
      const since = parseRangeParam(req.query.range);
      const result = queryContextPointerUsage(since);
      res.json(result);
    } catch (err) {
      logError('traces context-pointers error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
}
