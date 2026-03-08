import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export type SessionDeferredResumeStatus = 'scheduled' | 'running';

export interface SessionDeferredResumeRecord {
  id: string;
  sessionFile: string;
  cwd: string;
  profile?: string;
  prompt: string;
  dueAt: string;
  createdAt: string;
  status: SessionDeferredResumeStatus;
  attempts: number;
  startedAt?: string;
  logPath?: string;
}

export interface SessionDeferredResumeStateFile {
  version: 1;
  resumes: Record<string, SessionDeferredResumeRecord>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeTimestamp(value: string): string | undefined {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return undefined;
  }

  return new Date(parsedMs).toISOString();
}

function toAttempts(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  return 0;
}

function parseRecord(value: unknown): SessionDeferredResumeRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = toString(value.id);
  const sessionFile = toString(value.sessionFile);
  const cwd = toString(value.cwd);
  const prompt = toString(value.prompt);
  const dueAtRaw = toString(value.dueAt);

  if (!id || !sessionFile || !cwd || !prompt || !dueAtRaw) {
    return undefined;
  }

  const dueAt = normalizeTimestamp(dueAtRaw);
  if (!dueAt) {
    return undefined;
  }

  const createdAt = normalizeTimestamp(toString(value.createdAt) ?? dueAt) ?? dueAt;
  const status = value.status === 'running' ? 'running' : 'scheduled';

  return {
    id,
    sessionFile,
    cwd,
    profile: toString(value.profile),
    prompt,
    dueAt,
    createdAt,
    status: status === 'running' ? 'scheduled' : status,
    attempts: toAttempts(value.attempts),
    startedAt: undefined,
    logPath: toString(value.logPath),
  };
}

export function createEmptySessionDeferredResumeState(): SessionDeferredResumeStateFile {
  return {
    version: 1,
    resumes: {},
  };
}

export function loadSessionDeferredResumeState(
  path: string,
  logger?: { warn: (message: string) => void },
): SessionDeferredResumeStateFile {
  if (!existsSync(path)) {
    return createEmptySessionDeferredResumeState();
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed) || !isRecord(parsed.resumes)) {
      return createEmptySessionDeferredResumeState();
    }

    const resumes: Record<string, SessionDeferredResumeRecord> = {};

    for (const value of Object.values(parsed.resumes)) {
      const record = parseRecord(value);
      if (!record) {
        continue;
      }

      resumes[record.id] = record;
    }

    return {
      version: 1,
      resumes,
    };
  } catch (error) {
    logger?.warn(`session deferred resume state load failed at ${path}: ${(error as Error).message}`);
    return createEmptySessionDeferredResumeState();
  }
}

export function saveSessionDeferredResumeState(path: string, state: SessionDeferredResumeStateFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(state, null, 2));
}
