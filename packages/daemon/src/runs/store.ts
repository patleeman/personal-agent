import { existsSync, mkdirSync } from 'fs';
import { basename, dirname, join } from 'path';
import { openSqliteDatabase, type SqliteDatabase } from '@personal-agent/core';

export type DurableRunKind = 'scheduled-task' | 'conversation' | 'workflow' | 'raw-shell' | 'background-run';
export type DurableRunStatus = 'queued' | 'running' | 'recovering' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type DurableRunResumePolicy = 'rerun' | 'continue' | 'manual';
export type DurableRunRecoveryAction = 'none' | 'resume' | 'rerun' | 'attention' | 'invalid';

export interface DurableRunManifest {
  version: 1;
  id: string;
  kind: DurableRunKind;
  resumePolicy: DurableRunResumePolicy;
  createdAt: string;
  spec: Record<string, unknown>;
  parentId?: string;
  rootId?: string;
  source?: {
    type: string;
    id?: string;
    filePath?: string;
  };
}

export interface DurableRunStatusFile {
  version: 1;
  runId: string;
  status: DurableRunStatus;
  createdAt: string;
  updatedAt: string;
  activeAttempt: number;
  startedAt?: string;
  completedAt?: string;
  checkpointKey?: string;
  lastError?: string;
}

export interface DurableRunCheckpointFile {
  version: 1;
  runId: string;
  updatedAt: string;
  step?: string;
  cursor?: string;
  payload?: Record<string, unknown>;
}

export interface DurableRunEvent {
  version: 1;
  runId: string;
  timestamp: string;
  type: string;
  attempt?: number;
  payload?: Record<string, unknown>;
}

export interface DurableRunPaths {
  root: string;
  manifestPath: string;
  statusPath: string;
  checkpointPath: string;
  eventsPath: string;
  outputLogPath: string;
  resultPath: string;
}

export interface ScannedDurableRun {
  runId: string;
  paths: DurableRunPaths;
  manifest?: DurableRunManifest;
  status?: DurableRunStatusFile;
  checkpoint?: DurableRunCheckpointFile;
  problems: string[];
  recoveryAction: DurableRunRecoveryAction;
}

export interface ScannedDurableRunsSummary {
  total: number;
  recoveryActions: Record<DurableRunRecoveryAction, number>;
  statuses: Partial<Record<DurableRunStatus, number>>;
}

type StoredRunRow = {
  run_id: string;
  manifest_json: string | null;
  status_json: string | null;
  checkpoint_json: string | null;
};

type StoredEventRow = {
  run_id: string;
  timestamp: string;
  type: string;
  attempt: number | null;
  payload_json: string | null;
};

const runtimeDbCache = new Map<string, SqliteDatabase>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toTimestampString(value: unknown): string | undefined {
  const raw = toString(value);
  if (!raw) {
    return undefined;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function toTimestampStringOrNow(value: unknown): string {
  return toTimestampString(value) ?? new Date().toISOString();
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  return undefined;
}

function toRunKind(value: unknown): DurableRunKind | undefined {
  if (
    value === 'scheduled-task'
    || value === 'conversation'
    || value === 'workflow'
    || value === 'raw-shell'
    || value === 'background-run'
  ) {
    return value;
  }

  return undefined;
}

function toRunStatus(value: unknown): DurableRunStatus | undefined {
  if (
    value === 'queued'
    || value === 'running'
    || value === 'recovering'
    || value === 'waiting'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
    || value === 'interrupted'
  ) {
    return value;
  }

  return undefined;
}

function toResumePolicy(value: unknown): DurableRunResumePolicy | undefined {
  if (value === 'rerun' || value === 'continue' || value === 'manual') {
    return value;
  }

  return undefined;
}

function parseManifest(value: unknown): DurableRunManifest | undefined {
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

function parseStatus(value: unknown): DurableRunStatusFile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const runId = toString(value.runId);
  const status = toRunStatus(value.status);
  const createdAt = toTimestampString(value.createdAt);
  const updatedAt = toTimestampString(value.updatedAt);
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

function parseCheckpoint(value: unknown): DurableRunCheckpointFile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const runId = toString(value.runId);
  const updatedAt = toTimestampString(value.updatedAt);
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

function parseEvent(value: unknown): DurableRunEvent | undefined {
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

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseStoredJson<T>(raw: string | null): T | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function terminalStatus(status: DurableRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function determineRecoveryAction(
  manifest: DurableRunManifest | undefined,
  status: DurableRunStatusFile | undefined,
): DurableRunRecoveryAction {
  if (!manifest || !status) {
    return 'invalid';
  }

  if (terminalStatus(status.status)) {
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

export function resolveDurableRunsRoot(daemonRoot: string): string {
  return join(daemonRoot, 'runs');
}

export function resolveRuntimeDbPath(daemonRoot: string): string {
  return join(daemonRoot, 'runtime.db');
}

function resolveRuntimeDbPathFromRunsRoot(runsRoot: string): string {
  return basename(runsRoot) === 'runs'
    ? resolveRuntimeDbPath(dirname(runsRoot))
    : join(runsRoot, 'runtime.db');
}

function parseRunStoragePath(path: string): { runId: string; runsRoot: string; dbPath: string } {
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

function openRuntimeDb(dbPath: string): SqliteDatabase {
  const cached = runtimeDbCache.get(dbPath);
  if (cached) {
    return cached;
  }

  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = openSqliteDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
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

function runtimeDbExists(runsRoot: string): boolean {
  return existsSync(resolveRuntimeDbPathFromRunsRoot(runsRoot));
}

function selectRunRow(runsRoot: string, runId: string): StoredRunRow | undefined {
  if (!runtimeDbExists(runsRoot)) {
    return undefined;
  }

  const db = openRuntimeDb(resolveRuntimeDbPathFromRunsRoot(runsRoot));
  return db.prepare(`
    SELECT run_id, manifest_json, status_json, checkpoint_json
    FROM runs
    WHERE run_id = ?
  `).get(runId) as StoredRunRow | undefined;
}

function selectAllRunRows(runsRoot: string): StoredRunRow[] {
  if (!runtimeDbExists(runsRoot)) {
    return [];
  }

  const db = openRuntimeDb(resolveRuntimeDbPathFromRunsRoot(runsRoot));
  return db.prepare(`
    SELECT run_id, manifest_json, status_json, checkpoint_json
    FROM runs
    ORDER BY run_id ASC
  `).all() as StoredRunRow[];
}

function listChildRunIds(runsRoot: string, parentId: string): string[] {
  if (!runtimeDbExists(runsRoot)) {
    return [];
  }

  const db = openRuntimeDb(resolveRuntimeDbPathFromRunsRoot(runsRoot));
  const rows = db.prepare(`
    SELECT run_id
    FROM runs
    WHERE parent_id = ?
    ORDER BY run_id ASC
  `).all(parentId) as Array<{ run_id: string }>;

  return rows.map((row) => row.run_id);
}

function deleteRunRows(runsRoot: string, runIds: string[]): void {
  if (runIds.length === 0 || !runtimeDbExists(runsRoot)) {
    return;
  }

  const db = openRuntimeDb(resolveRuntimeDbPathFromRunsRoot(runsRoot));
  const deleteEvents = db.prepare('DELETE FROM run_events WHERE run_id = ?');
  const deleteRun = db.prepare('DELETE FROM runs WHERE run_id = ?');
  const tx = db.transaction((ids: string[]) => {
    for (const runId of ids) {
      deleteEvents.run(runId);
      deleteRun.run(runId);
    }
  });

  tx(runIds);
}

function hydrateManifest(row: StoredRunRow | undefined): DurableRunManifest | undefined {
  return parseManifest(parseStoredJson(row?.manifest_json ?? null));
}

function hydrateStatus(row: StoredRunRow | undefined): DurableRunStatusFile | undefined {
  return parseStatus(parseStoredJson(row?.status_json ?? null));
}

function hydrateCheckpoint(row: StoredRunRow | undefined): DurableRunCheckpointFile | undefined {
  return parseCheckpoint(parseStoredJson(row?.checkpoint_json ?? null));
}

export function resolveDurableRunPaths(runsRoot: string, runId: string): DurableRunPaths {
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

export function createDurableRunManifest(input: {
  id: string;
  kind: DurableRunKind;
  resumePolicy: DurableRunResumePolicy;
  createdAt?: string;
  spec?: Record<string, unknown>;
  parentId?: string;
  rootId?: string;
  source?: DurableRunManifest['source'];
}): DurableRunManifest {
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

export function createInitialDurableRunStatus(input: {
  runId: string;
  status?: DurableRunStatus;
  createdAt?: string;
  updatedAt?: string;
  activeAttempt?: number;
  startedAt?: string;
  completedAt?: string;
  checkpointKey?: string;
  lastError?: string;
}): DurableRunStatusFile {
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

export function saveDurableRunManifest(path: string, manifest: DurableRunManifest): void {
  const { runId, dbPath } = parseRunStoragePath(path);
  const db = openRuntimeDb(dbPath);
  db.prepare(`
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
  `).run({
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

export function loadDurableRunManifest(path: string): DurableRunManifest | undefined {
  const { runId, runsRoot } = parseRunStoragePath(path);
  return hydrateManifest(selectRunRow(runsRoot, runId));
}

export function saveDurableRunStatus(path: string, status: DurableRunStatusFile): void {
  const { runId, dbPath } = parseRunStoragePath(path);
  const db = openRuntimeDb(dbPath);
  db.prepare(`
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
  `).run({
    run_id: runId,
    status_json: serializeJson(status),
    status_status: status.status,
    status_updated_at: status.updatedAt,
    status_completed_at: status.completedAt ?? null,
  });
}

export function loadDurableRunStatus(path: string): DurableRunStatusFile | undefined {
  const { runId, runsRoot } = parseRunStoragePath(path);
  return hydrateStatus(selectRunRow(runsRoot, runId));
}

export function saveDurableRunCheckpoint(path: string, checkpoint: DurableRunCheckpointFile): void {
  const { runId, dbPath } = parseRunStoragePath(path);
  const db = openRuntimeDb(dbPath);
  db.prepare(`
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
  `).run({
    run_id: runId,
    checkpoint_json: serializeJson(checkpoint),
    checkpoint_updated_at: checkpoint.updatedAt,
    checkpoint_step: checkpoint.step ?? null,
  });
}

export function loadDurableRunCheckpoint(path: string): DurableRunCheckpointFile | undefined {
  const { runId, runsRoot } = parseRunStoragePath(path);
  return hydrateCheckpoint(selectRunRow(runsRoot, runId));
}

export async function appendDurableRunEvent(path: string, event: DurableRunEvent): Promise<void> {
  const { runId, dbPath } = parseRunStoragePath(path);
  const db = openRuntimeDb(dbPath);
  db.prepare('INSERT INTO runs (run_id) VALUES (?) ON CONFLICT(run_id) DO NOTHING').run(runId);
  db.prepare(`
    INSERT INTO run_events (
      run_id,
      timestamp,
      type,
      attempt,
      payload_json
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    runId,
    event.timestamp,
    event.type,
    event.attempt ?? null,
    event.payload ? serializeJson(event.payload) : null,
  );
}

export function readDurableRunEvents(path: string): DurableRunEvent[] {
  const { runId, dbPath } = parseRunStoragePath(path);
  if (!existsSync(dbPath)) {
    return [];
  }

  const db = openRuntimeDb(dbPath);
  const rows = db.prepare(`
    SELECT run_id, timestamp, type, attempt, payload_json
    FROM run_events
    WHERE run_id = ?
    ORDER BY seq ASC
  `).all(runId) as StoredEventRow[];

  return rows
    .map((row) => parseEvent({
      version: 1,
      runId: row.run_id,
      timestamp: row.timestamp,
      type: row.type,
      ...(row.attempt !== null ? { attempt: row.attempt } : {}),
      ...(row.payload_json ? { payload: parseStoredJson<Record<string, unknown>>(row.payload_json) } : {}),
    }))
    .filter((event): event is DurableRunEvent => event !== undefined);
}

export function listDurableRunIds(runsRoot: string): string[] {
  if (!runtimeDbExists(runsRoot)) {
    return [];
  }

  const db = openRuntimeDb(resolveRuntimeDbPathFromRunsRoot(runsRoot));
  const rows = db.prepare('SELECT run_id FROM runs ORDER BY run_id ASC').all() as Array<{ run_id: string }>;
  return rows.map((row) => row.run_id);
}

export function scanDurableRun(runsRoot: string, runId: string): ScannedDurableRun | undefined {
  const row = selectRunRow(runsRoot, runId);
  if (!row) {
    return undefined;
  }

  const paths = resolveDurableRunPaths(runsRoot, runId);
  const manifest = hydrateManifest(row);
  const status = hydrateStatus(row);
  const checkpoint = hydrateCheckpoint(row);
  const problems: string[] = [];

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
    problems,
    recoveryAction: problems.length > 0 ? 'invalid' : determineRecoveryAction(manifest, status),
  } satisfies ScannedDurableRun;
}

export function scanDurableRunsForRecovery(runsRoot: string): ScannedDurableRun[] {
  return selectAllRunRows(runsRoot)
    .map((row) => {
      const runId = row.run_id;
      const paths = resolveDurableRunPaths(runsRoot, runId);
      const manifest = hydrateManifest(row);
      const status = hydrateStatus(row);
      const checkpoint = hydrateCheckpoint(row);
      const problems: string[] = [];

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
        problems,
        recoveryAction: problems.length > 0 ? 'invalid' : determineRecoveryAction(manifest, status),
      } satisfies ScannedDurableRun;
    });
}

export function summarizeScannedDurableRuns(runs: ScannedDurableRun[]): ScannedDurableRunsSummary {
  const recoveryActions: Record<DurableRunRecoveryAction, number> = {
    none: 0,
    resume: 0,
    rerun: 0,
    attention: 0,
    invalid: 0,
  };
  const statuses: Partial<Record<DurableRunStatus, number>> = {};

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

export function collectDescendantRunIds(runsRoot: string, runId: string): string[] {
  const descendants: string[] = [];
  const queue: string[] = [runId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = listChildRunIds(runsRoot, currentId);

    for (const childId of children) {
      descendants.push(childId);
      queue.push(childId);
    }
  }

  return descendants;
}

export function cascadeCancelRun(
  runsRoot: string,
  runId: string,
): string[] {
  const currentStatus = loadDurableRunStatus(join(runsRoot, runId, 'status.json'));
  if (!currentStatus) {
    return [];
  }

  const descendants = collectDescendantRunIds(runsRoot, runId);
  const allIds = [runId, ...descendants];
  const now = new Date().toISOString();

  for (const id of allIds) {
    const idStatusPath = join(runsRoot, id, 'status.json');
    const idStatus = loadDurableRunStatus(idStatusPath);
    if (!idStatus || terminalStatus(idStatus.status)) {
      continue;
    }

    const updatedStatus: DurableRunStatusFile = {
      ...idStatus,
      status: 'cancelled',
      updatedAt: now,
      completedAt: idStatus.completedAt ?? now,
    };

    saveDurableRunStatus(idStatusPath, updatedStatus);
  }

  return allIds;
}

export function hasActiveChildren(runsRoot: string, runId: string): boolean {
  if (!runtimeDbExists(runsRoot)) {
    return false;
  }

  const db = openRuntimeDb(resolveRuntimeDbPathFromRunsRoot(runsRoot));
  const row = db.prepare(`
    SELECT run_id
    FROM runs
    WHERE parent_id = ?
      AND status_status IS NOT NULL
      AND status_status NOT IN ('completed', 'failed', 'cancelled')
    LIMIT 1
  `).get(runId) as { run_id: string } | undefined;

  return Boolean(row);
}

export function deleteDurableRunRecords(runsRoot: string, runIds: string[]): void {
  deleteRunRows(runsRoot, runIds);
}

export function closeDurableRunStoreConnections(): void {
  for (const db of runtimeDbCache.values()) {
    db.close();
  }
  runtimeDbCache.clear();
}
