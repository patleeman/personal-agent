/**
 * Trace Database
 *
 * SQLite-backed telemetry storage for the Traces monitoring page.
 * Stores turn-level stats, tool calls, context snapshots, compaction events,
 * and queue operations in a dedicated trace.db per profile.
 *
 * All writes are fire-and-forget — they never block the session loop.
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { getStateRoot } from './runtime/paths.js';
import { openSqliteDatabase, type SqliteDatabase } from './sqlite.js';

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS trace_stats (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  model_id TEXT,
  profile TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  tokens_cached_input INTEGER DEFAULT 0,
  tokens_cached_write INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  turn_count INTEGER DEFAULT 0,
  step_count INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trace_tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  profile TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT,
  conversation_title TEXT
);

CREATE TABLE IF NOT EXISTS trace_context (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  model_id TEXT,
  total_tokens INTEGER DEFAULT 0,
  context_window INTEGER DEFAULT 0,
  pct REAL DEFAULT 0,
  seg_system INTEGER DEFAULT 0,
  seg_user INTEGER DEFAULT 0,
  seg_assistant INTEGER DEFAULT 0,
  seg_tool INTEGER DEFAULT 0,
  seg_summary INTEGER DEFAULT 0,
  system_prompt_tokens INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trace_compactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  reason TEXT NOT NULL,
  tokens_before INTEGER DEFAULT 0,
  tokens_after INTEGER DEFAULT 0,
  tokens_saved INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trace_queue (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  action TEXT NOT NULL,
  item_type TEXT DEFAULT '',
  wait_seconds INTEGER DEFAULT 0
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_trace_stats_ts ON trace_stats(ts);
CREATE INDEX IF NOT EXISTS idx_trace_stats_session ON trace_stats(session_id);
CREATE INDEX IF NOT EXISTS idx_trace_stats_model ON trace_stats(model_id);

CREATE INDEX IF NOT EXISTS idx_trace_tool_calls_ts ON trace_tool_calls(ts);
CREATE INDEX IF NOT EXISTS idx_trace_tool_calls_name ON trace_tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_trace_tool_calls_session ON trace_tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_trace_tool_calls_status ON trace_tool_calls(status);

CREATE INDEX IF NOT EXISTS idx_trace_context_ts ON trace_context(ts);
CREATE INDEX IF NOT EXISTS idx_trace_context_session ON trace_context(session_id);

CREATE INDEX IF NOT EXISTS idx_trace_compactions_ts ON trace_compactions(ts);
CREATE INDEX IF NOT EXISTS idx_trace_queue_ts ON trace_queue(ts);

CREATE TABLE IF NOT EXISTS trace_auto_mode (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_trace_auto_mode_ts ON trace_auto_mode(ts);
CREATE INDEX IF NOT EXISTS idx_trace_auto_mode_session ON trace_auto_mode(session_id);
`;

const MIGRATIONS = [
  `ALTER TABLE trace_stats ADD COLUMN duration_ms INTEGER DEFAULT 0`,
  `ALTER TABLE trace_stats ADD COLUMN tokens_cached_write INTEGER DEFAULT 0`,
];

// ── Database management ───────────────────────────────────────────────────────

const dbCache = new Map<string, SqliteDatabase>();

export function closeTraceDbs(): void {
  for (const db of dbCache.values()) {
    db.close();
  }
  dbCache.clear();
}

function resolveTraceDbDir(stateRoot?: string): string {
  return join(stateRoot ?? getStateRoot(), 'pi-agent', 'state', 'trace');
}

function resolveTraceDbPath(stateRoot?: string): string {
  return join(resolveTraceDbDir(stateRoot), 'trace.db');
}

// Prune rows older than this many days on each DB open
const TRACE_STATS_TTL_DAYS = 90;

function getTraceDb(stateRoot?: string): SqliteDatabase {
  const path = resolveTraceDbPath(stateRoot);
  const cached = dbCache.get(path);
  if (cached) return cached;

  const dir = resolveTraceDbDir(stateRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = openSqliteDatabase(path);
  db.exec(SCHEMA);
  for (const migration of MIGRATIONS) {
    try {
      db.exec(migration);
    } catch {
      // Column already exists. SQLite's ADD COLUMN has no IF NOT EXISTS on older versions.
    }
  }

  // Prune stale rows on open then vacuum to reclaim space (fire-and-forget)
  try {
    const cutoff = new Date(Date.now() - TRACE_STATS_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`DELETE FROM trace_stats WHERE ts < ?`).run(cutoff);
    db.prepare(`DELETE FROM trace_context WHERE ts < ?`).run(cutoff);
    db.prepare(`DELETE FROM trace_tool_calls WHERE ts < ?`).run(cutoff);
    db.prepare(`DELETE FROM trace_compactions WHERE ts < ?`).run(cutoff);
    db.prepare(`DELETE FROM trace_queue WHERE ts < ?`).run(cutoff);
    db.prepare(`DELETE FROM trace_auto_mode WHERE ts < ?`).run(cutoff);
    db.exec(`VACUUM`);
  } catch {
    // Non-fatal
  }

  dbCache.set(path, db);
  return db;
}

// ── ID generation ─────────────────────────────────────────────────────────────

function generateId(): string {
  return randomUUID();
}

function timestamp(): string {
  return new Date().toISOString();
}

// ── SQL result mapping ───────────────────────────────────────────────────
// SQLite returns snake_case keys. Convert to camelCase for TypeScript interfaces.
function mapRow<T extends object>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

function mapRows<T extends object>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => mapRow<T>(r));
}

// ── Writers (fire-and-forget) ─────────────────────────────────────────────────

export function writeTraceStats(params: {
  sessionId: string;
  runId?: string;
  modelId?: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCachedInput?: number;
  tokensCachedWrite?: number;
  cost: number;
  turnCount?: number;
  stepCount?: number;
  durationMs?: number;
  profile?: string;
}): void {
  try {
    const db = getTraceDb();
    const stmt = db.prepare(`
      INSERT INTO trace_stats (id, session_id, run_id, model_id, profile, ts, tokens_input, tokens_output, tokens_cached_input, tokens_cached_write, cost, turn_count, step_count, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      generateId(),
      params.sessionId,
      params.runId ?? null,
      params.modelId ?? null,
      params.profile ?? '',
      timestamp(),
      params.tokensInput,
      params.tokensOutput,
      params.tokensCachedInput ?? 0,
      params.tokensCachedWrite ?? 0,
      params.cost,
      params.turnCount ?? 0,
      params.stepCount ?? 0,
      params.durationMs ?? 0,
    );
  } catch (err) {
    // Fire-and-forget: silently ignore write failures
  }
}

export function writeTraceToolCall(params: {
  sessionId: string;
  runId?: string;
  toolName: string;
  durationMs?: number;
  status: 'ok' | 'error';
  errorMessage?: string;
  conversationTitle?: string;
  profile?: string;
}): void {
  try {
    const db = getTraceDb();
    const stmt = db.prepare(`
      INSERT INTO trace_tool_calls (id, session_id, run_id, profile, ts, tool_name, duration_ms, status, error_message, conversation_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      generateId(),
      params.sessionId,
      params.runId ?? null,
      params.profile ?? '',
      timestamp(),
      params.toolName,
      params.durationMs ?? null,
      params.status,
      params.errorMessage ?? null,
      params.conversationTitle ?? null,
    );
  } catch (err) {
    // Fire-and-forget
  }
}

export function writeTraceContext(params: {
  sessionId: string;
  modelId?: string;
  totalTokens: number;
  contextWindow: number;
  pct: number;
  segSystem?: number;
  segUser?: number;
  segAssistant?: number;
  segTool?: number;
  segSummary?: number;
  systemPromptTokens?: number;
  profile?: string;
}): void {
  try {
    const db = getTraceDb();
    const stmt = db.prepare(`
      INSERT INTO trace_context (id, session_id, profile, ts, model_id, total_tokens, context_window, pct, seg_system, seg_user, seg_assistant, seg_tool, seg_summary, system_prompt_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      generateId(),
      params.sessionId,
      params.profile ?? '',
      timestamp(),
      params.modelId ?? null,
      params.totalTokens,
      params.contextWindow,
      params.pct,
      params.segSystem ?? 0,
      params.segUser ?? 0,
      params.segAssistant ?? 0,
      params.segTool ?? 0,
      params.segSummary ?? 0,
      params.systemPromptTokens ?? 0,
    );
  } catch (err) {
    // Fire-and-forget
  }
}

export function writeTraceCompaction(params: {
  sessionId: string;
  reason: 'overflow' | 'threshold' | 'manual';
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  profile?: string;
}): void {
  try {
    const db = getTraceDb();
    const stmt = db.prepare(`
      INSERT INTO trace_compactions (id, session_id, profile, ts, reason, tokens_before, tokens_after, tokens_saved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      generateId(),
      params.sessionId,
      params.profile ?? '',
      timestamp(),
      params.reason,
      params.tokensBefore,
      params.tokensAfter,
      params.tokensSaved,
    );
  } catch (err) {
    // Fire-and-forget
  }
}

export function writeTraceQueue(params: {
  sessionId: string;
  action: 'enqueue' | 'dequeue' | 'timeout' | 'complete';
  itemType?: string;
  waitSeconds?: number;
  profile?: string;
}): void {
  try {
    const db = getTraceDb();
    const stmt = db.prepare(`
      INSERT INTO trace_queue (id, session_id, profile, ts, action, item_type, wait_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      generateId(),
      params.sessionId,
      params.profile ?? '',
      timestamp(),
      params.action,
      params.itemType ?? '',
      params.waitSeconds ?? 0,
    );
  } catch (err) {
    // Fire-and-forget
  }
}

export function writeTraceAutoMode(params: { sessionId: string; enabled: boolean; stopReason?: string | null; profile?: string }): void {
  try {
    const db = getTraceDb();
    const stmt = db.prepare(`
      INSERT INTO trace_auto_mode (id, session_id, profile, ts, enabled, stop_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(generateId(), params.sessionId, params.profile ?? '', timestamp(), params.enabled ? 1 : 0, params.stopReason ?? null);
  } catch (err) {
    // Fire-and-forget
  }
}

// ── Aggregation queries ───────────────────────────────────────────────────────

export interface TraceSummary {
  activeSessions: number;
  runsToday: number;
  totalCost: number;
  tokensTotal: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  tokensCachedWrite: number;
  cacheHitRate: number;
  toolErrors: number;
  toolCalls: number;
}

export function querySummary(since: string): TraceSummary {
  const db = getTraceDb();
  const rawStats = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(tokens_input + tokens_cached_input + tokens_cached_write + tokens_output), 0) as tokens_total,
      COALESCE(SUM(tokens_input), 0) as tokens_input,
      COALESCE(SUM(tokens_output), 0) as tokens_output,
      COALESCE(SUM(tokens_cached_input), 0) as tokens_cached,
      COALESCE(SUM(tokens_cached_write), 0) as tokens_cached_write,
      COALESCE(SUM(cost), 0) as total_cost,
      COUNT(DISTINCT session_id) as sessions_active
    FROM trace_stats WHERE ts >= ?
  `,
    )
    .get(since) as Record<string, unknown>;
  const stats = mapRow<{
    tokensTotal: number;
    tokensInput: number;
    tokensOutput: number;
    tokensCached: number;
    tokensCachedWrite: number;
    totalCost: number;
    sessionsActive: number;
  }>(rawStats);

  const rawErrors = db
    .prepare(
      `
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors
    FROM trace_tool_calls WHERE ts >= ?
  `,
    )
    .get(since) as Record<string, unknown>;
  const errors = mapRow<{ total: number; errors: number }>(rawErrors);

  const rawCount = db.prepare(`SELECT COUNT(DISTINCT id) as cnt FROM trace_stats WHERE ts >= ?`).get(since) as Record<string, unknown>;
  const count = mapRow<{ cnt: number }>(rawCount);

  const cacheableInput = Number(stats.tokensInput) + Number(stats.tokensCached) + Number(stats.tokensCachedWrite);
  const hitRate = cacheableInput > 0 ? Math.round((Number(stats.tokensCached) / cacheableInput) * 100) : 0;

  return {
    activeSessions: stats.sessionsActive,
    runsToday: count.cnt,
    totalCost: Math.round(stats.totalCost * 100) / 100,
    tokensTotal: stats.tokensTotal,
    tokensInput: stats.tokensInput,
    tokensOutput: stats.tokensOutput,
    tokensCached: stats.tokensCached,
    tokensCachedWrite: Number(stats.tokensCachedWrite),
    cacheHitRate: hitRate,
    toolErrors: errors.errors,
    toolCalls: errors.total,
  };
}

export interface ModelUsageRow {
  modelId: string;
  tokens: number;
  cost: number;
  calls: number;
}

export function queryModelUsage(since: string): ModelUsageRow[] {
  const db = getTraceDb();
  const raw = db
    .prepare(
      `
    SELECT
      COALESCE(model_id, 'unknown') as model_id,
      SUM(tokens_input + tokens_cached_input + tokens_output) as tokens,
      SUM(cost) as cost,
      COUNT(*) as calls
    FROM trace_stats WHERE ts >= ?
    GROUP BY model_id
    ORDER BY tokens DESC
  `,
    )
    .all(since) as Record<string, unknown>[];
  return mapRows<ModelUsageRow>(raw).map((r) => ({
    ...r,
    tokens: Number(r.tokens),
    cost: Math.round(Number(r.cost) * 100) / 100,
    calls: Number(r.calls),
  }));
}

export interface CostByConversationRow {
  conversationTitle: string;
  modelId: string;
  tokens: number;
  cost: number;
}

export function queryCostByConversation(since: string): CostByConversationRow[] {
  const db = getTraceDb();
  const rows = db
    .prepare(
      `
    SELECT
      COALESCE(c.conversation_title, s.session_id) as conversation_title,
      COALESCE(s.model_id, 'unknown') as model_id,
      SUM(s.tokens_input + s.tokens_cached_input + s.tokens_output) as tokens,
      SUM(s.cost) as cost
    FROM trace_stats s
    LEFT JOIN (
      SELECT session_id, MAX(conversation_title) as conversation_title
      FROM trace_tool_calls
      WHERE conversation_title IS NOT NULL AND conversation_title != ''
      GROUP BY session_id
    ) c ON c.session_id = s.session_id
    WHERE s.ts >= ?
    GROUP BY s.session_id, s.model_id, c.conversation_title
    ORDER BY cost DESC
    LIMIT 50
  `,
    )
    .all(since) as Record<string, unknown>[];
  return mapRows<CostByConversationRow>(rows).map((r) => ({
    ...r,
    tokens: Number(r.tokens),
    cost: Math.round(Number(r.cost) * 100) / 100,
  }));
}

export interface ToolHealthRow {
  toolName: string;
  calls: number;
  errors: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
}

export function queryToolHealth(since: string): ToolHealthRow[] {
  const db = getTraceDb();
  const rows = db
    .prepare(
      `
    SELECT
      tool_name,
      COUNT(*) as calls,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors,
      AVG(duration_ms) as avg_latency_ms,
      MAX(duration_ms) as max_latency_ms
    FROM trace_tool_calls WHERE ts >= ?
    GROUP BY tool_name
    ORDER BY calls DESC
  `,
    )
    .all(since) as Record<string, unknown>[];

  return mapRows<ToolHealthRow>(rows).map((r) => ({
    ...r,
    calls: Number(r.calls),
    errors: Number(r.errors),
    successRate: Number(r.calls) > 0 ? Math.round((1 - Number(r.errors) / Number(r.calls)) * 1000) / 10 : 100,
    avgLatencyMs: Number(r.avgLatencyMs) || 0,
    p95LatencyMs: queryToolLatencyP95(since, r.toolName),
    maxLatencyMs: Number(r.maxLatencyMs) || 0,
  }));
}

function queryToolLatencyP95(since: string, toolName: string): number {
  const db = getTraceDb();
  const rows = db
    .prepare(
      `
    SELECT duration_ms
    FROM trace_tool_calls
    WHERE ts >= ? AND tool_name = ? AND duration_ms IS NOT NULL
    ORDER BY duration_ms ASC
  `,
    )
    .all(since, toolName) as Array<{ duration_ms: number }>;

  if (rows.length === 0) {
    return 0;
  }

  const index = Math.ceil(rows.length * 0.95) - 1;
  return Number(rows[Math.max(0, Math.min(index, rows.length - 1))].duration_ms) || 0;
}

export interface ContextSessionRow {
  sessionId: string;
  totalTokens: number;
  contextWindow: number;
  pct: number;
  segSystem: number;
  segUser: number;
  segAssistant: number;
  segTool: number;
  segSummary: number;
  systemPromptTokens: number;
}

export function queryContextSessions(since: string): ContextSessionRow[] {
  const db = getTraceDb();
  const rawRows = db
    .prepare(
      `
    SELECT * FROM trace_context
    WHERE ts >= ?
    ORDER BY ts DESC
    LIMIT 100
  `,
    )
    .all(since) as Record<string, unknown>[];

  const mapped = mapRows<ContextSessionRow>(rawRows);

  // Deduplicate to latest per session
  const seen = new Set<string>();
  return mapped.filter((r) => {
    if (seen.has(r.sessionId)) return false;
    seen.add(r.sessionId);
    return true;
  });
}

export interface CompactionRow {
  sessionId: string;
  ts: string;
  reason: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
}

export function queryCompactions(since: string): CompactionRow[] {
  const db = getTraceDb();
  const rows = db
    .prepare(
      `
    SELECT session_id, ts, reason, tokens_before, tokens_after, tokens_saved
    FROM trace_compactions WHERE ts >= ?
    ORDER BY ts DESC
    LIMIT 50
  `,
    )
    .all(since) as Record<string, unknown>[];
  return mapRows<CompactionRow>(rows);
}

export function queryCompactionAggregates(since: string): {
  autoCount: number;
  manualCount: number;
  totalTokensSaved: number;
  overflowPct: number;
} {
  const db = getTraceDb();
  const raw = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(CASE WHEN reason IN ('overflow', 'threshold') THEN 1 ELSE 0 END), 0) as auto_count,
      COALESCE(SUM(CASE WHEN reason = 'manual' THEN 1 ELSE 0 END), 0) as manual_count,
      COALESCE(SUM(tokens_saved), 0) as total_saved,
      COALESCE(SUM(CASE WHEN reason = 'overflow' THEN 1 ELSE 0 END), 0) as overflow_count,
      COUNT(*) as total
    FROM trace_compactions WHERE ts >= ?
  `,
    )
    .get(since) as Record<string, unknown>;
  const result = mapRow<{ autoCount: number; manualCount: number; totalSaved: number; overflowCount: number; total: number }>(raw);

  return {
    autoCount: Number(result.autoCount),
    manualCount: Number(result.manualCount),
    totalTokensSaved: Number(result.totalSaved),
    overflowPct: result.total > 0 ? Math.round((Number(result.overflowCount) / Number(result.total)) * 100) : 0,
  };
}

export interface AgentLoopRow {
  turnsPerRun: number;
  stepsPerTurn: number;
  runsOver20Turns: number;
  subagentsPerRun: number;
  avgDurationMs: number;
  stuckRuns: number;
}

export function queryAgentLoop(since: string): AgentLoopRow {
  const db = getTraceDb();
  const rawStats = db
    .prepare(
      `
    SELECT
      AVG(turn_count) as avg_turns,
      CASE WHEN COALESCE(SUM(turn_count), 0) > 0 THEN CAST(SUM(step_count) AS REAL) / CAST(SUM(turn_count) AS REAL) ELSE 0 END as avg_steps,
      COUNT(*) as total_runs,
      COALESCE(SUM(CASE WHEN turn_count > 20 THEN 1 ELSE 0 END), 0) as runs_over_20,
      AVG(duration_ms) as avg_duration_ms,
      COALESCE(SUM(CASE WHEN duration_ms > 600000 THEN 1 ELSE 0 END), 0) as stuck_runs
    FROM trace_stats WHERE ts >= ? AND (run_id IS NOT NULL OR turn_count > 0 OR step_count > 0 OR duration_ms > 0)
  `,
    )
    .get(since) as Record<string, unknown>;
  const stats = mapRow<{
    avgTurns: number | null;
    avgSteps: number | null;
    totalRuns: number;
    runsOver20: number;
    avgDurationMs: number | null;
    stuckRuns: number;
  }>(rawStats);

  const rawSub = db
    .prepare(
      `
    SELECT COUNT(DISTINCT session_id || run_id) as runs_with_subagents
    FROM trace_tool_calls WHERE ts >= ? AND tool_name = 'subagent'
  `,
    )
    .get(since) as Record<string, unknown>;
  const sub = mapRow<{ runsWithSubagents: number }>(rawSub);

  const totalRuns = Math.max(Number(stats.totalRuns), 1);

  return {
    turnsPerRun: stats.avgTurns ? Math.round(Number(stats.avgTurns) * 10) / 10 : 0,
    stepsPerTurn: stats.avgSteps ? Math.round(Number(stats.avgSteps) * 10) / 10 : 0,
    runsOver20Turns: Number(stats.runsOver20),
    subagentsPerRun: Math.round((Number(sub.runsWithSubagents) / totalRuns) * 10) / 10,
    avgDurationMs: Math.round(Number(stats.avgDurationMs) || 0),
    stuckRuns: Number(stats.stuckRuns),
  };
}

export interface TokenDailyRow {
  date: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  tokensCachedWrite: number;
  toolErrors: number;
  cost: number;
}

export function queryTokensDaily(since: string): TokenDailyRow[] {
  const db = getTraceDb();
  const rows = db
    .prepare(
      `
    SELECT
      DATE(s.ts) as date,
      SUM(s.tokens_input) as tokens_input,
      SUM(s.tokens_output) as tokens_output,
      SUM(s.tokens_cached_input) as tokens_cached,
      SUM(s.tokens_cached_write) as tokens_cached_write,
      SUM(s.cost) as cost,
      COALESCE(e.error_count, 0) as tool_errors
    FROM trace_stats s
    LEFT JOIN (
      SELECT DATE(ts) as date, COUNT(*) as error_count
      FROM trace_tool_calls
      WHERE ts >= ? AND status = 'error'
      GROUP BY DATE(ts)
    ) e ON DATE(s.ts) = e.date
    WHERE s.ts >= ?
    GROUP BY DATE(s.ts)
    ORDER BY date ASC
  `,
    )
    .all(since, since) as Record<string, unknown>[];
  return mapRows<TokenDailyRow>(rows).map((r) => ({
    ...r,
    tokensInput: Number(r.tokensInput),
    tokensOutput: Number(r.tokensOutput),
    tokensCached: Number(r.tokensCached),
    tokensCachedWrite: Number(r.tokensCachedWrite),
    toolErrors: Number(r.toolErrors),
    cost: Number(r.cost),
  }));
}

export interface ThroughputRow {
  modelId: string;
  avgTokensPerSec: number;
}

export function queryThroughput(since: string): ThroughputRow[] {
  const db = getTraceDb();
  const rows = db
    .prepare(
      `
    SELECT
      COALESCE(model_id, 'unknown') as model_id,
      SUM(tokens_input + tokens_cached_input + tokens_output) as tokens,
      SUM(duration_ms) as duration_ms
    FROM trace_stats WHERE ts >= ? AND duration_ms > 0
    GROUP BY model_id
    ORDER BY tokens DESC
  `,
    )
    .all(since) as Record<string, unknown>[];
  const mapped = mapRows<{ modelId: string; tokens: number; durationMs: number }>(rows);
  return mapped.map((r) => ({
    modelId: r.modelId,
    avgTokensPerSec: Number(r.durationMs) > 0 ? Math.round(Number(r.tokens) / (Number(r.durationMs) / 1000)) : 0,
  }));
}

// ── Tool Flow / Trajectory Queries ───────────────────────────────────────

export interface ToolTransition {
  fromTool: string;
  toTool: string;
  count: number;
}

export interface ToolCoOccurrence {
  toolA: string;
  toolB: string;
  sessions: number;
}

export interface FailureTrajectory {
  toolName: string;
  errorMessage: string;
  previousCalls: string[];
  ts: string;
  sessionId: string;
}

export interface ToolFlowResult {
  transitions: ToolTransition[];
  coOccurrences: ToolCoOccurrence[];
  failureTrajectories: FailureTrajectory[];
}

/**
 * Analyze tool call sequences to find:
 * 1. Most common tool→tool transitions
 * 2. Tool co-occurrence within sessions
 * 3. Last N tool calls before each error
 */
export function queryToolFlow(since: string): ToolFlowResult {
  const db = getTraceDb();

  // Get all tool calls ordered by session + time
  const rows = db
    .prepare(
      `
    SELECT session_id, ts, tool_name, status, error_message
    FROM trace_tool_calls
    WHERE ts >= ?
    ORDER BY session_id, ts ASC
  `,
    )
    .all(since) as Record<string, unknown>[];
  const calls = mapRows<{ sessionId: string; ts: string; toolName: string; status: string; errorMessage: string | null }>(rows);

  // Group by session
  const sessionMap = new Map<string, typeof calls>();
  for (const call of calls) {
    const group = sessionMap.get(call.sessionId);
    if (group) {
      group.push(call);
    } else {
      sessionMap.set(call.sessionId, [call]);
    }
  }

  // 1. Transitions: count (prev_tool → next_tool) within each session
  const transitionMap = new Map<string, number>();
  for (const [, sessionCalls] of sessionMap) {
    for (let i = 0; i < sessionCalls.length - 1; i++) {
      const key = `${sessionCalls[i].toolName}→${sessionCalls[i + 1].toolName}`;
      transitionMap.set(key, (transitionMap.get(key) ?? 0) + 1);
    }
  }
  const transitions: ToolTransition[] = [];
  for (const [key, count] of transitionMap) {
    const [fromTool, toTool] = key.split('→');
    transitions.push({ fromTool, toTool, count });
  }
  transitions.sort((a, b) => b.count - a.count);

  // 2. Co-occurrence: count sessions where both tools appear
  const coocMap = new Map<string, number>();
  for (const [, sessionCalls] of sessionMap) {
    const toolsInSession = [...new Set(sessionCalls.map((c) => c.toolName))].sort();
    for (let i = 0; i < toolsInSession.length; i++) {
      for (let j = i + 1; j < toolsInSession.length; j++) {
        const key = `${toolsInSession[i]}↔${toolsInSession[j]}`;
        coocMap.set(key, (coocMap.get(key) ?? 0) + 1);
      }
    }
  }
  const coOccurrences: ToolCoOccurrence[] = [];
  for (const [key, count] of coocMap) {
    const [toolA, toolB] = key.split('↔');
    coOccurrences.push({ toolA, toolB, sessions: count });
  }
  coOccurrences.sort((a, b) => b.sessions - a.sessions);

  // 3. Failure trajectories: last 3 calls before each error
  const failureTrajectories: FailureTrajectory[] = [];
  for (const [, sessionCalls] of sessionMap) {
    for (let i = 0; i < sessionCalls.length; i++) {
      if (sessionCalls[i].status === 'error') {
        const start = Math.max(0, i - 3);
        const previousCalls = sessionCalls.slice(start, i).map((c) => c.toolName);
        failureTrajectories.push({
          toolName: sessionCalls[i].toolName,
          errorMessage: sessionCalls[i].errorMessage ?? 'Unknown error',
          previousCalls,
          ts: sessionCalls[i].ts,
          sessionId: sessionCalls[i].sessionId,
        });
      }
    }
  }
  failureTrajectories.sort((a, b) => b.ts.localeCompare(a.ts));

  return { transitions, coOccurrences, failureTrajectories };
}

export interface AutoModeEvent {
  sessionId: string;
  ts: string;
  enabled: boolean;
  stopReason: string | null;
}

export interface AutoModeSummary {
  enabledCount: number;
  disabledCount: number;
  currentActive: number;
  topStopReasons: Array<{ reason: string; count: number }>;
  recentEvents: AutoModeEvent[];
}

export function queryAutoMode(since: string): AutoModeSummary {
  const db = getTraceDb();
  const events = db
    .prepare(
      `
    SELECT session_id, ts, enabled, stop_reason
    FROM trace_auto_mode
    WHERE ts >= ?
    ORDER BY ts DESC
    LIMIT 50
  `,
    )
    .all(since) as Record<string, unknown>[];
  const mapped = mapRows<AutoModeEvent>(events);

  const enabledCount = mapped.filter((e) => e.enabled).length;
  const disabledCount = mapped.filter((e) => !e.enabled).length;

  // Get distinct sessions with their latest state to count currently active
  const latestBySession = new Map<string, AutoModeEvent>();
  for (const event of mapped) {
    if (!latestBySession.has(event.sessionId)) {
      latestBySession.set(event.sessionId, event);
    }
  }
  const currentActive = [...latestBySession.values()].filter((e) => e.enabled).length;

  // Top stop reasons
  const reasonCounts = new Map<string, number>();
  for (const event of mapped) {
    if (!event.enabled && event.stopReason) {
      reasonCounts.set(event.stopReason, (reasonCounts.get(event.stopReason) ?? 0) + 1);
    }
  }
  const topStopReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    enabledCount,
    disabledCount,
    currentActive,
    topStopReasons,
    recentEvents: mapped.slice(0, 20),
  };
}

export interface CacheEfficiencyPoint {
  ts: string;
  modelId: string;
  totalInput: number;
  cachedInput: number;
  hitRate: number;
}

export interface SystemPromptPoint {
  ts: string;
  sessionId: string;
  systemPromptTokens: number;
  totalTokens: number;
  pctOfTotal: number;
}

export function queryCacheEfficiency(since: string): CacheEfficiencyPoint[] {
  const db = getTraceDb();
  const rows = db
    .prepare(
      `
    SELECT ts, model_id, tokens_input + tokens_cached_input + tokens_cached_write as total_input, tokens_cached_input as cached_input
    FROM trace_stats WHERE ts >= ? AND model_id IS NOT NULL AND model_id != ''
    ORDER BY ts ASC LIMIT 200
  `,
    )
    .all(since) as Record<string, unknown>[];
  return mapRows<CacheEfficiencyPoint>(rows).map((r) => ({
    ts: r.ts,
    modelId: r.modelId,
    totalInput: Number(r.totalInput),
    cachedInput: Number(r.cachedInput),
    hitRate: Number(r.totalInput) > 0 ? Math.round((Number(r.cachedInput) / Number(r.totalInput)) * 10000) / 100 : 0,
  }));
}

export function querySystemPromptTrend(since: string): SystemPromptPoint[] {
  const db = getTraceDb();
  const rows = db
    .prepare(
      `
    SELECT ts, session_id, system_prompt_tokens, total_tokens
    FROM trace_context WHERE ts >= ? AND system_prompt_tokens > 0
    ORDER BY ts ASC LIMIT 200
  `,
    )
    .all(since) as Record<string, unknown>[];
  return mapRows<SystemPromptPoint>(rows).map((r) => ({
    ts: r.ts,
    sessionId: r.sessionId,
    systemPromptTokens: Number(r.systemPromptTokens),
    totalTokens: Number(r.totalTokens),
    pctOfTotal: Number(r.totalTokens) > 0 ? Math.round((Number(r.systemPromptTokens) / Number(r.totalTokens)) * 10000) / 100 : 0,
  }));
}

export function queryCacheEfficiencyAggregate(since: string): {
  overallHitRate: number;
  totalInput: number;
  totalCached: number;
  totalCachedWrite: number;
  byModel: Array<{ modelId: string; hitRate: number; totalInput: number; totalCached: number; totalCachedWrite: number }>;
} {
  const db = getTraceDb();
  const rows = db
    .prepare(
      `
    SELECT COALESCE(model_id, '') as model_id,
      SUM(tokens_input + tokens_cached_input + tokens_cached_write) as total_input,
      SUM(tokens_cached_input) as total_cached,
      SUM(tokens_cached_write) as total_cached_write
    FROM trace_stats WHERE ts >= ? AND model_id IS NOT NULL AND model_id != ''
    GROUP BY model_id ORDER BY total_input DESC
  `,
    )
    .all(since) as Record<string, unknown>[];
  const mapped = mapRows<{ modelId: string; totalInput: number; totalCached: number; totalCachedWrite: number }>(rows);
  const totals = mapped.reduce(
    (acc, r) => ({
      totalInput: acc.totalInput + Number(r.totalInput),
      totalCached: acc.totalCached + Number(r.totalCached),
      totalCachedWrite: acc.totalCachedWrite + Number(r.totalCachedWrite),
    }),
    { totalInput: 0, totalCached: 0, totalCachedWrite: 0 },
  );
  return {
    overallHitRate: totals.totalInput > 0 ? Math.round((totals.totalCached / totals.totalInput) * 10000) / 100 : 0,
    totalInput: totals.totalInput,
    totalCached: totals.totalCached,
    totalCachedWrite: totals.totalCachedWrite,
    byModel: mapped.map((r) => ({
      modelId: r.modelId,
      totalInput: Number(r.totalInput),
      totalCached: Number(r.totalCached),
      totalCachedWrite: Number(r.totalCachedWrite),
      hitRate: Number(r.totalInput) > 0 ? Math.round((Number(r.totalCached) / Number(r.totalInput)) * 10000) / 100 : 0,
    })),
  };
}

export function querySystemPromptAggregate(since: string): {
  avgSystemPromptTokens: number;
  avgPctOfTotal: number;
  maxSystemPromptTokens: number;
  samples: number;
} {
  const db = getTraceDb();
  const row = db
    .prepare(
      `
    SELECT AVG(system_prompt_tokens) as avg_tokens, AVG(CAST(system_prompt_tokens AS REAL) / CAST(total_tokens AS REAL)) * 100 as avg_pct, MAX(system_prompt_tokens) as max_tokens, COUNT(*) as samples
    FROM trace_context WHERE ts >= ? AND system_prompt_tokens > 0 AND total_tokens > 0
  `,
    )
    .get(since) as Record<string, unknown>;
  const m = mapRow<{ avgTokens: number; avgPct: number; maxTokens: number; samples: number }>(row);
  return {
    avgSystemPromptTokens: Math.round(Number(m.avgTokens)),
    avgPctOfTotal: Math.round(Number(m.avgPct) * 100) / 100,
    maxSystemPromptTokens: Number(m.maxTokens),
    samples: Number(m.samples),
  };
}
