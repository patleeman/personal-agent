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

export type AutomationThreadMode = 'dedicated' | 'existing' | 'none';
export type AutomationTargetType = 'background-agent' | 'conversation';
export type AutomationConversationBehavior = 'steer' | 'followUp';

const MAX_AUTOMATION_DURATION_SECONDS = 7 * 24 * 60 * 60;

export interface StoredAutomation extends ParsedTaskDefinition {
  title: string;
  targetType: AutomationTargetType;
  conversationBehavior?: AutomationConversationBehavior;
  catchUpWindowSeconds?: number;
  createdAt: string;
  updatedAt: string;
  legacyFilePath?: string;
  threadMode: AutomationThreadMode;
  threadSessionFile?: string;
  threadConversationId?: string;
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
  catchUpWindowSeconds?: number | null;
  prompt: string;
  targetType?: AutomationTargetType | null;
  conversationBehavior?: AutomationConversationBehavior | null;
}

export interface AutomationSchedulerState {
  lastEvaluatedAt?: string;
}

export type AutomationActivityKind = 'missed';
export type AutomationActivityOutcome = 'skipped' | 'catch-up-started';

export interface AutomationActivityEntry {
  id: string;
  automationId: string;
  kind: AutomationActivityKind;
  createdAt: string;
  count: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
  exampleScheduledAt: string[];
  outcome: AutomationActivityOutcome;
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
  catch_up_window_seconds: number | null;
  target_type: string | null;
  conversation_behavior: string | null;
  created_at: string;
  updated_at: string;
  legacy_file_path: string | null;
  thread_mode: string | null;
  thread_session_file: string | null;
  thread_conversation_id: string | null;
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
  last_attempt_count: number | string | null;
  one_time_resolved_at: string | null;
  one_time_resolved_status: string | null;
  one_time_completed_at: string | null;
};

type AutomationActivityRow = {
  seq: number;
  automation_id: string;
  kind: string;
  created_at: string;
  payload_json: string | null;
};

const LEGACY_TASK_FILE_SUFFIX = '.task.md';
const AUTOMATION_ACTIVITY_RETENTION_LIMIT = 100;
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

function normalizeIsoTimestamp(raw: string): string | undefined {
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

function readAutomationActivityTimestamp(value: string | null | undefined, label: string): string {
  const raw = readRequiredString(value, label);
  const normalized = normalizeIsoTimestamp(raw);
  if (!normalized) {
    throw new Error(`Automation activity ${label} must be a valid timestamp.`);
  }

  return normalized;
}

function readOptionalPositiveInteger(value: number | null | undefined, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return undefined;
  }

  return value > 0 && value <= max ? value : undefined;
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function buildSyntheticAutomationFilePath(id: string): string {
  return `/__automations__/${id}.automation.md`;
}

function normalizeAutomationThreadMode(value: string | null | undefined): AutomationThreadMode {
  if (value === 'none' || value === 'existing' || value === 'dedicated') {
    return value;
  }

  return 'dedicated';
}

export function normalizeAutomationTargetTypeForSelection(value: string | null | undefined): AutomationTargetType {
  return value === 'conversation' ? 'conversation' : 'background-agent';
}

function readAutomationConversationBehavior(value: string | null | undefined): AutomationConversationBehavior | undefined {
  return value === 'steer' || value === 'followUp' ? value : undefined;
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
      catch_up_window_seconds INTEGER,
      target_type TEXT NOT NULL DEFAULT 'background-agent',
      conversation_behavior TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      legacy_file_path TEXT,
      thread_mode TEXT NOT NULL DEFAULT 'dedicated',
      thread_session_file TEXT,
      thread_conversation_id TEXT
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

    CREATE TABLE IF NOT EXISTS automation_activity (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_automation_activity_automation_id_created_at
      ON automation_activity(automation_id, created_at DESC, seq DESC);
  `);

  const automationColumns = db.prepare('PRAGMA table_info(automations)').all() as Array<{ name?: string }>;
  const automationColumnNames = new Set(automationColumns.map((column) => column.name));
  if (!automationColumnNames.has('thinking_level')) {
    db.exec('ALTER TABLE automations ADD COLUMN thinking_level TEXT');
  }
  if (!automationColumnNames.has('target_type')) {
    db.exec("ALTER TABLE automations ADD COLUMN target_type TEXT NOT NULL DEFAULT 'background-agent'");
  }
  if (!automationColumnNames.has('catch_up_window_seconds')) {
    db.exec('ALTER TABLE automations ADD COLUMN catch_up_window_seconds INTEGER');
  }
  if (!automationColumnNames.has('conversation_behavior')) {
    db.exec('ALTER TABLE automations ADD COLUMN conversation_behavior TEXT');
  }
  if (!automationColumnNames.has('thread_mode')) {
    db.exec("ALTER TABLE automations ADD COLUMN thread_mode TEXT NOT NULL DEFAULT 'dedicated'");
  }
  if (!automationColumnNames.has('thread_session_file')) {
    db.exec('ALTER TABLE automations ADD COLUMN thread_session_file TEXT');
  }
  if (!automationColumnNames.has('thread_conversation_id')) {
    db.exec('ALTER TABLE automations ADD COLUMN thread_conversation_id TEXT');
  }
  db.exec("UPDATE automations SET target_type = 'background-agent' WHERE target_type IS NULL OR trim(target_type) = ''");
  db.exec("UPDATE automations SET conversation_behavior = NULL WHERE conversation_behavior IS NOT NULL AND trim(conversation_behavior) NOT IN ('steer', 'followUp')");
  db.exec("UPDATE automations SET thread_mode = 'dedicated' WHERE thread_mode IS NULL OR trim(thread_mode) = ''");

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
  const normalizedAt = normalizeIsoTimestamp(at);
  if (!normalizedAt) {
    throw new Error(`Invalid automation at timestamp: ${at}`);
  }

  return {
    type: 'at',
    at: normalizedAt,
    atMs: Date.parse(normalizedAt),
  };
}

function rowToStoredAutomation(row: StoredAutomationRow): StoredAutomation {
  const legacyFilePath = readOptionalString(row.legacy_file_path);
  const filePath = legacyFilePath ?? buildSyntheticAutomationFilePath(row.id);
  const createdAt = readOptionalTimestamp(row.created_at) ?? new Date().toISOString();
  const updatedAt = readOptionalTimestamp(row.updated_at) ?? createdAt;
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
    catchUpWindowSeconds: readOptionalPositiveInteger(row.catch_up_window_seconds),
    targetType: normalizeAutomationTargetTypeForSelection(row.target_type),
    conversationBehavior: readAutomationConversationBehavior(row.conversation_behavior),
    createdAt,
    updatedAt,
    legacyFilePath,
    threadMode: normalizeAutomationThreadMode(row.thread_mode),
    threadSessionFile: readOptionalString(row.thread_session_file),
    threadConversationId: readOptionalString(row.thread_conversation_id),
  };
}

function readOptionalTimestamp(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? readOptionalString(value) : undefined;
  if (!raw) {
    return undefined;
  }

  return normalizeIsoTimestamp(raw);
}

function readTaskRunStatus(value: unknown): TaskRuntimeState['lastStatus'] | undefined {
  return value === 'running' || value === 'success' || value === 'failed' || value === 'skipped'
    ? value
    : undefined;
}

function readOneTimeResolvedStatus(value: unknown): TaskRuntimeState['oneTimeResolvedStatus'] | undefined {
  return value === 'success' || value === 'failed' || value === 'skipped'
    ? value
    : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  return undefined;
}

function rowToRuntimeState(row: AutomationStateRow): TaskRuntimeState {
  return {
    id: row.automation_id,
    filePath: buildSyntheticAutomationFilePath(row.automation_id),
    scheduleType: 'cron',
    running: row.running === 1,
    runningStartedAt: readOptionalTimestamp(row.running_started_at),
    activeRunId: readOptionalString(row.active_run_id),
    lastRunId: readOptionalString(row.last_run_id),
    lastStatus: readTaskRunStatus(row.last_status),
    lastRunAt: readOptionalTimestamp(row.last_run_at),
    lastSuccessAt: readOptionalTimestamp(row.last_success_at),
    lastFailureAt: readOptionalTimestamp(row.last_failure_at),
    lastError: readOptionalString(row.last_error),
    lastLogPath: readOptionalString(row.last_log_path),
    lastScheduledMinute: readOptionalString(row.last_scheduled_minute),
    lastAttemptCount: readNonNegativeInteger(row.last_attempt_count),
    oneTimeResolvedAt: readOptionalTimestamp(row.one_time_resolved_at),
    oneTimeResolvedStatus: readOneTimeResolvedStatus(row.one_time_resolved_status),
    oneTimeCompletedAt: readOptionalTimestamp(row.one_time_completed_at),
  };
}

function rowToAutomationActivityEntry(row: AutomationActivityRow): AutomationActivityEntry | undefined {
  const payload = parseJsonRecord(row.payload_json);
  const createdAt = normalizeIsoTimestamp(row.created_at);
  if (!createdAt) {
    return undefined;
  }
  const count = typeof payload?.count === 'number' && Number.isSafeInteger(payload.count) && payload.count > 0
    ? payload.count
    : undefined;
  const firstScheduledAt = typeof payload?.firstScheduledAt === 'string'
    ? normalizeIsoTimestamp(payload.firstScheduledAt)
    : undefined;
  const lastScheduledAt = typeof payload?.lastScheduledAt === 'string'
    ? normalizeIsoTimestamp(payload.lastScheduledAt)
    : undefined;
  const exampleScheduledAt = Array.isArray(payload?.exampleScheduledAt)
    ? payload.exampleScheduledAt
      .flatMap((value) => (typeof value === 'string' ? normalizeIsoTimestamp(value) ?? [] : []))
    : [];
  const outcome = payload?.outcome === 'catch-up-started' || payload?.outcome === 'skipped'
    ? payload.outcome
    : undefined;

  if (row.kind !== 'missed' || !count || !firstScheduledAt || !lastScheduledAt || !outcome) {
    return undefined;
  }

  return {
    id: `${row.automation_id}:${row.seq}`,
    automationId: row.automation_id,
    kind: 'missed',
    createdAt,
    count,
    firstScheduledAt,
    lastScheduledAt,
    exampleScheduledAt,
    outcome,
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
      SELECT id, profile, title, enabled, schedule_type, cron, at, prompt, cwd, model_ref, thinking_level, timeout_seconds, catch_up_window_seconds, target_type, conversation_behavior, created_at, updated_at, legacy_file_path, thread_mode, thread_session_file, thread_conversation_id
      FROM automations
      WHERE profile = ?
      ORDER BY title COLLATE NOCASE ASC, created_at ASC, id ASC
    `).all(profile) as StoredAutomationRow[];
  }

  return db.prepare(`
    SELECT id, profile, title, enabled, schedule_type, cron, at, prompt, cwd, model_ref, thinking_level, timeout_seconds, catch_up_window_seconds, target_type, conversation_behavior, created_at, updated_at, legacy_file_path, thread_mode, thread_session_file, thread_conversation_id
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
  catchUpWindowSeconds?: number;
  targetType: AutomationTargetType;
  conversationBehavior?: AutomationConversationBehavior;
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
    : readOptionalPositiveInteger(input.timeoutSeconds, MAX_AUTOMATION_DURATION_SECONDS);
  if (!timeoutSeconds) {
    throw new Error('timeoutSeconds must be a positive integer.');
  }

  if (cron) {
    parseCronExpression(cron);
  }
  let normalizedAt: string | undefined;
  if (at) {
    normalizedAt = normalizeIsoTimestamp(at);
    if (!normalizedAt) {
      throw new Error(`Invalid at timestamp: ${at}`);
    }
  }

  const targetType = normalizeAutomationTargetTypeForSelection(input.targetType ?? undefined);
  const conversationBehavior = targetType === 'conversation'
    ? readAutomationConversationBehavior(input.conversationBehavior ?? undefined)
    : undefined;
  const catchUpWindowSeconds = !cron || input.catchUpWindowSeconds == null
    ? undefined
    : readOptionalPositiveInteger(input.catchUpWindowSeconds, MAX_AUTOMATION_DURATION_SECONDS);

  if (input.catchUpWindowSeconds != null && cron && !catchUpWindowSeconds) {
    throw new Error('catchUpWindowSeconds must be a positive integer.');
  }

  return {
    id: readOptionalString(input.id ?? undefined),
    profile,
    title,
    prompt,
    enabled: input.enabled ?? true,
    cron,
    at: normalizedAt,
    modelRef: readOptionalString(input.modelRef ?? undefined),
    thinkingLevel: readOptionalString(input.thinkingLevel ?? undefined),
    cwd: readOptionalString(input.cwd ?? undefined),
    timeoutSeconds,
    catchUpWindowSeconds,
    targetType,
    conversationBehavior,
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
    SELECT id, profile, title, enabled, schedule_type, cron, at, prompt, cwd, model_ref, thinking_level, timeout_seconds, catch_up_window_seconds, target_type, conversation_behavior, created_at, updated_at, legacy_file_path, thread_mode, thread_session_file, thread_conversation_id
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
      id, profile, title, enabled, schedule_type, cron, at, prompt, cwd, model_ref, thinking_level, timeout_seconds, catch_up_window_seconds, target_type, conversation_behavior, created_at, updated_at, legacy_file_path, thread_mode, thread_session_file, thread_conversation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'dedicated', NULL, NULL)
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
    normalized.catchUpWindowSeconds ?? null,
    normalized.targetType,
    normalized.conversationBehavior ?? null,
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
    catchUpWindowSeconds: input.catchUpWindowSeconds !== undefined ? input.catchUpWindowSeconds : existing.catchUpWindowSeconds,
    prompt: input.prompt ?? existing.prompt,
    targetType: input.targetType !== undefined ? input.targetType : existing.targetType,
    conversationBehavior: input.conversationBehavior !== undefined ? input.conversationBehavior : existing.conversationBehavior,
  });

  const db = openAutomationDb(input.dbPath);
  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE automations
    SET title = ?, enabled = ?, schedule_type = ?, cron = ?, at = ?, prompt = ?, cwd = ?, model_ref = ?, thinking_level = ?, timeout_seconds = ?, catch_up_window_seconds = ?, target_type = ?, conversation_behavior = ?, updated_at = ?
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
    normalized.catchUpWindowSeconds ?? null,
    normalized.targetType,
    normalized.conversationBehavior ?? null,
    updatedAt,
    id,
  );

  return getStoredAutomation(id, { dbPath: input.dbPath }) as StoredAutomation;
}

export function setStoredAutomationThreadBinding(
  id: string,
  input: {
    mode: AutomationThreadMode;
    conversationId?: string | null;
    sessionFile?: string | null;
    dbPath?: string;
  },
): StoredAutomation {
  const existing = getStoredAutomation(id, { dbPath: input.dbPath });
  if (!existing) {
    throw new Error(`Automation not found: ${id}`);
  }

  const db = openAutomationDb(input.dbPath);
  const updatedAt = new Date().toISOString();
  const mode = normalizeAutomationThreadMode(input.mode);
  const conversationId = mode === 'none' || mode === 'dedicated'
    ? readOptionalString(input.conversationId ?? undefined)
    : readRequiredString(input.conversationId ?? undefined, 'conversationId');
  const sessionFile = mode === 'none' || mode === 'dedicated'
    ? readOptionalString(input.sessionFile ?? undefined)
    : readRequiredString(input.sessionFile ?? undefined, 'sessionFile');

  db.prepare(`
    UPDATE automations
    SET thread_mode = ?, thread_conversation_id = ?, thread_session_file = ?, updated_at = ?
    WHERE id = ?
  `).run(
    mode,
    mode === 'none' ? null : (conversationId ?? null),
    mode === 'none' ? null : (sessionFile ?? null),
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
    SELECT automation_id, running, running_started_at, active_run_id, last_run_id, last_status, last_run_at, last_success_at, last_failure_at, last_error, last_log_path, last_scheduled_minute, CAST(last_attempt_count AS TEXT) AS last_attempt_count, one_time_resolved_at, one_time_resolved_status, one_time_completed_at
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
      output.lastEvaluatedAt = readOptionalTimestamp(row.value);
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

export function listAutomationActivityEntries(
  automationId: string,
  options: { limit?: number; dbPath?: string } = {},
): AutomationActivityEntry[] {
  const normalizedAutomationId = readRequiredString(automationId, 'automationId');
  const db = openAutomationDb(options.dbPath);
  const limit = typeof options.limit === 'number' && Number.isSafeInteger(options.limit) && options.limit > 0
    ? Math.min(200, options.limit)
    : 20;
  const rows = db.prepare(`
    SELECT seq, automation_id, kind, created_at, payload_json
    FROM automation_activity
    WHERE automation_id = ?
    ORDER BY created_at DESC, seq DESC
    LIMIT ?
  `).all(normalizedAutomationId, limit) as AutomationActivityRow[];

  return rows
    .map((row) => rowToAutomationActivityEntry(row))
    .filter((entry): entry is AutomationActivityEntry => entry !== undefined);
}

export function appendAutomationActivityEntry(
  automationId: string,
  input: Omit<AutomationActivityEntry, 'id' | 'automationId'>,
  options: { dbPath?: string } = {},
): AutomationActivityEntry {
  const normalizedAutomationId = readRequiredString(automationId, 'automationId');
  const existing = getStoredAutomation(normalizedAutomationId, { dbPath: options.dbPath });
  if (!existing) {
    throw new Error(`Automation not found: ${normalizedAutomationId}`);
  }

  const createdAt = readAutomationActivityTimestamp(input.createdAt, 'createdAt');
  if (input.kind !== 'missed') {
    throw new Error(`Unsupported automation activity kind: ${input.kind}`);
  }

  if (!Number.isSafeInteger(input.count) || input.count <= 0) {
    throw new Error('Automation activity count must be a positive integer.');
  }

  const firstScheduledAt = readAutomationActivityTimestamp(input.firstScheduledAt, 'firstScheduledAt');
  const lastScheduledAt = readAutomationActivityTimestamp(input.lastScheduledAt, 'lastScheduledAt');
  const exampleScheduledAt = input.exampleScheduledAt
    .flatMap((value) => (typeof value === 'string' ? normalizeIsoTimestamp(value) ?? [] : []));
  if (input.outcome !== 'skipped' && input.outcome !== 'catch-up-started') {
    throw new Error(`Unsupported automation activity outcome: ${input.outcome}`);
  }

  const db = openAutomationDb(options.dbPath);
  const insert = db.prepare(`
    INSERT INTO automation_activity (automation_id, kind, created_at, payload_json)
    VALUES (?, ?, ?, ?)
  `);
  const trim = db.prepare(`
    DELETE FROM automation_activity
    WHERE automation_id = ?
      AND seq NOT IN (
        SELECT seq
        FROM automation_activity
        WHERE automation_id = ?
        ORDER BY created_at DESC, seq DESC
        LIMIT ?
      )
  `);

  let insertedSeq: number | bigint | undefined;
  db.transaction(() => {
    const insertResult = insert.run(
      normalizedAutomationId,
      'missed',
      createdAt,
      JSON.stringify({
        count: input.count,
        firstScheduledAt,
        lastScheduledAt,
        exampleScheduledAt,
        outcome: input.outcome,
      }),
    ) as { lastInsertRowid?: number | bigint };
    insertedSeq = insertResult.lastInsertRowid;
    trim.run(normalizedAutomationId, normalizedAutomationId, AUTOMATION_ACTIVITY_RETENTION_LIMIT);
  })();

  if (insertedSeq === undefined) {
    throw new Error('Failed to allocate automation activity entry id.');
  }

  const row = db.prepare(`
    SELECT seq, automation_id, kind, created_at, payload_json
    FROM automation_activity
    WHERE seq = ?
  `).get(insertedSeq) as AutomationActivityRow | undefined;
  const entry = row ? rowToAutomationActivityEntry(row) : undefined;
  if (!entry) {
    throw new Error('Failed to read automation activity entry after insert.');
  }

  return entry;
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
      id, profile, title, enabled, schedule_type, cron, at, prompt, cwd, model_ref, thinking_level, timeout_seconds, catch_up_window_seconds, target_type, conversation_behavior, created_at, updated_at, legacy_file_path, thread_mode, thread_session_file, thread_conversation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dedicated', NULL, NULL)
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
          null,
          'background-agent',
          null,
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
