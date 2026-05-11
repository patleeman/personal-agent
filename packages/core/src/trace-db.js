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
import { openSqliteDatabase } from './sqlite.js';
import { applyMigrations } from './sqlite-migrations.js';
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
  tool_input_json TEXT,
  bash_command TEXT,
  bash_command_label TEXT,
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

-- Suggested context pointer tracking
CREATE TABLE IF NOT EXISTS trace_suggested_context (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  pointer_ids TEXT NOT NULL DEFAULT '',
  pointer_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trace_context_pointer_inspect (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  inspected_conversation_id TEXT NOT NULL,
  was_suggested INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trace_suggested_context_ts ON trace_suggested_context(ts);
CREATE INDEX IF NOT EXISTS idx_trace_suggested_context_session ON trace_suggested_context(session_id);
CREATE INDEX IF NOT EXISTS idx_trace_context_pointer_inspect_ts ON trace_context_pointer_inspect(ts);
CREATE INDEX IF NOT EXISTS idx_trace_context_pointer_inspect_session ON trace_context_pointer_inspect(session_id);
`;
// ── Migrations ────────────────────────────────────────────────────────────────
// Versioned, sequential migrations tracked via PRAGMA user_version.
// Version 0 = pre-migration DB — all migrations run on first open.
const TRACE_MIGRATIONS = [
    {
        version: 1,
        description: 'Add duration_ms to trace_stats',
        up: (db) => addColumnIfMissing(db, 'trace_stats', 'duration_ms', `ALTER TABLE trace_stats ADD COLUMN duration_ms INTEGER DEFAULT 0`),
    },
    {
        version: 2,
        description: 'Add tokens_cached_write to trace_stats',
        up: (db) => addColumnIfMissing(db, 'trace_stats', 'tokens_cached_write', `ALTER TABLE trace_stats ADD COLUMN tokens_cached_write INTEGER DEFAULT 0`),
    },
    {
        version: 3,
        description: 'Add trace_suggested_context table and indexes',
        up: (db) => {
            db.exec(`CREATE TABLE IF NOT EXISTS trace_suggested_context (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL DEFAULT '',
        ts TEXT NOT NULL,
        pointer_ids TEXT NOT NULL DEFAULT '',
        pointer_count INTEGER NOT NULL DEFAULT 0
      )`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_suggested_context_ts ON trace_suggested_context(ts)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_suggested_context_session ON trace_suggested_context(session_id)`);
        },
    },
    {
        version: 4,
        description: 'Add trace_context_pointer_inspect table and indexes',
        up: (db) => {
            db.exec(`CREATE TABLE IF NOT EXISTS trace_context_pointer_inspect (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL DEFAULT '',
        ts TEXT NOT NULL,
        inspected_conversation_id TEXT NOT NULL,
        was_suggested INTEGER NOT NULL DEFAULT 0
      )`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_context_pointer_inspect_ts ON trace_context_pointer_inspect(ts)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_context_pointer_inspect_session ON trace_context_pointer_inspect(session_id)`);
        },
    },
    {
        version: 5,
        description: 'Add tool input metadata to trace tool calls',
        up: (db) => {
            addColumnIfMissing(db, 'trace_tool_calls', 'tool_input_json', `ALTER TABLE trace_tool_calls ADD COLUMN tool_input_json TEXT`);
            addColumnIfMissing(db, 'trace_tool_calls', 'bash_command', `ALTER TABLE trace_tool_calls ADD COLUMN bash_command TEXT`);
            addColumnIfMissing(db, 'trace_tool_calls', 'bash_command_label', `ALTER TABLE trace_tool_calls ADD COLUMN bash_command_label TEXT`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_tool_calls_bash_command_label ON trace_tool_calls(bash_command_label)`);
        },
    },
];
function addColumnIfMissing(db, table, column, sql) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    if (rows.some((row) => row.name === column))
        return;
    db.exec(sql);
}
// ── Database management ───────────────────────────────────────────────────────
const dbCache = new Map();
export function closeTraceDbs() {
    for (const db of dbCache.values()) {
        db.close();
    }
    dbCache.clear();
}
function resolveTraceDbDir(stateRoot) {
    return join(stateRoot ?? getStateRoot(), 'pi-agent', 'state', 'trace');
}
function resolveTraceDbPath(stateRoot) {
    return join(resolveTraceDbDir(stateRoot), 'trace.db');
}
// Prune rows older than this many days on each DB open
const TRACE_STATS_TTL_DAYS = 90;
function getTraceDb(stateRoot) {
    const path = resolveTraceDbPath(stateRoot);
    const cached = dbCache.get(path);
    if (cached)
        return cached;
    const dir = resolveTraceDbDir(stateRoot);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const db = openSqliteDatabase(path);
    // Enable WAL mode for concurrent read/write without contention
    db.pragma('journal_mode=WAL');
    // Apply baseline schema (all IF NOT EXISTS — safe to run on any DB)
    db.exec(SCHEMA);
    // Apply versioned migrations tracked via PRAGMA user_version
    applyMigrations(db, 'trace', TRACE_MIGRATIONS);
    // Prune stale rows on open then vacuum to reclaim space (fire-and-forget)
    try {
        const cutoff = new Date(Date.now() - TRACE_STATS_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
        db.prepare(`DELETE FROM trace_stats WHERE ts < ?`).run(cutoff);
        db.prepare(`DELETE FROM trace_context WHERE ts < ?`).run(cutoff);
        db.prepare(`DELETE FROM trace_tool_calls WHERE ts < ?`).run(cutoff);
        db.prepare(`DELETE FROM trace_compactions WHERE ts < ?`).run(cutoff);
        db.prepare(`DELETE FROM trace_auto_mode WHERE ts < ?`).run(cutoff);
        db.prepare(`DELETE FROM trace_suggested_context WHERE ts < ?`).run(cutoff);
        db.prepare(`DELETE FROM trace_context_pointer_inspect WHERE ts < ?`).run(cutoff);
        db.exec(`VACUUM`);
    }
    catch {
        // Non-fatal
    }
    dbCache.set(path, db);
    return db;
}
// ── ID generation ─────────────────────────────────────────────────────────────
function generateId() {
    return randomUUID();
}
function timestamp() {
    return new Date().toISOString();
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function truncateTraceText(value, maxLength = 4000) {
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
function stringifyToolInput(input) {
    if (input == null)
        return null;
    try {
        return truncateTraceText(JSON.stringify(input));
    }
    catch {
        return null;
    }
}
function readBashCommand(toolName, toolInput, explicitCommand) {
    if (toolName !== 'bash')
        return null;
    const command = typeof explicitCommand === 'string'
        ? explicitCommand
        : isRecord(toolInput) && typeof toolInput.command === 'string'
            ? toolInput.command
            : '';
    const trimmed = command.trim();
    return trimmed ? truncateTraceText(trimmed) : null;
}
function parseBashCommandLabel(command) {
    if (!command)
        return null;
    const segments = command
        .split(/\s*(?:&&|\|\||;|\|)\s*/)
        .map((segment) => segment.trim())
        .filter(Boolean);
    for (const rawSegment of segments) {
        let segment = rawSegment.replace(/^(?:time|command|sudo)\s+/, '').trim();
        while (/^[A-Za-z_][A-Za-z0-9_]*=.*\s/.test(segment)) {
            segment = segment.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s*/, '').trim();
        }
        if (!segment || segment.startsWith('cd ') || segment === 'cd' || segment.startsWith('export '))
            continue;
        if (/^(if|for|while|case)\b/.test(segment))
            return 'shell';
        const token = segment.match(/^([A-Za-z0-9_./:-]+)/)?.[1];
        if (!token)
            continue;
        const basename = token.split('/').filter(Boolean).at(-1) ?? token;
        return basename || 'shell';
    }
    return 'shell';
}
function countMatches(value, pattern) {
    return value.match(pattern)?.length ?? 0;
}
function countPipelines(command) {
    let count = 0;
    for (let i = 0; i < command.length; i += 1) {
        if (command[i] !== '|')
            continue;
        if (command[i - 1] === '|' || command[i + 1] === '|')
            continue;
        count += 1;
    }
    return count;
}
function analyzeBashCommandComplexity(command) {
    const text = command?.trim() ?? '';
    if (!text) {
        return {
            score: 0,
            shape: 'unknown',
            commandCount: 0,
            pipelineCount: 0,
            chainCount: 0,
            redirectCount: 0,
            lineCount: 0,
            charCount: 0,
            hasShellControl: false,
            hasSubstitution: false,
        };
    }
    const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
    const pipelineCount = countPipelines(text);
    const chainCount = countMatches(text, /&&|\|\||;/g) + Math.max(0, lineCount - 1);
    const redirectCount = countMatches(text, /(?:>>?|<<?)/g);
    const hasShellControl = /\b(?:if|then|else|fi|for|while|do|done|case|esac|function)\b/.test(text);
    const hasSubstitution = /\$\(|`/.test(text);
    const commandCount = Math.max(1, text.split(/\s*(?:&&|\|\||;|\||\r?\n)\s*/).filter(Boolean).length);
    const charCount = text.length;
    const score = Math.max(1, commandCount +
        pipelineCount * 2 +
        chainCount +
        redirectCount +
        Math.max(0, lineCount - 1) +
        (hasShellControl ? 3 : 0) +
        (hasSubstitution ? 2 : 0) +
        (charCount >= 240 ? 2 : charCount >= 120 ? 1 : 0));
    const shape = hasShellControl
        ? 'shell'
        : lineCount > 1
            ? 'multiline'
            : pipelineCount > 0
                ? 'pipeline'
                : chainCount > 0
                    ? 'chain'
                    : redirectCount > 0
                        ? 'redirect'
                        : 'single';
    return { score, shape, commandCount, pipelineCount, chainCount, redirectCount, lineCount, charCount, hasShellControl, hasSubstitution };
}
// ── SQL result mapping ───────────────────────────────────────────────────
// SQLite returns snake_case keys. Convert to camelCase for TypeScript interfaces.
function mapRow(row) {
    const result = {};
    for (const [key, value] of Object.entries(row)) {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        result[camelKey] = value;
    }
    return result;
}
function mapRows(rows) {
    return rows.map((r) => mapRow(r));
}
// ── Writers (fire-and-forget) ─────────────────────────────────────────────────
export function writeTraceStats(params) {
    try {
        const db = getTraceDb();
        const stmt = db.prepare(`
      INSERT INTO trace_stats (id, session_id, run_id, model_id, profile, ts, tokens_input, tokens_output, tokens_cached_input, tokens_cached_write, cost, turn_count, step_count, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(generateId(), params.sessionId, params.runId ?? null, params.modelId ?? null, params.profile ?? '', timestamp(), params.tokensInput, params.tokensOutput, params.tokensCachedInput ?? 0, params.tokensCachedWrite ?? 0, params.cost, params.turnCount ?? 0, params.stepCount ?? 0, params.durationMs ?? 0);
    }
    catch (err) {
        // Fire-and-forget: silently ignore write failures
    }
}
export function writeTraceToolCall(params) {
    try {
        const db = getTraceDb();
        const bashCommand = readBashCommand(params.toolName, params.toolInput, params.bashCommand);
        const stmt = db.prepare(`
      INSERT INTO trace_tool_calls (id, session_id, run_id, profile, ts, tool_name, tool_input_json, bash_command, bash_command_label, duration_ms, status, error_message, conversation_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(generateId(), params.sessionId, params.runId ?? null, params.profile ?? '', timestamp(), params.toolName, stringifyToolInput(params.toolInput), bashCommand, parseBashCommandLabel(bashCommand), params.durationMs ?? null, params.status, params.errorMessage ?? null, params.conversationTitle ?? null);
    }
    catch (err) {
        // Fire-and-forget
    }
}
export function writeTraceContext(params) {
    try {
        const db = getTraceDb();
        const stmt = db.prepare(`
      INSERT INTO trace_context (id, session_id, profile, ts, model_id, total_tokens, context_window, pct, seg_system, seg_user, seg_assistant, seg_tool, seg_summary, system_prompt_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(generateId(), params.sessionId, params.profile ?? '', timestamp(), params.modelId ?? null, params.totalTokens, params.contextWindow, params.pct, params.segSystem ?? 0, params.segUser ?? 0, params.segAssistant ?? 0, params.segTool ?? 0, params.segSummary ?? 0, params.systemPromptTokens ?? 0);
    }
    catch (err) {
        // Fire-and-forget
    }
}
export function writeTraceCompaction(params) {
    try {
        const db = getTraceDb();
        const stmt = db.prepare(`
      INSERT INTO trace_compactions (id, session_id, profile, ts, reason, tokens_before, tokens_after, tokens_saved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(generateId(), params.sessionId, params.profile ?? '', timestamp(), params.reason, params.tokensBefore, params.tokensAfter, params.tokensSaved);
    }
    catch (err) {
        // Fire-and-forget
    }
}
export function writeTraceAutoMode(params) {
    try {
        const db = getTraceDb();
        db.prepare(`INSERT INTO trace_auto_mode (id, session_id, profile, ts, enabled, stop_reason) VALUES (?, ?, ?, ?, ?, ?)`).run(generateId(), params.sessionId, params.profile ?? '', timestamp(), params.enabled ? 1 : 0, params.stopReason ?? null);
    }
    catch {
        // Fire-and-forget
    }
}
export function writeTraceSuggestedContext(params) {
    try {
        const db = getTraceDb();
        db.prepare(`INSERT INTO trace_suggested_context (id, session_id, profile, ts, pointer_ids, pointer_count) VALUES (?, ?, ?, ?, ?, ?)`).run(generateId(), params.sessionId, params.profile ?? '', timestamp(), params.pointerIds.join(','), params.pointerIds.length);
    }
    catch {
        // Fire-and-forget
    }
}
export function writeTraceContextPointerInspect(params) {
    try {
        const db = getTraceDb();
        db.prepare(`INSERT INTO trace_context_pointer_inspect (id, session_id, profile, ts, inspected_conversation_id, was_suggested) VALUES (?, ?, ?, ?, ?, ?)`).run(generateId(), params.sessionId, params.profile ?? '', timestamp(), params.inspectedConversationId, params.wasSuggested ? 1 : 0);
    }
    catch {
        // Fire-and-forget
    }
}
export function querySummary(since) {
    const db = getTraceDb();
    const rawStats = db
        .prepare(`
    SELECT
      COALESCE(SUM(tokens_input + tokens_cached_input + tokens_cached_write + tokens_output), 0) as tokens_total,
      COALESCE(SUM(tokens_input), 0) as tokens_input,
      COALESCE(SUM(tokens_output), 0) as tokens_output,
      COALESCE(SUM(tokens_cached_input), 0) as tokens_cached,
      COALESCE(SUM(tokens_cached_write), 0) as tokens_cached_write,
      COALESCE(SUM(cost), 0) as total_cost,
      COUNT(DISTINCT session_id) as sessions_active
    FROM trace_stats WHERE ts >= ?
  `)
        .get(since);
    const stats = mapRow(rawStats);
    const rawErrors = db
        .prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors
    FROM trace_tool_calls WHERE ts >= ?
  `)
        .get(since);
    const errors = mapRow(rawErrors);
    const rawCount = db.prepare(`SELECT COUNT(DISTINCT id) as cnt FROM trace_stats WHERE ts >= ?`).get(since);
    const count = mapRow(rawCount);
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
export function queryModelUsage(since) {
    const db = getTraceDb();
    const raw = db
        .prepare(`
    SELECT
      COALESCE(model_id, 'unknown') as model_id,
      SUM(tokens_input + tokens_cached_input + tokens_output) as tokens,
      SUM(cost) as cost,
      COUNT(*) as calls
    FROM trace_stats WHERE ts >= ?
    GROUP BY model_id
    ORDER BY tokens DESC
  `)
        .all(since);
    return mapRows(raw).map((r) => ({
        ...r,
        tokens: Number(r.tokens),
        cost: Math.round(Number(r.cost) * 100) / 100,
        calls: Number(r.calls),
    }));
}
export function queryCostByConversation(since) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
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
  `)
        .all(since);
    return mapRows(rows).map((r) => ({
        ...r,
        tokens: Number(r.tokens),
        cost: Math.round(Number(r.cost) * 100) / 100,
    }));
}
export function queryToolHealth(since) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT
      tool_name,
      COUNT(*) as calls,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors,
      AVG(duration_ms) as avg_latency_ms,
      MAX(duration_ms) as max_latency_ms
    FROM trace_tool_calls WHERE ts >= ?
    GROUP BY tool_name
    ORDER BY calls DESC
  `)
        .all(since);
    return mapRows(rows).map((r) => ({
        ...r,
        calls: Number(r.calls),
        errors: Number(r.errors),
        successRate: Number(r.calls) > 0 ? Math.round((1 - Number(r.errors) / Number(r.calls)) * 1000) / 10 : 100,
        avgLatencyMs: Number(r.avgLatencyMs) || 0,
        p95LatencyMs: queryToolLatencyP95(since, r.toolName),
        maxLatencyMs: Number(r.maxLatencyMs) || 0,
        bashBreakdown: r.toolName === 'bash' ? queryBashBreakdown(since) : undefined,
        bashComplexity: r.toolName === 'bash' ? queryBashComplexity(since) : undefined,
    }));
}
export function queryBashComplexity(since) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT bash_command
    FROM trace_tool_calls
    WHERE ts >= ? AND tool_name = 'bash'
  `)
        .all(since);
    const analyses = rows.map((row) => analyzeBashCommandComplexity(row.bash_command));
    const total = analyses.length;
    if (total === 0) {
        return {
            avgScore: 0,
            maxScore: 0,
            avgCommandCount: 0,
            maxCommandCount: 0,
            avgCharCount: 0,
            maxCharCount: 0,
            pipelineCalls: 0,
            chainCalls: 0,
            redirectCalls: 0,
            multilineCalls: 0,
            shellCalls: 0,
            substitutionCalls: 0,
            shapeBreakdown: [],
        };
    }
    const shapeCounts = new Map();
    let scoreTotal = 0;
    let commandCountTotal = 0;
    let charCountTotal = 0;
    let maxScore = 0;
    let maxCommandCount = 0;
    let maxCharCount = 0;
    let pipelineCalls = 0;
    let chainCalls = 0;
    let redirectCalls = 0;
    let multilineCalls = 0;
    let shellCalls = 0;
    let substitutionCalls = 0;
    for (const analysis of analyses) {
        scoreTotal += analysis.score;
        commandCountTotal += analysis.commandCount;
        charCountTotal += analysis.charCount;
        maxScore = Math.max(maxScore, analysis.score);
        maxCommandCount = Math.max(maxCommandCount, analysis.commandCount);
        maxCharCount = Math.max(maxCharCount, analysis.charCount);
        if (analysis.pipelineCount > 0)
            pipelineCalls += 1;
        if (analysis.chainCount > 0)
            chainCalls += 1;
        if (analysis.redirectCount > 0)
            redirectCalls += 1;
        if (analysis.lineCount > 1)
            multilineCalls += 1;
        if (analysis.hasShellControl)
            shellCalls += 1;
        if (analysis.hasSubstitution)
            substitutionCalls += 1;
        shapeCounts.set(analysis.shape, (shapeCounts.get(analysis.shape) ?? 0) + 1);
    }
    return {
        avgScore: Math.round((scoreTotal / total) * 10) / 10,
        maxScore,
        avgCommandCount: Math.round((commandCountTotal / total) * 10) / 10,
        maxCommandCount,
        avgCharCount: Math.round(charCountTotal / total),
        maxCharCount,
        pipelineCalls,
        chainCalls,
        redirectCalls,
        multilineCalls,
        shellCalls,
        substitutionCalls,
        shapeBreakdown: [...shapeCounts.entries()].map(([shape, calls]) => ({ shape, calls })).sort((a, b) => b.calls - a.calls),
    };
}
export function queryBashBreakdown(since) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT
      COALESCE(bash_command_label, 'unknown') as command,
      COUNT(*) as calls,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors,
      AVG(duration_ms) as avg_latency_ms,
      MAX(duration_ms) as max_latency_ms
    FROM trace_tool_calls
    WHERE ts >= ? AND tool_name = 'bash'
    GROUP BY COALESCE(bash_command_label, 'unknown')
    ORDER BY calls DESC, errors DESC
    LIMIT 8
  `)
        .all(since);
    return mapRows(rows).map((r) => ({
        ...r,
        calls: Number(r.calls),
        errors: Number(r.errors),
        errorRate: Number(r.calls) > 0 ? Math.round((Number(r.errors) / Number(r.calls)) * 1000) / 10 : 0,
        successRate: Number(r.calls) > 0 ? Math.round((1 - Number(r.errors) / Number(r.calls)) * 1000) / 10 : 100,
        avgLatencyMs: Number(r.avgLatencyMs) || 0,
        p95LatencyMs: queryBashCommandLatencyP95(since, r.command),
        maxLatencyMs: Number(r.maxLatencyMs) || 0,
    }));
}
function queryBashCommandLatencyP95(since, command) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT duration_ms
    FROM trace_tool_calls
    WHERE ts >= ? AND tool_name = 'bash' AND COALESCE(bash_command_label, 'unknown') = ? AND duration_ms IS NOT NULL
    ORDER BY duration_ms ASC
  `)
        .all(since, command);
    if (rows.length === 0)
        return 0;
    const index = Math.ceil(rows.length * 0.95) - 1;
    return Number(rows[Math.max(0, Math.min(index, rows.length - 1))].duration_ms) || 0;
}
function queryToolLatencyP95(since, toolName) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT duration_ms
    FROM trace_tool_calls
    WHERE ts >= ? AND tool_name = ? AND duration_ms IS NOT NULL
    ORDER BY duration_ms ASC
  `)
        .all(since, toolName);
    if (rows.length === 0) {
        return 0;
    }
    const index = Math.ceil(rows.length * 0.95) - 1;
    return Number(rows[Math.max(0, Math.min(index, rows.length - 1))].duration_ms) || 0;
}
export function queryContextSessions(since) {
    const db = getTraceDb();
    const rawRows = db
        .prepare(`
    SELECT * FROM trace_context
    WHERE ts >= ?
    ORDER BY ts DESC
    LIMIT 100
  `)
        .all(since);
    const mapped = mapRows(rawRows);
    // Deduplicate to latest per session
    const seen = new Set();
    return mapped.filter((r) => {
        if (seen.has(r.sessionId))
            return false;
        seen.add(r.sessionId);
        return true;
    });
}
export function queryCompactions(since) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT session_id, ts, reason, tokens_before, tokens_after, tokens_saved
    FROM trace_compactions WHERE ts >= ?
    ORDER BY ts DESC
    LIMIT 50
  `)
        .all(since);
    return mapRows(rows);
}
export function queryCompactionAggregates(since) {
    const db = getTraceDb();
    const raw = db
        .prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN reason IN ('overflow', 'threshold') THEN 1 ELSE 0 END), 0) as auto_count,
      COALESCE(SUM(CASE WHEN reason = 'manual' THEN 1 ELSE 0 END), 0) as manual_count,
      COALESCE(SUM(tokens_saved), 0) as total_saved,
      COALESCE(SUM(CASE WHEN reason = 'overflow' THEN 1 ELSE 0 END), 0) as overflow_count,
      COUNT(*) as total
    FROM trace_compactions WHERE ts >= ?
  `)
        .get(since);
    const result = mapRow(raw);
    return {
        autoCount: Number(result.autoCount),
        manualCount: Number(result.manualCount),
        totalTokensSaved: Number(result.totalSaved),
        overflowPct: result.total > 0 ? Math.round((Number(result.overflowCount) / Number(result.total)) * 100) : 0,
    };
}
export function queryAgentLoop(since) {
    const db = getTraceDb();
    const rawStats = db
        .prepare(`
    SELECT
      AVG(turn_count) as avg_turns,
      CASE WHEN COALESCE(SUM(turn_count), 0) > 0 THEN CAST(SUM(step_count) AS REAL) / CAST(SUM(turn_count) AS REAL) ELSE 0 END as avg_steps,
      COUNT(*) as total_runs,
      COALESCE(SUM(CASE WHEN turn_count > 20 THEN 1 ELSE 0 END), 0) as runs_over_20,
      AVG(duration_ms) as avg_duration_ms,
      COALESCE(SUM(CASE WHEN duration_ms > 600000 THEN 1 ELSE 0 END), 0) as stuck_runs
    FROM trace_stats WHERE ts >= ? AND ((run_id IS NOT NULL AND run_id != '') OR turn_count > 0 OR step_count > 0 OR duration_ms > 0)
  `)
        .get(since);
    const stats = mapRow(rawStats);
    const totalRuns = Number(stats.totalRuns) || 0;
    if (totalRuns === 0) {
        return null;
    }
    const rawSub = db
        .prepare(`
    SELECT COUNT(*) as subagent_calls
    FROM trace_tool_calls WHERE ts >= ? AND tool_name = 'subagent' AND run_id IS NOT NULL AND run_id != ''
  `)
        .get(since);
    const sub = mapRow(rawSub);
    return {
        turnsPerRun: stats.avgTurns ? Math.round(Number(stats.avgTurns) * 10) / 10 : 0,
        stepsPerTurn: stats.avgSteps ? Math.round(Number(stats.avgSteps) * 10) / 10 : 0,
        runsOver20Turns: Number(stats.runsOver20),
        subagentsPerRun: Math.round((Number(sub.subagentCalls) / totalRuns) * 10) / 10,
        avgDurationMs: Math.round(Number(stats.avgDurationMs) || 0),
        durationP50Ms: queryRunDurationPercentile(since, 0.5),
        durationP95Ms: queryRunDurationPercentile(since, 0.95),
        durationP99Ms: queryRunDurationPercentile(since, 0.99),
        stuckRuns: Number(stats.stuckRuns),
    };
}
function queryRunDurationPercentile(since, percentile) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT duration_ms
    FROM trace_stats
    WHERE ts >= ? AND duration_ms > 0 AND ((run_id IS NOT NULL AND run_id != '') OR turn_count > 0 OR step_count > 0)
    ORDER BY duration_ms ASC
  `)
        .all(since);
    if (rows.length === 0)
        return 0;
    const index = Math.ceil(rows.length * percentile) - 1;
    return Math.round(Number(rows[Math.max(0, Math.min(index, rows.length - 1))].duration_ms) || 0);
}
export function queryAutoMode(since) {
    const db = getTraceDb();
    const counts = mapRow(db
        .prepare(`SELECT
          COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) as enabled_count,
          COALESCE(SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END), 0) as disabled_count
        FROM trace_auto_mode
        WHERE ts >= ?`)
        .get(since));
    const currentActive = mapRow(db
        .prepare(`SELECT COUNT(*) as count
        FROM trace_auto_mode latest
        WHERE latest.ts >= ?
          AND latest.enabled = 1
          AND latest.rowid = (
            SELECT inner_event.rowid
            FROM trace_auto_mode inner_event
            WHERE inner_event.session_id = latest.session_id
            ORDER BY inner_event.ts DESC, inner_event.rowid DESC
            LIMIT 1
          )`)
        .get(since)).count;
    const topStopReasons = mapRows(db
        .prepare(`SELECT COALESCE(NULLIF(stop_reason, ''), 'unknown') as reason, COUNT(*) as count
        FROM trace_auto_mode
        WHERE ts >= ? AND enabled = 0
        GROUP BY COALESCE(NULLIF(stop_reason, ''), 'unknown')
        ORDER BY count DESC, reason ASC
        LIMIT 5`)
        .all(since)).map((row) => ({ reason: row.reason, count: Number(row.count) }));
    const recentEvents = mapRows(db
        .prepare(`SELECT session_id, ts, enabled, stop_reason
        FROM trace_auto_mode
        WHERE ts >= ?
        ORDER BY ts DESC, rowid DESC
        LIMIT 50`)
        .all(since)).map((row) => ({
        sessionId: row.sessionId,
        ts: row.ts,
        enabled: Boolean(row.enabled),
        stopReason: row.stopReason,
    }));
    return {
        enabledCount: Number(counts.enabledCount),
        disabledCount: Number(counts.disabledCount),
        currentActive: Number(currentActive),
        topStopReasons,
        recentEvents,
    };
}
export function queryTokensDaily(since) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
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
  `)
        .all(since, since);
    return mapRows(rows).map((r) => ({
        ...r,
        tokensInput: Number(r.tokensInput),
        tokensOutput: Number(r.tokensOutput),
        tokensCached: Number(r.tokensCached),
        tokensCachedWrite: Number(r.tokensCachedWrite),
        toolErrors: Number(r.toolErrors),
        cost: Number(r.cost),
    }));
}
export function queryThroughput(since) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT
      COALESCE(model_id, 'unknown') as model_id,
      SUM(tokens_output) as tokens,
      SUM(duration_ms) as duration_ms,
      MAX(CAST(tokens_output AS REAL) / (CAST(duration_ms AS REAL) / 1000.0)) as peak_tokens_per_sec
    FROM trace_stats WHERE ts >= ? AND duration_ms > 0
    GROUP BY model_id
    ORDER BY tokens DESC
  `)
        .all(since);
    const mapped = mapRows(rows);
    return mapped.map((r) => ({
        modelId: r.modelId,
        avgTokensPerSec: Number(r.durationMs) > 0 ? Math.round(Number(r.tokens) / (Number(r.durationMs) / 1000)) : 0,
        peakTokensPerSec: Math.round(Number(r.peakTokensPerSec) || 0),
        tokensOutput: Number(r.tokens),
        durationMs: Number(r.durationMs),
    }));
}
function toolFlowLabel(call) {
    if (call.toolName !== 'bash')
        return call.toolName;
    const label = call.bashCommandLabel?.trim() || parseBashCommandLabel(call.bashCommand ?? null) || 'unknown';
    if (label === 'apply_patch')
        return 'apply_patch';
    return `bash:${label}`;
}
/**
 * Analyze tool call sequences to find:
 * 1. Most common tool→tool transitions
 * 2. Tool co-occurrence within sessions
 * 3. Last N tool calls before each error
 */
export function queryToolFlow(since) {
    const db = getTraceDb();
    // Get all tool calls ordered by session + time
    const rows = db
        .prepare(`
    SELECT session_id, ts, tool_name, bash_command_label, bash_command, status, error_message
    FROM trace_tool_calls
    WHERE ts >= ?
    ORDER BY session_id, ts ASC
  `)
        .all(since);
    const calls = mapRows(rows)
        .map((call) => ({ ...call, flowToolName: toolFlowLabel(call) }))
        // Older telemetry did not persist bash input, so it cannot be broken down into useful flow labels.
        .filter((call) => call.flowToolName !== 'bash:unknown');
    // Group by session
    const sessionMap = new Map();
    for (const call of calls) {
        const group = sessionMap.get(call.sessionId);
        if (group) {
            group.push(call);
        }
        else {
            sessionMap.set(call.sessionId, [call]);
        }
    }
    // 1. Transitions: count (prev_tool → next_tool) within each session
    const transitionMap = new Map();
    for (const [, sessionCalls] of sessionMap) {
        for (let i = 0; i < sessionCalls.length - 1; i++) {
            const key = `${sessionCalls[i].flowToolName}→${sessionCalls[i + 1].flowToolName}`;
            transitionMap.set(key, (transitionMap.get(key) ?? 0) + 1);
        }
    }
    const transitions = [];
    for (const [key, count] of transitionMap) {
        const [fromTool, toTool] = key.split('→');
        transitions.push({ fromTool, toTool, count });
    }
    transitions.sort((a, b) => b.count - a.count);
    // 2. Co-occurrence: count sessions where both tools appear
    const coocMap = new Map();
    for (const [, sessionCalls] of sessionMap) {
        const toolsInSession = [...new Set(sessionCalls.map((c) => c.flowToolName))].sort();
        for (let i = 0; i < toolsInSession.length; i++) {
            for (let j = i + 1; j < toolsInSession.length; j++) {
                const key = `${toolsInSession[i]}↔${toolsInSession[j]}`;
                coocMap.set(key, (coocMap.get(key) ?? 0) + 1);
            }
        }
    }
    const coOccurrences = [];
    for (const [key, count] of coocMap) {
        const [toolA, toolB] = key.split('↔');
        coOccurrences.push({ toolA, toolB, sessions: count });
    }
    coOccurrences.sort((a, b) => b.sessions - a.sessions);
    // 3. Failure trajectories: last 3 calls before each error
    const failureTrajectories = [];
    for (const [, sessionCalls] of sessionMap) {
        for (let i = 0; i < sessionCalls.length; i++) {
            if (sessionCalls[i].status === 'error') {
                const start = Math.max(0, i - 3);
                const previousCalls = sessionCalls.slice(start, i).map((c) => c.flowToolName);
                failureTrajectories.push({
                    toolName: sessionCalls[i].flowToolName,
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
export function queryCacheEfficiency(since) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT ts, model_id, tokens_input + tokens_cached_input + tokens_cached_write as total_input, tokens_cached_input as cached_input
    FROM trace_stats WHERE ts >= ? AND model_id IS NOT NULL AND model_id != ''
    ORDER BY ts ASC LIMIT 200
  `)
        .all(since);
    return mapRows(rows).map((r) => ({
        ts: r.ts,
        modelId: r.modelId,
        totalInput: Number(r.totalInput),
        cachedInput: Number(r.cachedInput),
        hitRate: Number(r.totalInput) > 0 ? Math.round((Number(r.cachedInput) / Number(r.totalInput)) * 10000) / 100 : 0,
    }));
}
export function querySystemPromptTrend(since) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT ts, session_id, COALESCE(model_id, '') as model_id, system_prompt_tokens, total_tokens, context_window
    FROM trace_context WHERE ts >= ? AND system_prompt_tokens > 0
    ORDER BY ts ASC LIMIT 200
  `)
        .all(since);
    return mapRows(rows).map((r) => ({
        ts: r.ts,
        sessionId: r.sessionId,
        modelId: r.modelId,
        systemPromptTokens: Number(r.systemPromptTokens),
        totalTokens: Number(r.totalTokens),
        contextWindow: Number(r.contextWindow),
        pctOfTotal: Number(r.totalTokens) > 0 ? Math.round((Number(r.systemPromptTokens) / Number(r.totalTokens)) * 10000) / 100 : 0,
        pctOfContextWindow: Number(r.contextWindow) > 0 ? Math.round((Number(r.systemPromptTokens) / Number(r.contextWindow)) * 10000) / 100 : 0,
    }));
}
export function queryCacheEfficiencyAggregate(since) {
    const db = getTraceDb();
    const rows = db
        .prepare(`
    SELECT COALESCE(model_id, '') as model_id,
      SUM(tokens_input + tokens_cached_input + tokens_cached_write) as total_input,
      SUM(tokens_cached_input) as total_cached,
      SUM(tokens_cached_write) as total_cached_write,
      COUNT(*) as requests,
      SUM(CASE WHEN tokens_cached_input > 0 THEN 1 ELSE 0 END) as cached_requests
    FROM trace_stats WHERE ts >= ? AND model_id IS NOT NULL AND model_id != ''
    GROUP BY model_id ORDER BY total_input DESC
  `)
        .all(since);
    const mapped = mapRows(rows);
    const totals = mapped.reduce((acc, r) => ({
        totalInput: acc.totalInput + Number(r.totalInput),
        totalCached: acc.totalCached + Number(r.totalCached),
        totalCachedWrite: acc.totalCachedWrite + Number(r.totalCachedWrite),
        requests: acc.requests + Number(r.requests),
        cachedRequests: acc.cachedRequests + Number(r.cachedRequests),
    }), { totalInput: 0, totalCached: 0, totalCachedWrite: 0, requests: 0, cachedRequests: 0 });
    return {
        overallHitRate: totals.totalInput > 0 ? Math.round((totals.totalCached / totals.totalInput) * 10000) / 100 : 0,
        requestCacheHitRate: totals.requests > 0 ? Math.round((totals.cachedRequests / totals.requests) * 10000) / 100 : 0,
        totalInput: totals.totalInput,
        totalCached: totals.totalCached,
        totalCachedWrite: totals.totalCachedWrite,
        requests: totals.requests,
        cachedRequests: totals.cachedRequests,
        byModel: mapped.map((r) => ({
            modelId: r.modelId,
            totalInput: Number(r.totalInput),
            totalCached: Number(r.totalCached),
            totalCachedWrite: Number(r.totalCachedWrite),
            requests: Number(r.requests),
            cachedRequests: Number(r.cachedRequests),
            hitRate: Number(r.totalInput) > 0 ? Math.round((Number(r.totalCached) / Number(r.totalInput)) * 10000) / 100 : 0,
            requestCacheHitRate: Number(r.requests) > 0 ? Math.round((Number(r.cachedRequests) / Number(r.requests)) * 10000) / 100 : 0,
        })),
    };
}
export function querySystemPromptAggregate(since) {
    const db = getTraceDb();
    const row = db
        .prepare(`
    WITH session_prompts AS (
      SELECT session_id,
        COALESCE(model_id, '') as model_id,
        MAX(system_prompt_tokens) as system_prompt_tokens,
        MAX(total_tokens) as total_tokens,
        MAX(context_window) as context_window
      FROM trace_context
      WHERE ts >= ? AND system_prompt_tokens > 0 AND total_tokens > 0
      GROUP BY session_id, model_id
    )
    SELECT AVG(system_prompt_tokens) as avg_tokens,
      AVG(CAST(system_prompt_tokens AS REAL) / CAST(total_tokens AS REAL)) * 100 as avg_pct,
      AVG(CASE WHEN context_window > 0 THEN CAST(system_prompt_tokens AS REAL) / CAST(context_window AS REAL) END) * 100 as avg_pct_context_window,
      MAX(system_prompt_tokens) as max_tokens,
      COUNT(*) as samples
    FROM session_prompts
  `)
        .get(since);
    const m = mapRow(row);
    const byModelRows = db
        .prepare(`
    WITH session_prompts AS (
      SELECT session_id,
        COALESCE(model_id, '') as model_id,
        MAX(system_prompt_tokens) as system_prompt_tokens,
        MAX(context_window) as context_window
      FROM trace_context
      WHERE ts >= ? AND system_prompt_tokens > 0 AND context_window > 0 AND model_id IS NOT NULL AND model_id != ''
      GROUP BY session_id, model_id
    )
    SELECT COALESCE(model_id, '') as model_id,
      AVG(system_prompt_tokens) as avg_tokens,
      MAX(system_prompt_tokens) as max_tokens,
      MAX(context_window) as context_window,
      AVG(CAST(system_prompt_tokens AS REAL) / CAST(context_window AS REAL)) * 100 as avg_pct_context_window,
      COUNT(*) as samples
    FROM session_prompts
    GROUP BY model_id
    ORDER BY avg_tokens DESC
  `)
        .all(since);
    const byModel = mapRows(byModelRows).map((r) => ({
        modelId: r.modelId,
        avgSystemPromptTokens: Math.round(Number(r.avgTokens)),
        maxSystemPromptTokens: Number(r.maxTokens),
        contextWindow: Number(r.contextWindow),
        avgPctOfContextWindow: Math.round(Number(r.avgPctContextWindow) * 100) / 100,
        samples: Number(r.samples),
    }));
    return {
        avgSystemPromptTokens: Math.round(Number(m.avgTokens)),
        avgPctOfTotal: Math.round(Number(m.avgPct) * 100) / 100,
        avgPctOfContextWindow: Math.round(Number(m.avgPctContextWindow) * 100) / 100,
        maxSystemPromptTokens: Number(m.maxTokens),
        samples: Number(m.samples),
        byModel,
    };
}
/**
 * Return the set of conversation IDs that were suggested to a session.
 * Used to determine `was_suggested` on inspect calls without relying on
 * in-memory state that resets on server restart.
 */
export function querySessionSuggestedPointerIds(sessionId) {
    try {
        const db = getTraceDb();
        const rows = db
            .prepare(`SELECT pointer_ids FROM trace_suggested_context WHERE session_id = ? AND pointer_ids != ''`)
            .all(sessionId);
        const ids = new Set();
        for (const row of rows) {
            for (const id of row.pointer_ids.split(',')) {
                const trimmed = id.trim();
                if (trimmed)
                    ids.add(trimmed);
            }
        }
        return ids;
    }
    catch {
        return new Set();
    }
}
export function queryContextPointerUsage(since) {
    const db = getTraceDb();
    // Summary across the range
    const rawSuggested = db
        .prepare(`
    SELECT COUNT(*) as total, COUNT(DISTINCT session_id) as sessions, AVG(pointer_count) as avg_count
    FROM trace_suggested_context WHERE ts >= ?
  `)
        .get(since);
    const suggested = mapRow(rawSuggested);
    const rawInspects = db
        .prepare(`
    SELECT
      COUNT(*) as total_any,
      COALESCE(SUM(was_suggested), 0) as total_suggested,
      COUNT(DISTINCT CASE WHEN was_suggested = 1 THEN session_id END) as sessions_inspected
    FROM trace_context_pointer_inspect WHERE ts >= ?
  `)
        .get(since);
    const inspects = mapRow(rawInspects);
    const sessionsWithSuggested = Number(suggested.sessions);
    const sessionsWithInspect = Number(inspects.sessionsInspected);
    const usageRate = sessionsWithSuggested > 0 ? Math.round((sessionsWithInspect / sessionsWithSuggested) * 1000) / 10 : 0;
    // Daily breakdown
    const rawSuggestedDaily = db
        .prepare(`
    SELECT DATE(ts) as date, COUNT(*) as cnt
    FROM trace_suggested_context WHERE ts >= ?
    GROUP BY DATE(ts) ORDER BY date ASC
  `)
        .all(since);
    const rawInspectDaily = db
        .prepare(`
    SELECT DATE(ts) as date, COALESCE(SUM(was_suggested), 0) as cnt
    FROM trace_context_pointer_inspect WHERE ts >= ?
    GROUP BY DATE(ts) ORDER BY date ASC
  `)
        .all(since);
    const suggestedByDate = new Map();
    for (const row of rawSuggestedDaily) {
        const r = mapRow(row);
        suggestedByDate.set(r.date, Number(r.cnt));
    }
    const inspectByDate = new Map();
    for (const row of rawInspectDaily) {
        const r = mapRow(row);
        inspectByDate.set(r.date, Number(r.cnt));
    }
    const allDates = new Set([...suggestedByDate.keys(), ...inspectByDate.keys()]);
    const daily = [...allDates].sort().map((date) => ({
        date,
        suggested: suggestedByDate.get(date) ?? 0,
        inspected: inspectByDate.get(date) ?? 0,
    }));
    return {
        summary: {
            totalInspects: Number(inspects.totalSuggested),
            sessionsWithInspect,
            totalSuggested: Number(suggested.total),
            sessionsWithSuggested,
            usageRate,
            totalAnyInspects: Number(inspects.totalAny),
            avgPointersPerTurn: Number(suggested.avgCount) ? Math.round(Number(suggested.avgCount) * 10) / 10 : 0,
        },
        daily,
    };
}
