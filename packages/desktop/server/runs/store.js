import { existsSync, mkdirSync } from 'fs';
import { basename, dirname, join } from 'path';
import { openRecoveringRuntimeSqliteDb } from '../shared/sqliteRuntimeRecovery.js';
const runtimeDbCache = new Map();
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function toString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
function toTimestampString(value) {
  const raw = toString(value);
  if (!raw) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw)) {
    return undefined;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = new Date(parsed).toISOString();
  return normalized === raw || normalized === raw.replace('Z', '.000Z') ? normalized : undefined;
}
function toTimestampStringOrNow(value) {
  return toTimestampString(value) ?? new Date().toISOString();
}
function toPositiveInteger(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return undefined;
}
function toRunKind(value) {
  if (
    value === 'scheduled-task' ||
    value === 'conversation' ||
    value === 'workflow' ||
    value === 'raw-shell' ||
    value === 'background-run'
  ) {
    return value;
  }
  return undefined;
}
function toRunStatus(value) {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'recovering' ||
    value === 'waiting' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'interrupted'
  ) {
    return value;
  }
  return undefined;
}
function toResumePolicy(value) {
  if (value === 'rerun' || value === 'continue' || value === 'manual') {
    return value;
  }
  return undefined;
}
function parseManifest(value) {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = toString(value.id);
  const kind = toRunKind(value.kind);
  const resumePolicy = toResumePolicy(value.resumePolicy);
  const createdAt = toTimestampString(value.createdAt);
  const spec = isRecord(value.spec) ? value.spec : {};
  const source = isRecord(value.source)
    ? {
        type: toString(value.source.type) ?? 'unknown',
        id: toString(value.source.id),
        filePath: toString(value.source.filePath),
      }
    : undefined;
  if (!id || !kind || !resumePolicy || !createdAt) {
    return undefined;
  }
  return {
    version: 1,
    id,
    kind,
    resumePolicy,
    createdAt,
    spec,
    parentId: toString(value.parentId),
    rootId: toString(value.rootId),
    source,
  };
}
function parseStatus(value) {
  if (!isRecord(value)) {
    return undefined;
  }
  const runId = toString(value.runId);
  const status = toRunStatus(value.status);
  const createdAt = toTimestampString(value.createdAt);
  const updatedAt = toTimestampString(value.updatedAt) ?? createdAt;
  const activeAttempt = toPositiveInteger(value.activeAttempt);
  if (!runId || !status || !createdAt || !updatedAt || activeAttempt === undefined) {
    return undefined;
  }
  return {
    version: 1,
    runId,
    status,
    createdAt,
    updatedAt,
    activeAttempt,
    startedAt: toTimestampString(value.startedAt),
    completedAt: toTimestampString(value.completedAt),
    checkpointKey: toString(value.checkpointKey),
    lastError: toString(value.lastError),
  };
}
function parseCheckpoint(value) {
  if (!isRecord(value)) {
    return undefined;
  }
  const runId = toString(value.runId);
  const updatedAt = toTimestampStringOrNow(value.updatedAt);
  const payload = isRecord(value.payload) ? value.payload : undefined;
  if (!runId || !updatedAt) {
    return undefined;
  }
  return {
    version: 1,
    runId,
    updatedAt,
    step: toString(value.step),
    cursor: toString(value.cursor),
    payload,
  };
}
function parseResult(value) {
  return isRecord(value) ? value : undefined;
}
function parseEvent(value) {
  if (!isRecord(value)) {
    return undefined;
  }
  const runId = toString(value.runId);
  const timestamp = toTimestampString(value.timestamp);
  const type = toString(value.type);
  const attempt = value.attempt === undefined ? undefined : toPositiveInteger(value.attempt);
  const payload = isRecord(value.payload) ? value.payload : undefined;
  if (!runId || !timestamp || !type) {
    return undefined;
  }
  return {
    version: 1,
    runId,
    timestamp,
    type,
    attempt,
    payload,
  };
}
function serializeJson(value) {
  return JSON.stringify(value);
}
function parseStoredJson(raw) {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
function readJsonFile(path) {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(require('fs').readFileSync(path, 'utf-8'));
  } catch {
    return undefined;
  }
}
function terminalStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
function hasPendingWebLiveOperation(checkpoint) {
  const pendingOperation = checkpoint?.payload?.pendingOperation;
  return isRecord(pendingOperation) && typeof pendingOperation.type === 'string' && pendingOperation.type.trim().length > 0;
}
function determineRecoveryAction(manifest, status, checkpoint) {
  if (!manifest || !status) {
    return 'invalid';
  }
  if (terminalStatus(status.status)) {
    return 'none';
  }
  if (
    manifest.source?.type === 'web-live-session' &&
    (status.status === 'waiting' || status.status === 'interrupted') &&
    !hasPendingWebLiveOperation(checkpoint)
  ) {
    return 'none';
  }
  if (manifest.resumePolicy === 'continue') {
    return 'resume';
  }
  if (manifest.resumePolicy === 'rerun') {
    return 'rerun';
  }
  return 'attention';
}
export function resolveDurableRunsRoot(daemonRoot) {
  return join(daemonRoot, 'runs');
}
export function resolveRuntimeDbPath(daemonRoot) {
  return join(daemonRoot, 'runtime.db');
}
function resolveRuntimeDbPathFromRunsRoot(runsRoot) {
  return basename(runsRoot) === 'runs' ? resolveRuntimeDbPath(dirname(runsRoot)) : join(runsRoot, 'runtime.db');
}
function parseRunStoragePath(path) {
  const runRoot = dirname(path);
  const runsRoot = dirname(runRoot);
  const runId = toString(runRoot.split(/[\\/]/).at(-1));
  if (!runId) {
    throw new Error(`Could not resolve run id from path: ${path}`);
  }
  return {
    runId,
    runsRoot,
    dbPath: resolveRuntimeDbPathFromRunsRoot(runsRoot),
  };
}
function openRuntimeDb(dbPath) {
  const cached = runtimeDbCache.get(dbPath);
  if (cached) {
    return cached;
  }
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = openRecoveringRuntimeSqliteDb(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      manifest_json TEXT,
      created_at TEXT,
      kind TEXT,
      resume_policy TEXT,
      parent_id TEXT,
      root_id TEXT,
      source_type TEXT,
      source_id TEXT,
      source_file_path TEXT,
      status_json TEXT,
      status_status TEXT,
      status_updated_at TEXT,
      status_completed_at TEXT,
      checkpoint_json TEXT,
      checkpoint_updated_at TEXT,
      checkpoint_step TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_parent_id ON runs(parent_id);
    CREATE INDEX IF NOT EXISTS idx_runs_root_id ON runs(root_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status_status ON runs(status_status);
    CREATE INDEX IF NOT EXISTS idx_runs_status_updated_at ON runs(status_updated_at);

    CREATE TABLE IF NOT EXISTS run_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      attempt INTEGER,
      payload_json TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_run_events_run_seq ON run_events(run_id, seq);
    CREATE INDEX IF NOT EXISTS idx_run_events_timestamp ON run_events(timestamp);

    PRAGMA user_version = 1;
  `);
  runtimeDbCache.set(dbPath, db);
  return db;
}
function runtimeDbExists(runsRoot) {
  return existsSync(resolveRuntimeDbPathFromRunsRoot(runsRoot));
}
function selectRunRow(runsRoot, runId) {
  if (!runtimeDbExists(runsRoot)) {
    return undefined;
  }
  const db = openRuntimeDb(resolveRuntimeDbPathFromRunsRoot(runsRoot));
  return db
    .prepare(
      `
    SELECT run_id, manifest_json, status_json, checkpoint_json
    FROM runs
    WHERE run_id = ?
  `,
    )
    .get(runId);
}
function selectAllRunRows(runsRoot) {
  if (!runtimeDbExists(runsRoot)) {
    return [];
  }
  const db = openRuntimeDb(resolveRuntimeDbPathFromRunsRoot(runsRoot));
  return db
    .prepare(
      `
    SELECT run_id, manifest_json, status_json, checkpoint_json
    FROM runs
    ORDER BY run_id ASC
  `,
    )
    .all();
}
function hydrateManifest(row) {
  return parseManifest(parseStoredJson(row?.manifest_json ?? null));
}
function hydrateStatus(row) {
  return parseStatus(parseStoredJson(row?.status_json ?? null));
}
function hydrateCheckpoint(row) {
  return parseCheckpoint(parseStoredJson(row?.checkpoint_json ?? null));
}
export function resolveDurableRunPaths(runsRoot, runId) {
  const root = join(runsRoot, runId);
  return {
    root,
    manifestPath: join(root, 'manifest.json'),
    statusPath: join(root, 'status.json'),
    checkpointPath: join(root, 'checkpoint.json'),
    eventsPath: join(root, 'events.jsonl'),
    outputLogPath: join(root, 'output.log'),
    resultPath: join(root, 'result.json'),
  };
}
export function createDurableRunManifest(input) {
  return {
    version: 1,
    id: input.id,
    kind: input.kind,
    resumePolicy: input.resumePolicy,
    createdAt: toTimestampStringOrNow(input.createdAt),
    spec: input.spec ?? {},
    parentId: input.parentId,
    rootId: input.rootId,
    source: input.source,
  };
}
export function createInitialDurableRunStatus(input) {
  const createdAt = toTimestampStringOrNow(input.createdAt);
  return {
    version: 1,
    runId: input.runId,
    status: input.status ?? 'queued',
    createdAt,
    updatedAt: toTimestampString(input.updatedAt) ?? createdAt,
    activeAttempt: input.activeAttempt ?? 0,
    startedAt: toTimestampString(input.startedAt),
    completedAt: toTimestampString(input.completedAt),
    checkpointKey: input.checkpointKey,
    lastError: input.lastError,
  };
}
export function saveDurableRunManifest(path, manifest) {
  const { runId, dbPath } = parseRunStoragePath(path);
  const db = openRuntimeDb(dbPath);
  db.prepare(
    `
    INSERT INTO runs (
      run_id,
      manifest_json,
      created_at,
      kind,
      resume_policy,
      parent_id,
      root_id,
      source_type,
      source_id,
      source_file_path
    ) VALUES (
      @run_id,
      @manifest_json,
      @created_at,
      @kind,
      @resume_policy,
      @parent_id,
      @root_id,
      @source_type,
      @source_id,
      @source_file_path
    )
    ON CONFLICT(run_id) DO UPDATE SET
      manifest_json = excluded.manifest_json,
      created_at = excluded.created_at,
      kind = excluded.kind,
      resume_policy = excluded.resume_policy,
      parent_id = excluded.parent_id,
      root_id = excluded.root_id,
      source_type = excluded.source_type,
      source_id = excluded.source_id,
      source_file_path = excluded.source_file_path
  `,
  ).run({
    run_id: runId,
    manifest_json: serializeJson(manifest),
    created_at: manifest.createdAt,
    kind: manifest.kind,
    resume_policy: manifest.resumePolicy,
    parent_id: manifest.parentId ?? null,
    root_id: manifest.rootId ?? null,
    source_type: manifest.source?.type ?? null,
    source_id: manifest.source?.id ?? null,
    source_file_path: manifest.source?.filePath ?? null,
  });
}
export function loadDurableRunManifest(path) {
  const { runId, runsRoot } = parseRunStoragePath(path);
  return hydrateManifest(selectRunRow(runsRoot, runId));
}
export function saveDurableRunStatus(path, status) {
  const { runId, dbPath } = parseRunStoragePath(path);
  const db = openRuntimeDb(dbPath);
  db.prepare(
    `
    INSERT INTO runs (
      run_id,
      status_json,
      status_status,
      status_updated_at,
      status_completed_at
    ) VALUES (
      @run_id,
      @status_json,
      @status_status,
      @status_updated_at,
      @status_completed_at
    )
    ON CONFLICT(run_id) DO UPDATE SET
      status_json = excluded.status_json,
      status_status = excluded.status_status,
      status_updated_at = excluded.status_updated_at,
      status_completed_at = excluded.status_completed_at
  `,
  ).run({
    run_id: runId,
    status_json: serializeJson(status),
    status_status: status.status,
    status_updated_at: status.updatedAt,
    status_completed_at: status.completedAt ?? null,
  });
}
export function loadDurableRunStatus(path) {
  const { runId, runsRoot } = parseRunStoragePath(path);
  return hydrateStatus(selectRunRow(runsRoot, runId));
}
export function saveDurableRunCheckpoint(path, checkpoint) {
  const { runId, dbPath } = parseRunStoragePath(path);
  const db = openRuntimeDb(dbPath);
  db.prepare(
    `
    INSERT INTO runs (
      run_id,
      checkpoint_json,
      checkpoint_updated_at,
      checkpoint_step
    ) VALUES (
      @run_id,
      @checkpoint_json,
      @checkpoint_updated_at,
      @checkpoint_step
    )
    ON CONFLICT(run_id) DO UPDATE SET
      checkpoint_json = excluded.checkpoint_json,
      checkpoint_updated_at = excluded.checkpoint_updated_at,
      checkpoint_step = excluded.checkpoint_step
  `,
  ).run({
    run_id: runId,
    checkpoint_json: serializeJson(checkpoint),
    checkpoint_updated_at: checkpoint.updatedAt,
    checkpoint_step: checkpoint.step ?? null,
  });
}
export function loadDurableRunCheckpoint(path) {
  const { runId, runsRoot } = parseRunStoragePath(path);
  return hydrateCheckpoint(selectRunRow(runsRoot, runId));
}
export async function appendDurableRunEvent(path, event) {
  const { runId, dbPath } = parseRunStoragePath(path);
  const db = openRuntimeDb(dbPath);
  db.prepare('INSERT INTO runs (run_id) VALUES (?) ON CONFLICT(run_id) DO NOTHING').run(runId);
  db.prepare(
    `
    INSERT INTO run_events (
      run_id,
      timestamp,
      type,
      attempt,
      payload_json
    ) VALUES (?, ?, ?, ?, ?)
  `,
  ).run(runId, event.timestamp, event.type, event.attempt ?? null, event.payload ? serializeJson(event.payload) : null);
}
export function readDurableRunEvents(path) {
  const { runId, dbPath } = parseRunStoragePath(path);
  if (!existsSync(dbPath)) {
    return [];
  }
  const db = openRuntimeDb(dbPath);
  const rows = db
    .prepare(
      `
    SELECT run_id, timestamp, type, attempt, payload_json
    FROM run_events
    WHERE run_id = ?
    ORDER BY seq ASC
  `,
    )
    .all(runId);
  return rows
    .map((row) =>
      parseEvent({
        version: 1,
        runId: row.run_id,
        timestamp: row.timestamp,
        type: row.type,
        ...(row.attempt !== null ? { attempt: row.attempt } : {}),
        ...(row.payload_json ? { payload: parseStoredJson(row.payload_json) } : {}),
      }),
    )
    .filter((event) => event !== undefined);
}
export function listDurableRunIds(runsRoot) {
  if (!runtimeDbExists(runsRoot)) {
    return [];
  }
  const db = openRuntimeDb(resolveRuntimeDbPathFromRunsRoot(runsRoot));
  const rows = db.prepare('SELECT run_id FROM runs ORDER BY run_id ASC').all();
  return rows.map((row) => row.run_id);
}
export function scanDurableRun(runsRoot, runId) {
  const row = selectRunRow(runsRoot, runId);
  if (!row) {
    return undefined;
  }
  const paths = resolveDurableRunPaths(runsRoot, runId);
  const manifest = hydrateManifest(row);
  const status = hydrateStatus(row);
  const checkpoint = hydrateCheckpoint(row);
  const result = parseResult(readJsonFile(paths.resultPath));
  const problems = [];
  if (!manifest) {
    problems.push('missing or invalid manifest');
  }
  if (!status) {
    problems.push('missing or invalid status');
  }
  if (manifest && manifest.id !== runId) {
    problems.push(`manifest id mismatch: ${manifest.id}`);
  }
  if (status && status.runId !== runId) {
    problems.push(`status runId mismatch: ${status.runId}`);
  }
  if (checkpoint && checkpoint.runId !== runId) {
    problems.push(`checkpoint runId mismatch: ${checkpoint.runId}`);
  }
  return {
    runId,
    paths,
    manifest,
    status,
    checkpoint,
    result,
    problems,
    recoveryAction: problems.length > 0 ? 'invalid' : determineRecoveryAction(manifest, status, checkpoint),
  };
}
export function scanDurableRunsForRecovery(runsRoot) {
  return selectAllRunRows(runsRoot).map((row) => {
    const runId = row.run_id;
    const paths = resolveDurableRunPaths(runsRoot, runId);
    const manifest = hydrateManifest(row);
    const status = hydrateStatus(row);
    const checkpoint = hydrateCheckpoint(row);
    const result = parseResult(readJsonFile(paths.resultPath));
    const problems = [];
    if (!manifest) {
      problems.push('missing or invalid manifest');
    }
    if (!status) {
      problems.push('missing or invalid status');
    }
    if (manifest && manifest.id !== runId) {
      problems.push(`manifest id mismatch: ${manifest.id}`);
    }
    if (status && status.runId !== runId) {
      problems.push(`status runId mismatch: ${status.runId}`);
    }
    if (checkpoint && checkpoint.runId !== runId) {
      problems.push(`checkpoint runId mismatch: ${checkpoint.runId}`);
    }
    return {
      runId,
      paths,
      manifest,
      status,
      checkpoint,
      result,
      problems,
      recoveryAction: problems.length > 0 ? 'invalid' : determineRecoveryAction(manifest, status, checkpoint),
    };
  });
}
export function summarizeScannedDurableRuns(runs) {
  const recoveryActions = {
    none: 0,
    resume: 0,
    rerun: 0,
    attention: 0,
    invalid: 0,
  };
  const statuses = {};
  for (const run of runs) {
    recoveryActions[run.recoveryAction] += 1;
    const status = run.status?.status;
    if (!status) {
      continue;
    }
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  return {
    total: runs.length,
    recoveryActions,
    statuses,
  };
}
