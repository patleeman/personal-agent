import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import BetterSqlite3 from 'better-sqlite3';
import {
  createProjectActivityEntry,
  readProjectActivityEntry,
  type ProjectActivityEntryDocument,
  type ProjectActivityNotificationState,
} from './project-artifacts.js';
import { getStateRoot } from './runtime/paths.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ACTIVITY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ACTIVITY_NOTIFICATION_STATE_VALUES = new Set<ProjectActivityNotificationState>(['none', 'queued', 'sent', 'failed']);

type SqliteDatabase = InstanceType<typeof BetterSqlite3>;

type StoredActivityRow = {
  id: string;
  created_at: string;
  entry_json: string;
};

const runtimeDbCache = new Map<string, SqliteDatabase>();

export interface ResolveActivityOptions {
  profile: string;
  stateRoot?: string;
  repoRoot?: string;
}

export interface ResolveActivityEntryPathOptions extends ResolveActivityOptions {
  activityId: string;
}

export interface StoredActivityEntry {
  path: string;
  entry: ProjectActivityEntryDocument;
}

function getActivityStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(
      `Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

export function validateActivityId(activityId: string): void {
  if (!ACTIVITY_ID_PATTERN.test(activityId)) {
    throw new Error(
      `Invalid activity id "${activityId}". Activity ids may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

export function resolveProfileActivityStateDir(options: ResolveActivityOptions): string {
  validateProfileName(options.profile);
  return join(getActivityStateRoot(options.stateRoot), 'pi-agent', 'state', 'inbox', options.profile);
}

export function resolveProfileActivityDir(options: ResolveActivityOptions): string {
  validateProfileName(options.profile);
  return join(resolveProfileActivityStateDir(options), 'activities');
}

export function resolveActivityEntryPath(options: ResolveActivityEntryPathOptions): string {
  validateProfileName(options.profile);
  validateActivityId(options.activityId);

  return join(resolveProfileActivityDir(options), `${options.activityId}.md`);
}

export function resolveActivityReadStatePath(options: ResolveActivityOptions): string {
  validateProfileName(options.profile);
  return join(resolveProfileActivityStateDir(options), 'read-state.json');
}

export function resolveProfileActivityDbPath(options: ResolveActivityOptions): string {
  validateProfileName(options.profile);
  return join(resolveProfileActivityStateDir(options), 'runtime.db');
}

function buildActivityStoragePath(options: ResolveActivityEntryPathOptions): string {
  return `${resolveProfileActivityDbPath(options)}#activity/${options.activityId}`;
}

function normalizeStringArray(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const normalized = [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0))];

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNotificationState(value: unknown): ProjectActivityNotificationState {
  return ACTIVITY_NOTIFICATION_STATE_VALUES.has(value as ProjectActivityNotificationState)
    ? value as ProjectActivityNotificationState
    : 'none';
}

function parseStoredActivityEntry(serialized: string, label: string): ProjectActivityEntryDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new Error(`Invalid activity row JSON for ${label}: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid activity row payload for ${label}`);
  }

  const value = parsed as Partial<ProjectActivityEntryDocument>;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  validateActivityId(id);

  return createProjectActivityEntry({
    id,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt.trim() : '',
    profile: typeof value.profile === 'string' ? value.profile.trim() : '',
    kind: typeof value.kind === 'string' ? value.kind.trim() : '',
    summary: typeof value.summary === 'string' ? value.summary.trim() : '',
    details: typeof value.details === 'string' && value.details.trim().length > 0 ? value.details : undefined,
    relatedProjectIds: normalizeStringArray(value.relatedProjectIds),
    notificationState: normalizeNotificationState(value.notificationState),
  });
}

function serializeActivityEntry(entry: ProjectActivityEntryDocument): string {
  return JSON.stringify({
    ...entry,
    notificationState: normalizeNotificationState(entry.notificationState),
  });
}

function hasLegacyActivityState(options: ResolveActivityOptions): boolean {
  if (existsSync(resolveActivityReadStatePath(options))) {
    return true;
  }

  const legacyActivityDir = resolveProfileActivityDir(options);
  if (!existsSync(legacyActivityDir)) {
    return false;
  }

  return readdirSync(legacyActivityDir, { withFileTypes: true })
    .some((entry) => entry.isFile() && entry.name.endsWith('.md'));
}

function openActivityDb(options: ResolveActivityOptions, create = false): SqliteDatabase | null {
  const dbPath = resolveProfileActivityDbPath(options);
  const cached = runtimeDbCache.get(dbPath);
  if (cached) {
    return cached;
  }

  const shouldCreate = create || existsSync(dbPath) || hasLegacyActivityState(options);
  if (!shouldCreate) {
    return null;
  }

  mkdirSync(resolveProfileActivityStateDir(options), { recursive: true, mode: 0o700 });
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_entries (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      entry_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_entries_created_at ON activity_entries(created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS activity_read_state (
      activity_id TEXT PRIMARY KEY
    );

    PRAGMA user_version = 1;
  `);

  migrateLegacyActivityStorage(db, options);
  runtimeDbCache.set(dbPath, db);
  return db;
}

function migrateLegacyActivityStorage(db: SqliteDatabase, options: ResolveActivityOptions): void {
  const legacyActivityDir = resolveProfileActivityDir(options);
  const legacyReadStatePath = resolveActivityReadStatePath(options);
  const insertActivity = db.prepare(`
    INSERT OR IGNORE INTO activity_entries (id, created_at, entry_json)
    VALUES (?, ?, ?)
  `);
  const insertReadState = db.prepare(`
    INSERT OR IGNORE INTO activity_read_state (activity_id)
    VALUES (?)
  `);

  const activityEntriesToInsert: ProjectActivityEntryDocument[] = [];
  const activityFilesToDelete: string[] = [];
  const readStateIdsToInsert: string[] = [];
  let deleteLegacyReadState = false;

  if (existsSync(legacyActivityDir)) {
    for (const activityFile of readdirSync(legacyActivityDir, { withFileTypes: true })) {
      if (!activityFile.isFile() || !activityFile.name.endsWith('.md')) {
        continue;
      }

      const path = join(legacyActivityDir, activityFile.name);

      try {
        const entry = readProjectActivityEntry(path);
        validateActivityId(entry.id);
        activityEntriesToInsert.push(entry);
        activityFilesToDelete.push(path);
      } catch {
        continue;
      }
    }
  }

  if (existsSync(legacyReadStatePath)) {
    try {
      const parsed = JSON.parse(readFileSync(legacyReadStatePath, 'utf-8')) as unknown;
      if (Array.isArray(parsed)) {
        readStateIdsToInsert.push(...parsed
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0));
        deleteLegacyReadState = true;
      }
    } catch {
      // Ignore malformed legacy read-state files and leave them in place.
    }
  }

  if (activityEntriesToInsert.length > 0 || readStateIdsToInsert.length > 0) {
    const tx = db.transaction((entries: ProjectActivityEntryDocument[], readStateIds: string[]) => {
      for (const entry of entries) {
        insertActivity.run(entry.id, entry.createdAt, serializeActivityEntry(entry));
      }

      for (const activityId of normalizeReadStateIds(readStateIds)) {
        insertReadState.run(activityId);
      }
    });

    tx(activityEntriesToInsert, readStateIdsToInsert);
  }

  for (const path of activityFilesToDelete) {
    rmSync(path, { force: true });
  }

  if (deleteLegacyReadState) {
    rmSync(legacyReadStatePath, { force: true });
  }
}

function selectActivityRows(options: ResolveActivityOptions): StoredActivityRow[] {
  const db = openActivityDb(options);
  if (!db) {
    return [];
  }

  return db.prepare(`
    SELECT id, created_at, entry_json
    FROM activity_entries
    ORDER BY created_at DESC, id DESC
  `).all() as StoredActivityRow[];
}

function selectActivityRow(options: ResolveActivityEntryPathOptions): StoredActivityRow | undefined {
  const db = openActivityDb(options);
  if (!db) {
    return undefined;
  }

  return db.prepare(`
    SELECT id, created_at, entry_json
    FROM activity_entries
    WHERE id = ?
  `).get(options.activityId) as StoredActivityRow | undefined;
}

function hydrateStoredActivityEntry(options: ResolveActivityEntryPathOptions, row: StoredActivityRow): StoredActivityEntry {
  return {
    path: buildActivityStoragePath(options),
    entry: parseStoredActivityEntry(row.entry_json, options.activityId),
  };
}

function normalizeReadStateIds(ids: Iterable<string>): string[] {
  return [...new Set(Array.from(ids)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value) => ACTIVITY_ID_PATTERN.test(value)))]
    .sort();
}

function normalizeDeleteActivityIds(ids: Iterable<string>): string[] {
  return [...new Set(Array.from(ids)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => {
      validateActivityId(value);
      return value;
    }))]
    .sort();
}

export function loadProfileActivityReadState(options: ResolveActivityOptions): Set<string> {
  const db = openActivityDb(options);
  if (!db) {
    return new Set();
  }

  const rows = db.prepare(`
    SELECT activity_id
    FROM activity_read_state
    ORDER BY activity_id ASC
  `).all() as Array<{ activity_id: string }>;

  return new Set(rows.map((row) => row.activity_id));
}

export function saveProfileActivityReadState(options: ResolveActivityOptions & { ids: Iterable<string> }): string {
  const db = openActivityDb(options, true);
  if (!db) {
    throw new Error('Could not open activity sqlite database.');
  }

  const normalizedIds = normalizeReadStateIds(options.ids);
  const clear = db.prepare('DELETE FROM activity_read_state');
  const insert = db.prepare(`
    INSERT INTO activity_read_state (activity_id)
    VALUES (?)
  `);
  const tx = db.transaction((ids: string[]) => {
    clear.run();
    for (const activityId of ids) {
      insert.run(activityId);
    }
  });

  tx(normalizedIds);
  return resolveProfileActivityDbPath(options);
}

export function writeProfileActivityEntry(options: {
  profile: string;
  entry: ProjectActivityEntryDocument;
  stateRoot?: string;
  repoRoot?: string;
}): string {
  validateActivityId(options.entry.id);
  const db = openActivityDb(options, true);
  if (!db) {
    throw new Error('Could not open activity sqlite database.');
  }

  db.prepare(`
    INSERT INTO activity_entries (id, created_at, entry_json)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      created_at = excluded.created_at,
      entry_json = excluded.entry_json
  `).run(
    options.entry.id,
    options.entry.createdAt,
    serializeActivityEntry(options.entry),
  );

  return buildActivityStoragePath({
    stateRoot: options.stateRoot,
    profile: options.profile,
    activityId: options.entry.id,
  });
}

export function hasProfileActivityEntry(options: ResolveActivityEntryPathOptions): boolean {
  return selectActivityRow(options) !== undefined;
}

export function getProfileActivityEntry(options: ResolveActivityEntryPathOptions): StoredActivityEntry | null {
  const row = selectActivityRow(options);
  return row
    ? hydrateStoredActivityEntry(options, row)
    : null;
}

export function deleteProfileActivityEntries(options: ResolveActivityOptions & { activityIds: Iterable<string> }): string[] {
  const activityIds = normalizeDeleteActivityIds(options.activityIds);
  if (activityIds.length === 0) {
    return [];
  }

  const db = openActivityDb(options);
  if (!db) {
    return [];
  }

  const deleteEntry = db.prepare('DELETE FROM activity_entries WHERE id = ?');
  const deleteReadState = db.prepare('DELETE FROM activity_read_state WHERE activity_id = ?');
  const deletedIds: string[] = [];
  const tx = db.transaction((ids: string[]) => {
    for (const activityId of ids) {
      const deleted = deleteEntry.run(activityId);
      deleteReadState.run(activityId);
      if (deleted.changes > 0) {
        deletedIds.push(activityId);
      }
    }
  });

  tx(activityIds);
  return deletedIds;
}

export function listProfileActivityEntries(options: ResolveActivityOptions): StoredActivityEntry[] {
  const rows = selectActivityRows(options);
  const entries: StoredActivityEntry[] = [];

  for (const row of rows) {
    try {
      entries.push(hydrateStoredActivityEntry({
        stateRoot: options.stateRoot,
        profile: options.profile,
        activityId: row.id,
      }, row));
    } catch {
      continue;
    }
  }

  return entries;
}
