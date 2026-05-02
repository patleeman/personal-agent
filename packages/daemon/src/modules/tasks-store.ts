import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export type TaskRunStatus = 'running' | 'success' | 'failed' | 'skipped';

export interface TaskRuntimeState {
  id: string;
  filePath: string;
  scheduleType: 'cron' | 'at';
  running: boolean;
  runningStartedAt?: string;
  activeRunId?: string;
  lastRunId?: string;
  lastStatus?: TaskRunStatus;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  lastLogPath?: string;
  lastScheduledMinute?: string;
  lastAttemptCount?: number;
  oneTimeResolvedAt?: string;
  oneTimeResolvedStatus?: 'success' | 'failed' | 'skipped';
  oneTimeCompletedAt?: string;
}

export interface TaskStateFile {
  version: 1;
  lastEvaluatedAt?: string;
  tasks: Record<string, TaskRuntimeState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toTimestampString(value: unknown): string | undefined {
  const raw = toString(value);
  if (!raw) {
    return undefined;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function toTaskRunStatus(value: unknown): TaskRunStatus | undefined {
  if (value === 'running' || value === 'success' || value === 'failed' || value === 'skipped') {
    return value;
  }

  return undefined;
}

function toOneTimeStatus(value: unknown): TaskRuntimeState['oneTimeResolvedStatus'] | undefined {
  if (value === 'success' || value === 'failed' || value === 'skipped') {
    return value;
  }

  return undefined;
}

function toScheduleType(value: unknown): TaskRuntimeState['scheduleType'] {
  if (value === 'cron' || value === 'at') {
    return value;
  }

  return 'cron';
}

function parseTaskRecord(_key: string, value: unknown): TaskRuntimeState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = toString(value.id);
  const filePath = toString(value.filePath);

  if (!id || !filePath) {
    return undefined;
  }

  return {
    id,
    filePath,
    scheduleType: toScheduleType(value.scheduleType),
    running: toBoolean(value.running) ?? false,
    runningStartedAt: toString(value.runningStartedAt),
    activeRunId: toString(value.activeRunId),
    lastRunId: toString(value.lastRunId),
    lastStatus: toTaskRunStatus(value.lastStatus),
    lastRunAt: toString(value.lastRunAt),
    lastSuccessAt: toString(value.lastSuccessAt),
    lastFailureAt: toString(value.lastFailureAt),
    lastError: toString(value.lastError),
    lastLogPath: toString(value.lastLogPath),
    lastScheduledMinute: toString(value.lastScheduledMinute),
    lastAttemptCount: typeof value.lastAttemptCount === 'number'
      ? value.lastAttemptCount
      : undefined,
    oneTimeResolvedAt: toString(value.oneTimeResolvedAt),
    oneTimeResolvedStatus: toOneTimeStatus(value.oneTimeResolvedStatus),
    oneTimeCompletedAt: toString(value.oneTimeCompletedAt),
  };
}

export function createEmptyTaskState(): TaskStateFile {
  return {
    version: 1,
    tasks: {},
  };
}

export function loadTaskState(
  path: string,
  logger?: { warn: (message: string) => void },
): TaskStateFile {
  if (!existsSync(path)) {
    return createEmptyTaskState();
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed) || !isRecord(parsed.tasks)) {
      return createEmptyTaskState();
    }

    const tasks: Record<string, TaskRuntimeState> = {};

    for (const [key, value] of Object.entries(parsed.tasks)) {
      const record = parseTaskRecord(key, value);
      if (!record) {
        continue;
      }

      // Reset stale running flags after daemon restart.
      record.running = false;
      record.runningStartedAt = undefined;
      tasks[key] = record;
    }

    return {
      version: 1,
      lastEvaluatedAt: toTimestampString(parsed.lastEvaluatedAt),
      tasks,
    };
  } catch (error) {
    logger?.warn(`tasks state load failed at ${path}: ${(error as Error).message}`);
    return createEmptyTaskState();
  }
}

export function saveTaskState(path: string, state: TaskStateFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(state, null, 2));
}
