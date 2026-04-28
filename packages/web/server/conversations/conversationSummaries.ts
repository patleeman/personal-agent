import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { completeSimple, type Api, type Model } from '@mariozechner/pi-ai';
import { AuthStorage } from '@mariozechner/pi-coding-agent';
import { getPiAgentRuntimeDir, openSqliteDatabase, type SqliteDatabase } from '@personal-agent/core';
import { createRuntimeModelRegistry } from '../models/modelRegistry.js';
import { logWarn } from '../shared/logging.js';
import { readConversationAutoTitleSettings } from './conversationAutoTitle.js';
import { readSessionSearchText, type SessionMeta } from './sessions.js';

const SUMMARY_SCHEMA_VERSION = 2;
const MAX_BACKFILL_PER_CALL = 8;
const MAX_SOURCE_CHARACTERS = 18_000;
const MAX_ACTIVE_JOBS = 1;
const SUMMARY_ATTEMPT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_BACKFILL_INITIAL_DELAY_MS = 5_000;
const DEFAULT_BACKFILL_INTERVAL_MS = 60_000;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export type ConversationSummaryStatus = 'done' | 'blocked' | 'in_progress' | 'needs_user' | 'unknown';

export interface ConversationSummaryRecord {
  sessionId: string;
  fingerprint: string;
  title: string;
  cwd: string;
  displaySummary: string;
  outcome: string;
  status: ConversationSummaryStatus;
  promptSummary: string;
  searchText: string;
  keyTerms: string[];
  filesTouched: string[];
  updatedAt: string;
}

interface StoredConversationSummaryRow {
  session_id: string;
  fingerprint: string;
  title: string;
  cwd: string;
  display_summary: string;
  outcome: string;
  status: string;
  prompt_summary: string;
  search_text: string;
  key_terms_json: string;
  files_touched_json: string;
  updated_at: string;
}

interface StoredConversationSummaryAttemptRow {
  session_id: string;
  fingerprint: string;
  attempted_at: string;
  error: string;
}

let db: SqliteDatabase | null = null;
const queuedSessionIds = new Set<string>();
const activeSessionIds = new Set<string>();
const pendingQueue: SessionMeta[] = [];
let activeJobs = 0;
let backfillLoopStarted = false;

function getDb(): SqliteDatabase {
  if (db) {
    return db;
  }

  const dbFile = resolveSummaryDbFile();
  mkdirSync(dirname(dbFile), { recursive: true });
  db = openSqliteDatabase(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      session_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      title TEXT NOT NULL,
      cwd TEXT NOT NULL,
      display_summary TEXT NOT NULL,
      outcome TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt_summary TEXT NOT NULL,
      search_text TEXT NOT NULL,
      key_terms_json TEXT NOT NULL,
      files_touched_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversation_summaries_updated_at_idx ON conversation_summaries(updated_at);
    CREATE TABLE IF NOT EXISTS conversation_summary_attempts (
      session_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      error TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversation_summary_attempts_attempted_at_idx ON conversation_summary_attempts(attempted_at);
    PRAGMA user_version = ${SUMMARY_SCHEMA_VERSION};
  `);
  return db;
}

function resolveAgentDir(): string {
  return getPiAgentRuntimeDir();
}

function resolveSettingsFile(): string {
  return join(resolveAgentDir(), 'settings.json');
}

function resolveSummaryDbFile(): string {
  return join(resolveAgentDir(), 'conversation-context.db');
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of value) {
    const text = normalizeString(candidate);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized;
}

function normalizeStatus(value: unknown): ConversationSummaryStatus {
  switch (value) {
    case 'done':
    case 'blocked':
    case 'in_progress':
    case 'needs_user':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
}

function readJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeStringArray(parsed, 24);
  } catch {
    return [];
  }
}

function rowToRecord(row: StoredConversationSummaryRow): ConversationSummaryRecord {
  return {
    sessionId: row.session_id,
    fingerprint: row.fingerprint,
    title: row.title,
    cwd: row.cwd,
    displaySummary: row.display_summary,
    outcome: row.outcome,
    status: normalizeStatus(row.status),
    promptSummary: row.prompt_summary,
    searchText: row.search_text,
    keyTerms: readJsonArray(row.key_terms_json),
    filesTouched: readJsonArray(row.files_touched_json),
    updatedAt: row.updated_at,
  };
}

export function buildConversationSummaryFingerprint(meta: Pick<SessionMeta, 'file' | 'messageCount' | 'lastActivityAt' | 'timestamp'>): string | null {
  if (!meta.file || !existsSync(meta.file)) {
    return null;
  }

  try {
    const stats = statSync(meta.file);
    return [stats.size, Math.round(stats.mtimeMs), meta.messageCount, meta.lastActivityAt ?? meta.timestamp].join(':');
  } catch {
    return null;
  }
}

export function readConversationSummary(sessionId: string): ConversationSummaryRecord | null {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }

  const row = getDb().prepare('SELECT * FROM conversation_summaries WHERE session_id = ?').get(normalizedSessionId) as StoredConversationSummaryRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function readConversationSummaries(sessionIds: string[]): Record<string, ConversationSummaryRecord> {
  const summaries: Record<string, ConversationSummaryRecord> = {};
  for (const sessionId of sessionIds) {
    const summary = readConversationSummary(sessionId);
    if (summary) {
      summaries[sessionId] = summary;
    }
  }
  return summaries;
}

function saveConversationSummary(record: ConversationSummaryRecord): void {
  getDb().prepare(`
    INSERT INTO conversation_summaries (
      session_id,
      fingerprint,
      title,
      cwd,
      display_summary,
      outcome,
      status,
      prompt_summary,
      search_text,
      key_terms_json,
      files_touched_json,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      fingerprint = excluded.fingerprint,
      title = excluded.title,
      cwd = excluded.cwd,
      display_summary = excluded.display_summary,
      outcome = excluded.outcome,
      status = excluded.status,
      prompt_summary = excluded.prompt_summary,
      search_text = excluded.search_text,
      key_terms_json = excluded.key_terms_json,
      files_touched_json = excluded.files_touched_json,
      updated_at = excluded.updated_at
  `).run(
    record.sessionId,
    record.fingerprint,
    record.title,
    record.cwd,
    record.displaySummary,
    record.outcome,
    record.status,
    record.promptSummary,
    record.searchText,
    JSON.stringify(record.keyTerms),
    JSON.stringify(record.filesTouched),
    record.updatedAt,
  );
}

function isSummaryFresh(meta: SessionMeta): boolean {
  const fingerprint = buildConversationSummaryFingerprint(meta);
  if (!fingerprint) {
    return true;
  }

  return readConversationSummary(meta.id)?.fingerprint === fingerprint;
}

function readSummaryAttempt(sessionId: string): StoredConversationSummaryAttemptRow | null {
  const row = getDb().prepare('SELECT * FROM conversation_summary_attempts WHERE session_id = ?').get(sessionId) as StoredConversationSummaryAttemptRow | undefined;
  return row ?? null;
}

function recordSummaryAttempt(sessionId: string, fingerprint: string, error = ''): void {
  getDb().prepare(`
    INSERT INTO conversation_summary_attempts (session_id, fingerprint, attempted_at, error)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      fingerprint = excluded.fingerprint,
      attempted_at = excluded.attempted_at,
      error = excluded.error
  `).run(sessionId, fingerprint, new Date().toISOString(), error.slice(0, 1_000));
}

function clearSummaryAttempt(sessionId: string): void {
  getDb().prepare('DELETE FROM conversation_summary_attempts WHERE session_id = ?').run(sessionId);
}

export function parseConversationSummaryAttemptTimestamp(value: string): number {
  const normalized = value.trim();
  if (!ISO_TIMESTAMP_PATTERN.test(normalized)) {
    return Number.NaN;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === normalized ? parsed : Number.NaN;
}

function isSummaryAttemptCoolingDown(meta: SessionMeta, nowMs = Date.now()): boolean {
  const fingerprint = buildConversationSummaryFingerprint(meta);
  if (!fingerprint) {
    return true;
  }

  const attempt = readSummaryAttempt(meta.id);
  if (!attempt || attempt.fingerprint !== fingerprint) {
    return false;
  }

  const attemptedAtMs = parseConversationSummaryAttemptTimestamp(attempt.attempted_at);
  return Number.isFinite(attemptedAtMs) && nowMs - attemptedAtMs < SUMMARY_ATTEMPT_COOLDOWN_MS;
}

function resolveSummaryModel(models: Model<Api>[]): Model<Api> | null {
  const settings = readConversationAutoTitleSettings(resolveSettingsFile());
  return models.find((model) => model.provider === settings.provider && model.id === settings.model)
    ?? models.find((model) => model.provider === 'openai-codex' && model.id === 'gpt-5.4-mini')
    ?? models[0]
    ?? null;
}

function extractAssistantText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((block): block is { type: string; text?: string } => Boolean(block) && typeof block === 'object' && (block as { type?: unknown }).type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function buildFallbackRecord(meta: SessionMeta, fingerprint: string, sourceText: string): ConversationSummaryRecord {
  const firstLine = sourceText.split('\n').map((line) => line.trim()).find(Boolean) ?? meta.title;
  const displaySummary = firstLine.length > 180 ? `${firstLine.slice(0, 177).trimEnd()}…` : firstLine;
  return {
    sessionId: meta.id,
    fingerprint,
    title: meta.title,
    cwd: meta.cwd,
    displaySummary,
    outcome: 'No generated outcome available.',
    status: 'unknown',
    promptSummary: displaySummary,
    searchText: [meta.title, meta.cwd, displaySummary, sourceText.slice(0, 2_000)].join('\n'),
    keyTerms: [],
    filesTouched: [],
    updatedAt: new Date().toISOString(),
  };
}

function buildRecordFromModel(meta: SessionMeta, fingerprint: string, sourceText: string, rawText: string): ConversationSummaryRecord {
  const parsed = extractJsonObject(rawText);
  if (!parsed) {
    return buildFallbackRecord(meta, fingerprint, sourceText);
  }

  const displaySummary = normalizeString(parsed.displaySummary, meta.title).slice(0, 220);
  const outcome = normalizeString(parsed.outcome, displaySummary).slice(0, 260);
  const promptSummary = normalizeString(parsed.promptSummary, `${displaySummary}\n${outcome}`).slice(0, 2_500);
  const keyTerms = normalizeStringArray(parsed.keyTerms, 12);
  const filesTouched = normalizeStringArray(parsed.filesTouched, 12);
  const status = normalizeStatus(parsed.status);
  const searchText = [
    meta.title,
    meta.cwd,
    displaySummary,
    outcome,
    promptSummary,
    keyTerms.join(' '),
    filesTouched.join(' '),
  ].filter(Boolean).join('\n');

  return {
    sessionId: meta.id,
    fingerprint,
    title: meta.title,
    cwd: meta.cwd,
    displaySummary,
    outcome,
    status,
    promptSummary,
    searchText,
    keyTerms,
    filesTouched,
    updatedAt: new Date().toISOString(),
  };
}

async function generateConversationSummary(meta: SessionMeta): Promise<ConversationSummaryRecord | null> {
  const fingerprint = buildConversationSummaryFingerprint(meta);
  if (!fingerprint) {
    return null;
  }

  const sourceText = readSessionSearchText(meta.id, MAX_SOURCE_CHARACTERS) ?? '';
  if (!sourceText.trim()) {
    return buildFallbackRecord(meta, fingerprint, meta.title);
  }

  const auth = AuthStorage.create(join(resolveAgentDir(), 'auth.json'));
  const modelRegistry = createRuntimeModelRegistry(auth);
  const model = resolveSummaryModel(modelRegistry.getAvailable());
  if (!model) {
    return buildFallbackRecord(meta, fingerprint, sourceText);
  }

  const authResult = await modelRegistry.getApiKeyAndHeaders(model);
  if (!authResult.ok) {
    return buildFallbackRecord(meta, fingerprint, sourceText);
  }

  const response = await completeSimple(
    model,
    {
      systemPrompt: [
        'You summarize old Personal Agent conversations for future context recovery.',
        'Return only strict JSON. No markdown. No commentary.',
        'Optimize for ranking, human scanning, and concise prompt injection.',
      ].join('\n'),
      messages: [{
        role: 'user',
        timestamp: Date.now(),
        content: [{
          type: 'text',
          text: [
            'Summarize this conversation into this JSON shape:',
            '{',
            '  "displaySummary": "one short row subtitle, <= 160 chars",',
            '  "outcome": "last meaningful outcome or current state, <= 220 chars",',
            '  "status": "done | blocked | in_progress | needs_user | unknown",',
            '  "promptSummary": "concise reusable context for a future agent, <= 1200 chars",',
            '  "keyTerms": ["searchable terms, features, concepts"],',
            '  "filesTouched": ["repo-relative or absolute file paths mentioned as changed or central"]',
            '}',
            '',
            `Conversation title: ${meta.title}`,
            `Workspace: ${meta.cwd}`,
            '',
            'Transcript/search text:',
            sourceText,
          ].join('\n'),
        }],
      }],
    },
    {
      apiKey: authResult.apiKey,
      headers: authResult.headers,
      reasoning: readConversationAutoTitleSettings(resolveSettingsFile()).reasoning,
      maxTokens: 700,
      cacheRetention: 'none',
    },
  );

  return buildRecordFromModel(meta, fingerprint, sourceText, extractAssistantText(response.content));
}

async function runSummaryJob(meta: SessionMeta): Promise<void> {
  if (isSummaryFresh(meta) || isSummaryAttemptCoolingDown(meta)) {
    return;
  }

  const fingerprint = buildConversationSummaryFingerprint(meta);
  if (!fingerprint) {
    return;
  }

  recordSummaryAttempt(meta.id, fingerprint);

  try {
    const record = await generateConversationSummary(meta);
    if (record) {
      saveConversationSummary(record);
      clearSummaryAttempt(meta.id);
    }
  } catch (error) {
    recordSummaryAttempt(meta.id, fingerprint, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function drainQueue(): void {
  while (activeJobs < MAX_ACTIVE_JOBS && pendingQueue.length > 0) {
    const meta = pendingQueue.shift() as SessionMeta;
    queuedSessionIds.delete(meta.id);
    if (activeSessionIds.has(meta.id)) {
      continue;
    }

    activeJobs += 1;
    activeSessionIds.add(meta.id);
    void runSummaryJob(meta)
      .catch((error) => {
        logWarn('conversation summary generation failed', {
          sessionId: meta.id,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        activeJobs -= 1;
        activeSessionIds.delete(meta.id);
        drainQueue();
      });
  }
}

export function queueConversationSummaryRefresh(meta: SessionMeta): void {
  if (!meta.id || meta.messageCount <= 0 || !meta.file || activeSessionIds.has(meta.id) || queuedSessionIds.has(meta.id)) {
    return;
  }
  if (isSummaryFresh(meta)) {
    return;
  }
  if (isSummaryAttemptCoolingDown(meta)) {
    return;
  }

  queuedSessionIds.add(meta.id);
  pendingQueue.push(meta);
  drainQueue();
}

function isClosedSession(session: SessionMeta): boolean {
  return session.isLive !== true && session.isRunning !== true && session.messageCount > 0;
}

export function queueConversationSummaryBackfill(sessions: SessionMeta[], limit = MAX_BACKFILL_PER_CALL): void {
  let queued = 0;
  for (const session of sessions) {
    if (!isClosedSession(session)) {
      continue;
    }
    if (isSummaryFresh(session)) {
      continue;
    }
    if (isSummaryAttemptCoolingDown(session)) {
      continue;
    }
    queueConversationSummaryRefresh(session);
    queued += 1;
    if (queued >= limit) {
      break;
    }
  }
}

export function startConversationSummaryBackfillLoop(input: {
  listSessions: () => SessionMeta[];
  initialDelayMs?: number;
  intervalMs?: number;
  limit?: number;
}): void {
  if (backfillLoopStarted) {
    return;
  }
  backfillLoopStarted = true;

  const runBackfillTick = () => {
    try {
      queueConversationSummaryBackfill(input.listSessions(), input.limit ?? MAX_BACKFILL_PER_CALL);
    } catch (error) {
      logWarn('conversation summary backfill tick failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const initialDelay = Math.max(0, input.initialDelayMs ?? DEFAULT_BACKFILL_INITIAL_DELAY_MS);
  const intervalMs = Math.max(5_000, input.intervalMs ?? DEFAULT_BACKFILL_INTERVAL_MS);
  const initialTimer = setTimeout(runBackfillTick, initialDelay);
  initialTimer.unref?.();
  const interval = setInterval(runBackfillTick, intervalMs);
  interval.unref?.();
}

export function readConversationSummaryIndexCapability(input: { sessionIds?: unknown } = {}) {
  const rawSessionIds = Array.isArray(input.sessionIds) ? input.sessionIds : [];
  const sessionIds = rawSessionIds
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return { summaries: readConversationSummaries([...new Set(sessionIds)]) };
}
