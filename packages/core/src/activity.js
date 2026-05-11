import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { createProjectActivityEntry, readProjectActivityEntry, } from './project-artifacts.js';
import { getStateRoot } from './runtime/paths.js';
import { openSqliteDatabase } from './sqlite.js';
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ACTIVITY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ACTIVITY_NOTIFICATION_STATE_VALUES = new Set(['none', 'queued', 'sent', 'failed']);
const runtimeDbCache = new Map();
export function closeActivityDbs() {
    for (const db of runtimeDbCache.values()) {
        db.close();
    }
    runtimeDbCache.clear();
}
function getActivityStateRoot(stateRoot) {
    return resolve(stateRoot ?? getStateRoot());
}
function validateProfileName(profile) {
    if (!PROFILE_NAME_PATTERN.test(profile)) {
        throw new Error(`Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`);
    }
}
export function validateActivityId(activityId) {
    if (!ACTIVITY_ID_PATTERN.test(activityId)) {
        throw new Error(`Invalid activity id "${activityId}". Activity ids may only include letters, numbers, dashes, and underscores.`);
    }
}
export function resolveProfileActivityStateDir(options) {
    validateProfileName(options.profile);
    return join(getActivityStateRoot(options.stateRoot), 'pi-agent', 'state', 'activity', options.profile);
}
function resolveLegacyProfileActivityStateDir(options) {
    validateProfileName(options.profile);
    return join(getActivityStateRoot(options.stateRoot), 'pi-agent', 'state', 'inbox', options.profile);
}
export function resolveProfileActivityDir(options) {
    validateProfileName(options.profile);
    return join(resolveProfileActivityStateDir(options), 'activities');
}
export function resolveActivityEntryPath(options) {
    validateProfileName(options.profile);
    validateActivityId(options.activityId);
    return join(resolveProfileActivityDir(options), `${options.activityId}.md`);
}
export function resolveActivityReadStatePath(options) {
    validateProfileName(options.profile);
    return join(resolveProfileActivityStateDir(options), 'read-state.json');
}
export function resolveProfileActivityDbPath(options) {
    validateProfileName(options.profile);
    return join(resolveProfileActivityStateDir(options), 'runtime.db');
}
function buildActivityStoragePath(options) {
    return `${resolveProfileActivityDbPath(options)}#activity/${options.activityId}`;
}
function normalizeStringArray(values) {
    if (!Array.isArray(values)) {
        return undefined;
    }
    const normalized = [
        ...new Set(values
            .filter((value) => typeof value === 'string')
            .map((value) => value.trim())
            .filter((value) => value.length > 0)),
    ];
    return normalized.length > 0 ? normalized : undefined;
}
function normalizeNotificationState(value) {
    return ACTIVITY_NOTIFICATION_STATE_VALUES.has(value)
        ? value
        : 'none';
}
function parseStoredActivityEntry(serialized, label) {
    let parsed;
    try {
        parsed = JSON.parse(serialized);
    }
    catch (error) {
        throw new Error(`Invalid activity row JSON for ${label}: ${error.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid activity row payload for ${label}`);
    }
    const value = parsed;
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
function serializeActivityEntry(entry) {
    return JSON.stringify({
        ...entry,
        notificationState: normalizeNotificationState(entry.notificationState),
    });
}
function hasLegacyMarkdownActivityState(options) {
    const legacyReadStatePath = join(resolveLegacyProfileActivityStateDir(options), 'read-state.json');
    if (existsSync(legacyReadStatePath)) {
        return true;
    }
    const legacyActivityDir = join(resolveLegacyProfileActivityStateDir(options), 'activities');
    if (!existsSync(legacyActivityDir)) {
        return false;
    }
    return readdirSync(legacyActivityDir, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith('.md'));
}
function hasLegacyActivityDb(options) {
    return existsSync(join(resolveLegacyProfileActivityStateDir(options), 'runtime.db'));
}
function openActivityDb(options, create = false) {
    const dbPath = resolveProfileActivityDbPath(options);
    const cached = runtimeDbCache.get(dbPath);
    if (cached) {
        return cached;
    }
    const shouldCreate = create || existsSync(dbPath) || hasLegacyActivityDb(options) || hasLegacyMarkdownActivityState(options);
    if (!shouldCreate) {
        return null;
    }
    mkdirSync(resolveProfileActivityStateDir(options), { recursive: true, mode: 0o700 });
    const db = openSqliteDatabase(dbPath);
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
function migrateLegacyActivityStorage(db, options) {
    const legacyStateDir = resolveLegacyProfileActivityStateDir(options);
    const legacyDbPath = join(legacyStateDir, 'runtime.db');
    const legacyActivityDir = join(legacyStateDir, 'activities');
    const legacyReadStatePath = join(legacyStateDir, 'read-state.json');
    const insertActivity = db.prepare(`
    INSERT OR REPLACE INTO activity_entries (id, created_at, entry_json)
    VALUES (?, ?, ?)
  `);
    const insertReadState = db.prepare(`
    INSERT OR IGNORE INTO activity_read_state (activity_id)
    VALUES (?)
  `);
    const activityEntriesToInsert = [];
    const activityFilesToDelete = [];
    const readStateIdsToInsert = [];
    let deleteLegacyReadState = false;
    let deleteLegacyDb = false;
    if (existsSync(legacyDbPath)) {
        const legacyDb = openSqliteDatabase(legacyDbPath);
        try {
            const legacyRows = legacyDb
                .prepare(`
        SELECT id, created_at, entry_json
        FROM activity_entries
        ORDER BY created_at DESC, id DESC
      `)
                .all();
            for (const row of legacyRows) {
                try {
                    activityEntriesToInsert.push(parseStoredActivityEntry(row.entry_json, row.id));
                }
                catch {
                    continue;
                }
            }
        }
        catch {
            // Ignore malformed legacy sqlite rows and preserve what we can from markdown state below.
        }
        try {
            const rows = legacyDb
                .prepare(`
        SELECT activity_id
        FROM activity_read_state
        ORDER BY activity_id ASC
      `)
                .all();
            readStateIdsToInsert.push(...rows.map((row) => row.activity_id));
        }
        catch {
            // Ignore missing legacy read-state tables.
        }
        legacyDb.close();
        deleteLegacyDb = true;
    }
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
            }
            catch {
                continue;
            }
        }
    }
    if (existsSync(legacyReadStatePath)) {
        try {
            const parsed = JSON.parse(readFileSync(legacyReadStatePath, 'utf-8'));
            if (Array.isArray(parsed)) {
                readStateIdsToInsert.push(...parsed
                    .filter((value) => typeof value === 'string')
                    .map((value) => value.trim())
                    .filter((value) => value.length > 0));
                deleteLegacyReadState = true;
            }
        }
        catch {
            // Ignore malformed legacy read-state files and leave them in place.
        }
    }
    if (activityEntriesToInsert.length > 0 || readStateIdsToInsert.length > 0) {
        const dedupedEntries = new Map();
        for (const entry of activityEntriesToInsert) {
            const existing = dedupedEntries.get(entry.id);
            if (!existing || entry.createdAt >= existing.createdAt) {
                dedupedEntries.set(entry.id, entry);
            }
        }
        const tx = db.transaction((entries, readStateIds) => {
            for (const entry of entries) {
                insertActivity.run(entry.id, entry.createdAt, serializeActivityEntry(entry));
            }
            for (const activityId of normalizeReadStateIds(readStateIds)) {
                insertReadState.run(activityId);
            }
        });
        tx([...dedupedEntries.values()], readStateIdsToInsert);
    }
    for (const path of activityFilesToDelete) {
        rmSync(path, { force: true });
    }
    if (deleteLegacyReadState) {
        rmSync(legacyReadStatePath, { force: true });
    }
    if (deleteLegacyDb) {
        rmSync(legacyDbPath, { force: true });
        rmSync(`${legacyDbPath}-wal`, { force: true });
        rmSync(`${legacyDbPath}-shm`, { force: true });
    }
}
function selectActivityRows(options) {
    const db = openActivityDb(options);
    if (!db) {
        return [];
    }
    return db
        .prepare(`
    SELECT id, created_at, entry_json
    FROM activity_entries
    ORDER BY created_at DESC, id DESC
  `)
        .all();
}
function selectActivityRow(options) {
    const db = openActivityDb(options);
    if (!db) {
        return undefined;
    }
    return db
        .prepare(`
    SELECT id, created_at, entry_json
    FROM activity_entries
    WHERE id = ?
  `)
        .get(options.activityId);
}
function hydrateStoredActivityEntry(options, row) {
    return {
        path: buildActivityStoragePath(options),
        entry: parseStoredActivityEntry(row.entry_json, options.activityId),
    };
}
function normalizeReadStateIds(ids) {
    return [
        ...new Set(Array.from(ids)
            .filter((value) => typeof value === 'string')
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
            .filter((value) => ACTIVITY_ID_PATTERN.test(value))),
    ].sort();
}
function normalizeDeleteActivityIds(ids) {
    return [
        ...new Set(Array.from(ids)
            .filter((value) => typeof value === 'string')
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
            .map((value) => {
            validateActivityId(value);
            return value;
        })),
    ].sort();
}
export function loadProfileActivityReadState(options) {
    const db = openActivityDb(options);
    if (!db) {
        return new Set();
    }
    const rows = db
        .prepare(`
    SELECT activity_id
    FROM activity_read_state
    ORDER BY activity_id ASC
  `)
        .all();
    return new Set(rows.map((row) => row.activity_id));
}
export function saveProfileActivityReadState(options) {
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
    const tx = db.transaction((ids) => {
        clear.run();
        for (const activityId of ids) {
            insert.run(activityId);
        }
    });
    tx(normalizedIds);
    return resolveProfileActivityDbPath(options);
}
export function writeProfileActivityEntry(options) {
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
  `).run(options.entry.id, options.entry.createdAt, serializeActivityEntry(options.entry));
    return buildActivityStoragePath({
        stateRoot: options.stateRoot,
        profile: options.profile,
        activityId: options.entry.id,
    });
}
export function hasProfileActivityEntry(options) {
    return selectActivityRow(options) !== undefined;
}
export function getProfileActivityEntry(options) {
    const row = selectActivityRow(options);
    return row ? hydrateStoredActivityEntry(options, row) : null;
}
export function deleteProfileActivityEntries(options) {
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
    const deletedIds = [];
    const tx = db.transaction((ids) => {
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
export function listProfileActivityEntries(options) {
    const rows = selectActivityRows(options);
    const entries = [];
    for (const row of rows) {
        try {
            entries.push(hydrateStoredActivityEntry({
                stateRoot: options.stateRoot,
                profile: options.profile,
                activityId: row.id,
            }, row));
        }
        catch {
            continue;
        }
    }
    return entries;
}
