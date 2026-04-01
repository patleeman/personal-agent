import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { appendFile } from 'fs/promises';
import { dirname, join } from 'path';

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
  // Hierarchy
  parentId?: string;           // parent run ID (root runs have no parent)
  rootId?: string;             // root conversation ID
  // Source attribution
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

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
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

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2));
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
    createdAt: new Date(input.createdAt ?? Date.now()).toISOString(),
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
  const createdAt = new Date(input.createdAt ?? Date.now()).toISOString();

  return {
    version: 1,
    runId: input.runId,
    status: input.status ?? 'queued',
    createdAt,
    updatedAt: new Date(input.updatedAt ?? createdAt).toISOString(),
    activeAttempt: input.activeAttempt ?? 0,
    startedAt: input.startedAt ? new Date(input.startedAt).toISOString() : undefined,
    completedAt: input.completedAt ? new Date(input.completedAt).toISOString() : undefined,
    checkpointKey: input.checkpointKey,
    lastError: input.lastError,
  };
}

export function saveDurableRunManifest(path: string, manifest: DurableRunManifest): void {
  writeJsonFile(path, manifest);
}

export function loadDurableRunManifest(path: string): DurableRunManifest | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return parseManifest(readJsonFile(path));
  } catch {
    return undefined;
  }
}

export function saveDurableRunStatus(path: string, status: DurableRunStatusFile): void {
  writeJsonFile(path, status);
}

export function loadDurableRunStatus(path: string): DurableRunStatusFile | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return parseStatus(readJsonFile(path));
  } catch {
    return undefined;
  }
}

export function saveDurableRunCheckpoint(path: string, checkpoint: DurableRunCheckpointFile): void {
  writeJsonFile(path, checkpoint);
}

export function loadDurableRunCheckpoint(path: string): DurableRunCheckpointFile | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return parseCheckpoint(readJsonFile(path));
  } catch {
    return undefined;
  }
}

export async function appendDurableRunEvent(path: string, event: DurableRunEvent): Promise<void> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(event)}\n`, 'utf-8');
}

export function readDurableRunEvents(path: string): DurableRunEvent[] {
  if (!existsSync(path)) {
    return [];
  }

  const raw = readFileSync(path, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const events: DurableRunEvent[] = [];

  for (const line of lines) {
    try {
      const parsed = parseEvent(JSON.parse(line) as unknown);
      if (parsed) {
        events.push(parsed);
      }
    } catch {
      // Ignore malformed lines so one bad event does not poison the whole journal.
    }
  }

  return events;
}

export function listDurableRunIds(runsRoot: string): string[] {
  if (!existsSync(runsRoot)) {
    return [];
  }

  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function scanDurableRun(runsRoot: string, runId: string): ScannedDurableRun | undefined {
  const paths = resolveDurableRunPaths(runsRoot, runId);
  if (!existsSync(paths.root)) {
    return undefined;
  }
  const manifest = loadDurableRunManifest(paths.manifestPath);
  const status = loadDurableRunStatus(paths.statusPath);
  const checkpoint = loadDurableRunCheckpoint(paths.checkpointPath);
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
  return listDurableRunIds(runsRoot)
    .map((runId) => scanDurableRun(runsRoot, runId))
    .filter((run): run is ScannedDurableRun => run !== undefined);
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

// ---------------------------------------------------------------------------
// Cascade cancel
// ---------------------------------------------------------------------------

/**
 * Collect all descendant run IDs for a given run.
 * Does not include the run itself.
 */
export function collectDescendantRunIds(runsRoot: string, runId: string): string[] {
  const descendants: string[] = [];
  const queue: string[] = [runId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = listDurableRunIds(runsRoot)
      .map((id) => {
        const manifest = loadDurableRunManifest(join(runsRoot, id, 'manifest.json'));
        return manifest?.parentId === currentId ? id : undefined;
      })
      .filter((id): id is string => id !== undefined);

    for (const childId of children) {
      descendants.push(childId);
      queue.push(childId);
    }
  }

  return descendants;
}

/**
 * Cancel a run and all its descendants.
 * Returns the IDs of all cancelled runs.
 */
export function cascadeCancelRun(
  runsRoot: string,
  runId: string,
): string[] {
  // Check if the run exists
  const statusPath = join(runsRoot, runId, 'status.json');
  const currentStatus = loadDurableRunStatus(statusPath);

  if (!currentStatus) {
    return [];
  }

  const descendants = collectDescendantRunIds(runsRoot, runId);
  const allIds = [runId, ...descendants];
  const now = new Date().toISOString();

  for (const id of allIds) {
    const idStatusPath = join(runsRoot, id, 'status.json');
    const idStatus = loadDurableRunStatus(idStatusPath);

    if (!idStatus) {
      continue;
    }

    // Skip if already terminal
    if (terminalStatus(idStatus.status)) {
      continue;
    }

    // Update to cancelled
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

/**
 * Check if a run has any non-terminal children.
 */
export function hasActiveChildren(runsRoot: string, runId: string): boolean {
  return listDurableRunIds(runsRoot)
    .map((id) => {
      const manifest = loadDurableRunManifest(join(runsRoot, id, 'manifest.json'));
      const status = loadDurableRunStatus(join(runsRoot, id, 'status.json'));
      return manifest?.parentId === runId && status && !terminalStatus(status.status);
    })
    .some(Boolean);
}
