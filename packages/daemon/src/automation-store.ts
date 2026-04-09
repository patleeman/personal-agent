import { openSqliteDatabase, type SqliteDatabase } from '@personal-agent/core';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { loadDaemonConfig } from './config.js';
import { resolveDaemonPaths } from './paths.js';
import { resolveRuntimeDbPath } from './runs/store.js';
import { loadTaskState, type TaskRuntimeState } from './modules/tasks-store.js';
import {
  parseCronExpression,
  parseTaskDefinition,
  type ParsedTaskDefinition,
  type ParsedTaskSchedule,
} from './modules/tasks-parser.js';

export interface StoredAutomation extends ParsedTaskDefinition {
  title: string;
  createdAt: string;
  updatedAt: string;
  legacyFilePath?: string;
}

export interface LegacyAutomationImportIssue {
  filePath: string;
  error: string;
}

export interface AutomationMutationInput {
  id?: string;
  profile: string;
  title: string;
  enabled?: boolean;
  cron?: string | null;
  at?: string | null;
  modelRef?: string | null;
  thinkingLevel?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number | null;
  prompt: string;
}

export interface AutomationSchedulerState {
  lastEvaluatedAt?: string;
}

type StoredAutomationRow = {
  id: string;
  profile: string;
  title: string;
  enabled: number;
  schedule_type: string;
  cron: string | null;
  at: string | null;
  prompt: string;
  cwd: string | null;
  model_ref: string | null;
  thinking_level: string | null;
  timeout_seconds: number;
  created_at: string;
  updated_at: string;
  legacy_file_path: string | null;
};

type AutomationStateRow = {
  automation_id: string;
  running: number;
  running_started_at: string | null;
  active_run_id: string | null;
  last_run_id: string | null;
  last_status: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  last_log_path: string | null;
  last_scheduled_minute: string | null;
  last_attempt_count: number | null;
  one_time_resolved_at: string | null;
  one_time_resolved_status: string | null;
  one_time_completed_at: string | null;
};

const LEGACY_TASK_FILE_SUFFIX = '.task.md';
const dbCache = new Map<string, SqliteDatabase>();

export function closeAutomationDbs(): void {
  for (const db of dbCache.values()) {
    db.close();
  }

  dbCache.clear();
}

function readOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function readRequiredString(value: string | null | undefined, label: string): string {
  const normalized = readOptionalString(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function buildSyntheticAutomationFilePath(id: string): string {
  return `/__automations__/${id}.automation.md`;
}

function automationFileName(input: { id: string; legacyFilePath?: string }): string {
  return input.legacyFilePath ? basename(input.legacyFilePath) : `${input.id}.automation.md`;
}

function slugifyTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return normalized || 'automation';
}

function humanizeLegacyTaskTitle(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[a-z]/, (value) => value.toUpperCase()) || id;
}

function toBooleanInt(value: boolean): number {
  return value ? 1 : 0;
}

function openAutomationDb(dbPath: string = getAutomationDbPath()): SqliteDatabase {
  const resolved = resolve(dbPath);
  const cached = dbCache.get(resolved);
  if (cached) {
    return cached;
  }

  mkdirSync(dirname(resolved), { recursive: true });
  const db = openSqliteDatabase(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      profile TEXT NOT NULL,
      title TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      schedule_type TEXT NOT NULL,
      cron TEXT,
      at TEXT,
      prompt TEXT NOT NULL,
      cwd TEXT,
      model_ref TEXT,
      thinking_level TEXT,
      timeout_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      legacy_file_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_automations_profile_title ON automations(profile, title);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automations_legacy_file_path ON automations(legacy_file_path) WHERE legacy_file_path IS NOT NULL;

    CREATE TABLE IF NOT EXISTS automation_state (
      automation_id TEXT PRIMARY KEY,
      running INTEGER NOT NULL DEFAULT 0,
      running_started_at TEXT,
      active_run_id TEXT,
      last_run_id TEXT,
      last_status TEXT,
      last_run_at TEXT,
      last_success_at TEXT,
      last_failure_at TEXT,
      last_error TEXT,
      last_log_path TEXT,
      last_scheduled_minute TEXT,
      last_attempt_count INTEGER,
      one_time_resolved_at TEXT,
      one_time_resolved_status TEXT,
      one_time_completed_at TEXT,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS legacy_automation_imports (
      legacy_file_path TEXT PRIMARY KEY,
      automation_id TEXT,
      imported_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_legacy_automation_imports_automation_id ON legacy_automation_imports(automation_id);

    CREATE TABLE IF NOT EXISTS automation_scheduler_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const automationColumns = db.prepare('PRAGMA table_info(automations)').all() as Array<{ name?: string }>;
  const automationColumnNames = new Set(automationColumns.map((column) => column.name));
  if (!automationColumnNames.has('thinking_level')) {
    db.exec('ALTER TABLE automations ADD COLUMN thinking_level TEXT');
  }

  dbCache.set(resolved, db);
  return db;
}

function toParsedSchedule(row: StoredAutomationRow): ParsedTaskSchedule {
  if (row.schedule_type === 'cron') {
    const expression = readRequiredString(row.cron, 'cron');
    return {
      type: 'cron',
      expression,
      parsed: parseCronExpression(expression),
    };
  }

  const at = readRequiredString(row.at, 'at');
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) {
    throw new Error(`Invalid automation at timestamp: ${at}`);
  }

  return {
    type: 'at',
    at,
    atMs,
  };
}

function rowToStoredAutomation(row: StoredAutomationRow): StoredAutomation {
  const legacyFilePath = readOptionalString(row.legacy_file_path);
  const filePath = legacyFilePath ?? buildSyntheticAutomationFilePath(row.id);
  return {
    key: row.id,
    filePath,
    fileName: automationFileName({ id: row.id, legacyFilePath }),
    id: row.id,
    title: row.title,
    enabled: row.enabled === 1,
    schedule: toParsedSchedule(row),
    prompt: row.prompt,
    profile: row.profile,
    modelRef: readOptionalString(row.model_ref),
    thinkingLevel: readOptionalString(row.thinking_level),
    cwd: readOptionalString(row.cwd),
    timeoutSeconds: row.timeout_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    legacyFilePath,
  };
}

function rowToRuntimeState(row: AutomationStateRow): TaskRuntimeState {
  return {
    id: row.automation_id,
    filePath: buildSyntheticAutomationFilePath(row.automation_id),
    scheduleType: 'cron',
    running: row.running === 1,
    runningStartedAt: readOptionalString(row.running_started_at),
    activeRunId: readOptionalString(row.active_run_id),
    lastRunId: readOptionalString(row.last_run_id),
    lastStatus: readOptionalString(row.last_status) as TaskRuntimeState['lastStatus'],
    lastRunAt: readOptionalString(row.last_run_at),
    lastSuccessAt: readOptionalString(row.last_success_at),
    lastFailureAt: readOptionalString(row.last_failure_at),
    lastError: readOptionalString(row.last_error),
    lastLogPath: readOptionalString(row.last_log_path),
    lastScheduledMinute: readOptionalString(row.last_scheduled_minute),
    lastAttemptCount: typeof row.last_attempt_count === 'number' ? row.last_attempt_count : undefined,
    oneTimeResolvedAt: readOptionalString(row.one_time_resolved_at),
    oneTimeResolvedStatus: readOptionalString(row.one_time_resolved_status) as TaskRuntimeState['oneTimeResolvedStatus'],
    oneTimeCompletedAt: readOptionalString(row.one_time_completed_at),
  };
}

function collectLegacyTaskFiles(taskDir: string): string[] {
  if (!existsSync(taskDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [resolve(taskDir)];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(LEGACY_TASK_FILE_SUFFIX)) {
        output.push(fullPath);
      }
    }
  }

  output.sort();
  return output;
}

function readStoredAutomationRows(db: SqliteDatabase, profile?: string): StoredAutomationRow[] {
  if (profile) {
    return db.prepare(`
      SELECT id, profile, title, enabled, schedule_type, cron, at, prompt, cwd, model_ref, thinking_level, timeout_seconds, created_at, updated_at, legacy_file_path
      FROM automations
      WHERE profile = ?
      ORDER BY title COLLATE NOCASE ASC, created_at ASC, id ASC
    `).all(profile) as StoredAutomationRow[];
  }

  return db.prepare(`
    SELECT id, profile, title, enabled, schedule_type, cron, at, prompt, cwd, model_ref, thinking_level, timeout_seconds, created_at, updated_at, legacy_file_path
    FROM automations
    ORDER BY profile ASC, title COLLATE NOCASE ASC, created_at ASC, id ASC
  `).all() as StoredAutomationRow[];
}

function nextAutomationId(db: SqliteDatabase, title: string, preferredId?: string): string {
  const explicit = readOptionalString(preferredId);
  if (explicit) {
    const existing = db.prepare('SELECT id FROM automations WHERE id = ?').get(explicit) as { id: string } | undefined;
    if (!existing) {
      return explicit;
    }
    throw new Error(`Automation already exists: ${explicit}`);
  }

  const slug = slugifyTitle(title);
  for (let index = 0; index < 12; index += 1) {
    const candidate = `${slug}-${randomUUID().slice(0, 8)}`;
    const existing = db.prepare('SELECT id FROM automations WHERE id = ?').get(candidate) as { id: string } | undefined;
    if (!existing) {
      return candidate;
    }
  }

  throw new Error('Could not allocate a unique automation id.');
}

function normalizeMutationInput(input: AutomationMutationInput): Required<Pick<AutomationMutationInput, 'profile' | 'title' | 'prompt'>> & {
  id?: string;
  enabled: boolean;
  cron?: string;
  at?: string;
  modelRef?: string;
  thinkingLevel?: string;
  cwd?: string;
  timeoutSeconds: number;
} {
  const profile = readRequiredString(input.profile, 'profile');
  const title = readRequiredString(input.title, 'title');
  const prompt = readRequiredString(input.prompt, 'prompt');
  const cron = readOptionalString(input.cron ?? undefined);
  const at = readOptionalString(input.at ?? undefined);
  if (Boolean(cron) === Boolean(at)) {
    throw new Error('Provide exactly one of cron or at.');
  }

  const timeoutSeconds = input.timeoutSeconds == null
    ? loadDaemonConfig().modules.tasks.defaultTimeoutSeconds
    : Math.max(1, Math.floor(input.timeoutSeconds));

  if (cron) {
    parseCronExpression(cron);
  }
  if (at && !Number.isFinite(Date.parse(at))) {
    throw new Error(`Invalid at timestamp: ${at}`);
  }

  return {
    id: readOptionalString(input.id ?? undefined),
    profile,
    title,
    prompt,
    enabled: input.enabled ?? true,
    cron,
    at,
    modelRef: readOptionalString(input.modelRef ?? undefined),
    thinkingLevel: readOptionalString(input.thinkingLevel ?? undefined),
    cwd: readOptionalString(input.cwd ?? undefined),
    timeoutSeconds,
  };
}

export function getAutomationDbPath(config = loadDaemonConfig()): string {
  return resolveRuntimeDbPath(resolveDaemonPaths(config.ipc.socketPath).root);
}

export function listStoredAutomations(options: { profile?: string; dbPath?: string } = {}): StoredAutomation[] {
  const db = openAutomationDb(options.dbPath);
  return readStoredAutomationRows(db, options.profile).map(rowToStoredAutomation);
}

export function getStoredAutomation(id: string, options: { profile?: string; dbPath?: string } = {}): StoredAutomation | undefined {
  const db = openAutomationDb(options.dbPath);
  const row = db.prepare(`
    SELECT id, profile, title, enabled, schedule_type, cron, at, prompt, cwd, model_ref, thinking_level, timeout_seconds, created_at, updated_at, legacy_file_path
    FROM automations
    WHERE id = ?
  `).get(id) as StoredAutomationRow | undefined;
  if (!row) {
    return undefined;
  }
  if (options.profile && row.profile !== options.profile) {
    return undefined;
  }
  return rowToStoredAutomation(row);
}

export function createStoredAutomation(input: AutomationMutationInput & { dbPath?: string }): StoredAutomation {
  const db = openAutomationDb(input.dbPath);
  const normalized = normalizeMutationInput(input);
  const id = nextAutomationId(db, normalized.title, normalized.id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO automations (
      id, profile, title, enabled, schedule_type, cron, at, prompt, cwd, model_ref, thinking_level, timeout_seconds, created_at, updated_at, legacy_file_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    id,
    normalized.profile,
    normalized.title,
    toBooleanInt(normalized.enabled),
    normalized.cron ? 'cron' : 'at',
    normalized.cron ?? null,
    normalized.at ?? null,
    normalized.prompt,
    normalized.cwd ?? null,
    normalized.modelRef ?? null,
    normalized.thinkingLevel ?? null,
    normalized.timeoutSeconds,
    now,
    now,
  );

  return getStoredAutomation(id, { dbPath: input.dbPath }) as StoredAutomation;
}

export function updateStoredAutomation(id: string, input: Partial<Omit<AutomationMutationInput, 'id' | 'profile'>> & { profile?: string; dbPath?: string }): StoredAutomation {
  const existing = getStoredAutomation(id, { dbPath: input.dbPath });
  if (!existing) {
    throw new Error(`Automation not found: ${id}`);
  }

  if (input.profile && input.profile !== existing.profile) {
    throw new Error('Cannot change automation profile.');
  }

  const normalized = normalizeMutationInput({
    id: existing.id,
    profile: existing.profile,
    title: input.title ?? existing.title,
    enabled: input.enabled ?? existing.enabled,
    cron: input.cron !== undefined ? input.cron : existing.schedule.type === 'cron' ? existing.schedule.expression : undefined,
    at: input.at !== undefined ? input.at : existing.schedule.type === 'at' ? existing.schedule.at : undefined,
    modelRef: input.modelRef !== undefined ? input.modelRef : existing.modelRef,
    thinkingLevel: input.thinkingLevel !== undefined ? input.thinkingLevel : existing.thinkingLevel,
    cwd: input.cwd !== undefined ? input.cwd : existing.cwd,
    timeoutSeconds: input.timeoutSeconds !== undefined ? input.timeoutSeconds : existing.timeoutSeconds,
    prompt: input.prompt ?? existing.prompt,
  });

  const db = openAutomationDb(input.dbPath);
  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE automations
    SET title = ?, enabled = ?, schedule_type = ?, cron = ?, at = ?, prompt = ?, cwd = ?, model_ref = ?, thinking_level = ?, timeout_seconds = ?, updated_at = ?
    WHERE id = ?
  `).run(
    normalized.title,
    toBooleanInt(normalized.enabled),
    normalized.cron ? 'cron' : 'at',
    normalized.cron ?? null,
    normalized.at ?? null,
    normalized.prompt,
    normalized.cwd ?? null,
    normalized.modelRef ?? null,
    normalized.thinkingLevel ?? null,
    normalized.timeoutSeconds,
    updatedAt,
    id,
  );

  return getStoredAutomation(id, { dbPath: input.dbPath }) as StoredAutomation;
}

export function deleteStoredAutomation(id: string, options: { profile?: string; dbPath?: string } = {}): boolean {
  const existing = getStoredAutomation(id, options);
  if (!existing) {
    return false;
  }

  const db = openAutomationDb(options.dbPath);
  const result = db.prepare('DELETE FROM automations WHERE id = ?').run(id);

  if (result.changes > 0 && existing.legacyFilePath) {
    rmSync(existing.legacyFilePath, { force: true });
  }

  return result.changes > 0;
}

export function loadAutomationRuntimeStateMap(options: { dbPath?: string } = {}): Record<string, TaskRuntimeState> {
  const db = openAutomationDb(options.dbPath);
  const rows = db.prepare(`
    SELECT automation_id, running, running_started_at, active_run_id, last_run_id, last_status, last_run_at, last_success_at, last_failure_at, last_error, last_log_path, last_scheduled_minute, last_attempt_count, one_time_resolved_at, one_time_resolved_status, one_time_completed_at
    FROM automation_state
  `).all() as AutomationStateRow[];

  const automations = new Map(listStoredAutomations({ dbPath: options.dbPath }).map((automation) => [automation.id, automation]));
  const output: Record<string, TaskRuntimeState> = {};
  for (const row of rows) {
    const record = rowToRuntimeState(row);
    const automation = automations.get(row.automation_id);
    record.filePath = automation?.legacyFilePath ?? automation?.filePath ?? buildSyntheticAutomationFilePath(row.automation_id);
    record.scheduleType = automation?.schedule.type ?? 'cron';
    output[row.automation_id] = record;
  }
  return output;
}

export function loadAutomationSchedulerState(options: { dbPath?: string } = {}): AutomationSchedulerState {
  const db = openAutomationDb(options.dbPath);
  const rows = db.prepare('SELECT key, value FROM automation_scheduler_state').all() as Array<{ key: string; value: string | null }>;
  const output: AutomationSchedulerState = {};
  for (const row of rows) {
    if (row.key === 'lastEvaluatedAt') {
      output.lastEvaluatedAt = readOptionalString(row.value);
    }
  }
  return output;
}

export function saveAutomationSchedulerState(state: AutomationSchedulerState, options: { dbPath?: string } = {}): void {
  const db = openAutomationDb(options.dbPath);
  const upsert = db.prepare(`
    INSERT INTO automation_scheduler_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  upsert.run('lastEvaluatedAt', state.lastEvaluatedAt ?? null);
}

export function saveAutomationRuntimeStateMap(state: Record<string, TaskRuntimeState>, options: { dbPath?: string } = {}): void {
  const db = openAutomationDb(options.dbPath);
  const knownAutomationIds = new Set(listStoredAutomations({ dbPath: options.dbPath }).map((automation) => automation.id));
  const rows = Object.values(state).filter((record) => knownAutomationIds.has(record.id));
  const nextIds = new Set(rows.map((record) => record.id));

  const upsert = db.prepare(`
    INSERT INTO automation_state (
      automation_id, running, running_started_at, active_run_id, last_run_id, last_status, last_run_at, last_success_at, last_failure_at, last_error, last_log_path, last_scheduled_minute, last_attempt_count, one_time_resolved_at, one_time_resolved_status, one_time_completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(automation_id) DO UPDATE SET
      running = excluded.running,
      running_started_at = excluded.running_started_at,
      active_run_id = excluded.active_run_id,
      last_run_id = excluded.last_run_id,
      last_status = excluded.last_status,
      last_run_at = excluded.last_run_at,
      last_success_at = excluded.last_success_at,
      last_failure_at = excluded.last_failure_at,
      last_error = excluded.last_error,
      last_log_path = excluded.last_log_path,
      last_scheduled_minute = excluded.last_scheduled_minute,
      last_attempt_count = excluded.last_attempt_count,
      one_time_resolved_at = excluded.one_time_resolved_at,
      one_time_resolved_status = excluded.one_time_resolved_status,
      one_time_completed_at = excluded.one_time_completed_at
  `);

  const tx = db.transaction(() => {
    for (const record of rows) {
      upsert.run(
        record.id,
        toBooleanInt(record.running),
        record.runningStartedAt ?? null,
        record.activeRunId ?? null,
        record.lastRunId ?? null,
        record.lastStatus ?? null,
        record.lastRunAt ?? null,
        record.lastSuccessAt ?? null,
        record.lastFailureAt ?? null,
        record.lastError ?? null,
        record.lastLogPath ?? null,
        record.lastScheduledMinute ?? null,
        record.lastAttemptCount ?? null,
        record.oneTimeResolvedAt ?? null,
        record.oneTimeResolvedStatus ?? null,
        record.oneTimeCompletedAt ?? null,
      );
    }

    const existingRows = db.prepare('SELECT automation_id FROM automation_state').all() as Array<{ automation_id: string }>;
    const remove = db.prepare('DELETE FROM automation_state WHERE automation_id = ?');
    for (const row of existingRows) {
      if (!nextIds.has(row.automation_id) || !knownAutomationIds.has(row.automation_id)) {
        remove.run(row.automation_id);
      }
    }
  });

  tx();
}

export function ensureLegacyTaskImports(options: {
  taskDir: string;
  defaultTimeoutSeconds: number;
  dbPath?: string;
  legacyStateFile?: string;
}): { importedCount: number; parseErrors: LegacyAutomationImportIssue[] } {
  const db = openAutomationDb(options.dbPath);
  const parseErrors: LegacyAutomationImportIssue[] = [];
  const files = collectLegacyTaskFiles(options.taskDir);
  const importedAt = new Date().toISOString();
  const importedPaths = new Set((db.prepare('SELECT legacy_file_path FROM legacy_automation_imports').all() as Array<{ legacy_file_path: string }>).map((row) => row.legacy_file_path));
  let importedCount = 0;

  const insertAutomation = db.prepare(`
    INSERT INTO automations (
      id, profile, title, enabled, schedule_type, cron, at, prompt, cwd, model_ref, thinking_level, timeout_seconds, created_at, updated_at, legacy_file_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const markImported = db.prepare(`
    INSERT INTO legacy_automation_imports (legacy_file_path, automation_id, imported_at)
    VALUES (?, ?, ?)
    ON CONFLICT(legacy_file_path) DO NOTHING
  `);

  const tx = db.transaction(() => {
    for (const filePath of files) {
      if (importedPaths.has(filePath)) {
        continue;
      }

      try {
        const parsed = parseTaskDefinition({
          filePath,
          rawContent: readFileSync(filePath, 'utf-8'),
          defaultTimeoutSeconds: options.defaultTimeoutSeconds,
        });
        const id = nextAutomationId(db, parsed.title ?? humanizeLegacyTaskTitle(parsed.id), parsed.id);
        insertAutomation.run(
          id,
          parsed.profile,
          parsed.title ?? humanizeLegacyTaskTitle(parsed.id),
          toBooleanInt(parsed.enabled),
          parsed.schedule.type,
          parsed.schedule.type === 'cron' ? parsed.schedule.expression : null,
          parsed.schedule.type === 'at' ? parsed.schedule.at : null,
          parsed.prompt,
          parsed.cwd ?? null,
          parsed.modelRef ?? null,
          parsed.thinkingLevel ?? null,
          parsed.timeoutSeconds,
          importedAt,
          importedAt,
          filePath,
        );
        markImported.run(filePath, id, importedAt);
        importedPaths.add(filePath);
        importedCount += 1;
      } catch (error) {
        parseErrors.push({
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  tx();

  const legacyStateFile = options.legacyStateFile ?? join(dirname(options.dbPath ?? getAutomationDbPath()), 'task-state.json');
  if (existsSync(legacyStateFile)) {
    const legacyState = loadTaskState(legacyStateFile);
    const existingStateIds = new Set((db.prepare('SELECT automation_id FROM automation_state').all() as Array<{ automation_id: string }>).map((row) => row.automation_id));
    const automations = listStoredAutomations({ dbPath: options.dbPath });
    const automationById = new Map(automations.map((automation) => [automation.id, automation]));
    const automationByLegacyFilePath = new Map(
      automations.flatMap((automation) => automation.legacyFilePath ? [[resolve(automation.legacyFilePath), automation] as const] : []),
    );

    const upsert = db.prepare(`
      INSERT INTO automation_state (
        automation_id, running, running_started_at, active_run_id, last_run_id, last_status, last_run_at, last_success_at, last_failure_at, last_error, last_log_path, last_scheduled_minute, last_attempt_count, one_time_resolved_at, one_time_resolved_status, one_time_completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(automation_id) DO NOTHING
    `);

    const stateTx = db.transaction(() => {
      for (const record of Object.values(legacyState.tasks)) {
        const automation = automationByLegacyFilePath.get(resolve(record.filePath)) ?? automationById.get(record.id);
        if (!automation || existingStateIds.has(automation.id)) {
          continue;
        }

        upsert.run(
          automation.id,
          toBooleanInt(record.running),
          record.runningStartedAt ?? null,
          record.activeRunId ?? null,
          record.lastRunId ?? null,
          record.lastStatus ?? null,
          record.lastRunAt ?? null,
          record.lastSuccessAt ?? null,
          record.lastFailureAt ?? null,
          record.lastError ?? null,
          record.lastLogPath ?? null,
          record.lastScheduledMinute ?? null,
          record.lastAttemptCount ?? null,
          record.oneTimeResolvedAt ?? null,
          record.oneTimeResolvedStatus ?? null,
          record.oneTimeCompletedAt ?? null,
        );
        existingStateIds.add(automation.id);
      }
    });

    stateTx();
  }

  return {
    importedCount,
    parseErrors,
  };
}
