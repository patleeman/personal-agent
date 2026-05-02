import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { getPiAgentRuntimeDir, openSqliteDatabase, type SqliteDatabase } from '@personal-agent/core';

import { readConversationSummary } from './conversationSummaries.js';
import { listSessions, readSessionSearchText, type SessionMeta } from './sessions.js';

const SEARCH_INDEX_SCHEMA_VERSION = 1;
const DEFAULT_MAX_INDEX_BATCH = 12;
const DEFAULT_MAX_INDEX_DURATION_MS = 200;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface ConversationSearchIndexRow {
  session_id: string;
  file_signature: string;
  title: string;
  cwd: string;
  timestamp: string;
  last_activity_at: string;
  updated_at: string;
}

export interface IndexedConversationSearchCandidate {
  sessionId: string;
  title: string;
  cwd: string;
  timestamp: string;
  lastActivityAt?: string;
  searchText: string;
}

let db: SqliteDatabase | null = null;
let indexingScheduled = false;
let indexingActive = false;

function resolveSearchDbFile(): string {
  return join(getPiAgentRuntimeDir(), 'conversation-context.db');
}

function getDb(): SqliteDatabase {
  if (db) {
    return db;
  }

  const dbFile = resolveSearchDbFile();
  mkdirSync(dirname(dbFile), { recursive: true });
  db = openSqliteDatabase(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_search_index (
      session_id TEXT PRIMARY KEY,
      file_signature TEXT NOT NULL,
      title TEXT NOT NULL,
      cwd TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversation_search_index_activity_idx ON conversation_search_index(last_activity_at);
    CREATE INDEX IF NOT EXISTS conversation_search_index_cwd_idx ON conversation_search_index(cwd);
    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search_index_fts USING fts5(
      session_id UNINDEXED,
      title,
      search_text,
      tokenize = 'unicode61'
    );
    PRAGMA user_version = ${SEARCH_INDEX_SCHEMA_VERSION};
  `);
  return db;
}

function fileSignature(filePath: string): string | null {
  try {
    const stats = statSync(filePath);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}

function parseTimestamp(value: string | undefined): number {
  if (!value || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return Number.NaN;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : Number.NaN;
}

function normalizeActivityAt(meta: SessionMeta): string {
  return meta.lastActivityAt && ISO_TIMESTAMP_PATTERN.test(meta.lastActivityAt) ? meta.lastActivityAt : meta.timestamp;
}

function readIndexedRow(sessionId: string): ConversationSearchIndexRow | null {
  const row = getDb()
    .prepare(
      `
    SELECT session_id, file_signature, title, cwd, timestamp, last_activity_at, updated_at
    FROM conversation_search_index
    WHERE session_id = ?
  `,
    )
    .get(sessionId) as ConversationSearchIndexRow | undefined;
  return row ?? null;
}

function buildSearchText(meta: SessionMeta): string {
  const summary = readConversationSummary(meta.id);
  const transcriptText = readSessionSearchText(meta.id, 12_000) ?? '';
  return [
    meta.title,
    summary?.displaySummary,
    summary?.outcome,
    summary?.promptSummary,
    summary?.searchText,
    summary?.keyTerms.join(' '),
    summary?.filesTouched.join(' '),
    transcriptText,
  ]
    .filter(Boolean)
    .join('\n');
}

function upsertSearchDocument(meta: SessionMeta, signature: string, searchText: string): void {
  const database = getDb();
  const lastActivityAt = normalizeActivityAt(meta);
  const updatedAt = new Date().toISOString();
  const write = database.transaction(() => {
    database
      .prepare(
        `
      INSERT INTO conversation_search_index (session_id, file_signature, title, cwd, timestamp, last_activity_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        file_signature = excluded.file_signature,
        title = excluded.title,
        cwd = excluded.cwd,
        timestamp = excluded.timestamp,
        last_activity_at = excluded.last_activity_at,
        updated_at = excluded.updated_at
    `,
      )
      .run(meta.id, signature, meta.title, meta.cwd, meta.timestamp, lastActivityAt, updatedAt);
    database.prepare('DELETE FROM conversation_search_index_fts WHERE session_id = ?').run(meta.id);
    database
      .prepare('INSERT INTO conversation_search_index_fts (session_id, title, search_text) VALUES (?, ?, ?)')
      .run(meta.id, meta.title, searchText);
  });
  write();
}

function needsIndex(meta: SessionMeta): boolean {
  const signature = fileSignature(meta.file);
  if (!signature) {
    return false;
  }

  const row = readIndexedRow(meta.id);
  return (
    !row ||
    row.file_signature !== signature ||
    row.title !== meta.title ||
    row.cwd !== meta.cwd ||
    row.last_activity_at !== normalizeActivityAt(meta)
  );
}

export function indexConversationSearchBatch(options: { maxSessions?: number; maxDurationMs?: number } = {}): {
  indexed: number;
  remaining: number;
} {
  const maxSessions =
    Number.isSafeInteger(options.maxSessions) && options.maxSessions !== undefined && options.maxSessions > 0
      ? options.maxSessions
      : DEFAULT_MAX_INDEX_BATCH;
  const maxDurationMs =
    Number.isSafeInteger(options.maxDurationMs) && options.maxDurationMs !== undefined && options.maxDurationMs > 0
      ? options.maxDurationMs
      : DEFAULT_MAX_INDEX_DURATION_MS;
  const started = Date.now();
  let indexed = 0;
  let remaining = 0;

  for (const meta of listSessions()) {
    if (meta.messageCount <= 0 || !existsSync(meta.file)) {
      continue;
    }

    if (!needsIndex(meta)) {
      continue;
    }

    if (indexed >= maxSessions || Date.now() - started >= maxDurationMs) {
      remaining += 1;
      continue;
    }

    const signature = fileSignature(meta.file);
    if (!signature) {
      continue;
    }

    upsertSearchDocument(meta, signature, buildSearchText(meta));
    indexed += 1;
  }

  return { indexed, remaining };
}

export function scheduleConversationSearchIndexing(): void {
  if (indexingScheduled || indexingActive) {
    return;
  }

  indexingScheduled = true;
  setTimeout(() => {
    indexingScheduled = false;
    indexingActive = true;
    try {
      const result = indexConversationSearchBatch();
      if (result.remaining > 0) {
        scheduleConversationSearchIndexing();
      }
    } finally {
      indexingActive = false;
    }
  }, 0).unref?.();
}

function buildFtsQuery(terms: string[]): string | null {
  const safeTerms = terms
    .map((term) => term.toLowerCase().replace(/[^a-z0-9_]/g, ''))
    .filter((term) => term.length >= 3)
    .slice(0, 8);
  if (safeTerms.length === 0) {
    return null;
  }

  return safeTerms.map((term) => `${term}*`).join(' OR ');
}

export function searchIndexedConversationDocuments(input: {
  terms: string[];
  currentConversationId?: string;
  currentCwd?: string;
  nowMs?: number;
  recentWindowMs: number;
  limit: number;
}): IndexedConversationSearchCandidate[] {
  const ftsQuery = buildFtsQuery(input.terms);
  if (!ftsQuery) {
    return [];
  }

  const nowMs = Number.isSafeInteger(input.nowMs) && input.nowMs !== undefined ? input.nowMs : Date.now();
  const minActivityAt = new Date(nowMs - input.recentWindowMs).toISOString();
  const rows = getDb()
    .prepare(
      `
    SELECT i.session_id AS sessionId,
      i.title AS title,
      i.cwd AS cwd,
      i.timestamp AS timestamp,
      i.last_activity_at AS lastActivityAt,
      f.search_text AS searchText
    FROM conversation_search_index_fts f
    JOIN conversation_search_index i ON i.session_id = f.session_id
    WHERE conversation_search_index_fts MATCH ?
      AND i.last_activity_at >= ?
      AND i.session_id != ?
    ORDER BY CASE WHEN i.cwd = ? THEN 0 ELSE 1 END,
      i.last_activity_at DESC,
      bm25(conversation_search_index_fts)
    LIMIT ?
  `,
    )
    .all(ftsQuery, minActivityAt, input.currentConversationId ?? '', input.currentCwd ?? '', input.limit) as Array<{
    sessionId: string;
    title: string;
    cwd: string;
    timestamp: string;
    lastActivityAt: string;
    searchText: string;
  }>;

  return rows
    .filter((row) => Number.isFinite(parseTimestamp(row.lastActivityAt)))
    .map((row) => ({
      sessionId: row.sessionId,
      title: row.title,
      cwd: row.cwd,
      timestamp: row.timestamp,
      lastActivityAt: row.lastActivityAt,
      searchText: row.searchText,
    }));
}

export function resetConversationSearchIndexForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
  indexingScheduled = false;
  indexingActive = false;
}
