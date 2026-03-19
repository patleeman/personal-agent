import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getStateRoot } from './runtime/paths.js';

export const DEFERRED_RESUME_STATE_FILE_NAME = 'deferred-resumes-state.json';

export type DeferredResumeStatus = 'scheduled' | 'ready';

export interface DeferredResumeRecord {
  id: string;
  sessionFile: string;
  prompt: string;
  dueAt: string;
  createdAt: string;
  attempts: number;
  status: DeferredResumeStatus;
  readyAt?: string;
}

export interface DeferredResumeStateFile {
  version: 2;
  resumes: Record<string, DeferredResumeRecord>;
}

interface LegacyDeferredResumeRecord {
  id: string;
  sessionFile: string;
  prompt: string;
  dueAt: string;
  createdAt: string;
  attempts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toAttempts(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  return 0;
}

function normalizeIsoTimestamp(value: string): string | undefined {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return undefined;
  }

  return new Date(parsedMs).toISOString();
}

function normalizeStatus(value: unknown): DeferredResumeStatus {
  return value === 'ready' ? 'ready' : 'scheduled';
}

export function parseDeferredResumeDelayMs(raw: string): number | undefined {
  const match = raw.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  switch (unit) {
    case 's':
      return value * 1_000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 60 * 60_000;
    case 'd':
      return value * 24 * 60 * 60_000;
    default:
      return undefined;
  }
}

function compareDeferredResumeRecords(left: DeferredResumeRecord, right: DeferredResumeRecord): number {
  const leftKey = left.status === 'ready' ? left.readyAt ?? left.dueAt : left.dueAt;
  const rightKey = right.status === 'ready' ? right.readyAt ?? right.dueAt : right.dueAt;
  const timeCompare = Date.parse(leftKey) - Date.parse(rightKey);
  if (timeCompare !== 0) {
    return timeCompare;
  }

  return left.id.localeCompare(right.id);
}

function parseRecord(value: unknown): DeferredResumeRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = toString(value.id);
  const sessionFile = toString(value.sessionFile);
  const prompt = toString(value.prompt);
  const dueAtRaw = toString(value.dueAt);

  if (!id || !sessionFile || !prompt || !dueAtRaw) {
    return undefined;
  }

  const dueAt = normalizeIsoTimestamp(dueAtRaw);
  if (!dueAt) {
    return undefined;
  }

  const createdAt = normalizeIsoTimestamp(toString(value.createdAt) ?? dueAt) ?? dueAt;
  const status = normalizeStatus(value.status);
  const readyAt = status === 'ready'
    ? normalizeIsoTimestamp(toString(value.readyAt) ?? dueAt) ?? dueAt
    : undefined;

  const record: DeferredResumeRecord = {
    id,
    sessionFile,
    prompt,
    dueAt,
    createdAt,
    attempts: toAttempts(value.attempts),
    status,
  };

  if (readyAt) {
    record.readyAt = readyAt;
  }

  return record;
}

function compareDeferredResumeMergePriority(left: DeferredResumeRecord, right: DeferredResumeRecord): number {
  if (left.attempts !== right.attempts) {
    return left.attempts - right.attempts;
  }

  const leftKey = left.status === 'ready' ? left.readyAt ?? left.dueAt : left.dueAt;
  const rightKey = right.status === 'ready' ? right.readyAt ?? right.dueAt : right.dueAt;
  const timeCompare = leftKey.localeCompare(rightKey);
  if (timeCompare !== 0) {
    return timeCompare;
  }

  if (left.status !== right.status) {
    return left.status === 'ready' ? 1 : -1;
  }

  const createdCompare = left.createdAt.localeCompare(right.createdAt);
  if (createdCompare !== 0) {
    return createdCompare;
  }

  const sessionCompare = left.sessionFile.localeCompare(right.sessionFile);
  if (sessionCompare !== 0) {
    return sessionCompare;
  }

  return left.prompt.localeCompare(right.prompt);
}

function mergeDeferredResumeRecord(left: DeferredResumeRecord, right: DeferredResumeRecord): DeferredResumeRecord {
  if (left.id !== right.id) {
    throw new Error('Cannot merge deferred resume records with different ids.');
  }

  const dominant = compareDeferredResumeMergePriority(left, right) >= 0 ? left : right;
  const createdAt = left.createdAt <= right.createdAt ? left.createdAt : right.createdAt;

  return {
    ...dominant,
    id: left.id,
    createdAt,
    attempts: Math.max(left.attempts, right.attempts),
  };
}

function sortResumeIds(resumes: Record<string, DeferredResumeRecord>): Record<string, DeferredResumeRecord> {
  return Object.fromEntries(
    Object.entries(resumes)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeDocument(value: unknown): DeferredResumeStateFile | null {
  if (!isRecord(value) || !isRecord(value.resumes)) {
    return null;
  }

  const resumes: Record<string, DeferredResumeRecord> = {};
  for (const [id, record] of Object.entries(value.resumes)) {
    const legacyRecord = record as LegacyDeferredResumeRecord | undefined;
    const parsedRecord = parseRecord({
      id,
      ...legacyRecord,
      status: isRecord(record) && record.status ? record.status : 'scheduled',
    });
    if (!parsedRecord) {
      continue;
    }

    resumes[parsedRecord.id] = parsedRecord;
  }

  return {
    version: 2,
    resumes: sortResumeIds(resumes),
  };
}

export function mergeDeferredResumeStateDocuments(options: {
  documents: unknown[];
}): DeferredResumeStateFile {
  const documents = options.documents
    .map((document) => normalizeDocument(document))
    .filter((document): document is DeferredResumeStateFile => document !== null);

  if (documents.length === 0) {
    return createEmptyDeferredResumeState();
  }

  const resumes: Record<string, DeferredResumeRecord> = {};

  for (const document of documents) {
    for (const [id, record] of Object.entries(document.resumes)) {
      const parsedRecord = parseRecord(record);
      if (!parsedRecord) {
        continue;
      }

      const existing = resumes[id];
      resumes[id] = existing
        ? mergeDeferredResumeRecord(existing, parsedRecord)
        : parsedRecord;
    }
  }

  return {
    version: 2,
    resumes: sortResumeIds(resumes),
  };
}

export function createEmptyDeferredResumeState(): DeferredResumeStateFile {
  return {
    version: 2,
    resumes: {},
  };
}

export function resolveDeferredResumeStateFile(): string {
  return join(getStateRoot(), 'pi-agent', DEFERRED_RESUME_STATE_FILE_NAME);
}

export function loadDeferredResumeState(path = resolveDeferredResumeStateFile()): DeferredResumeStateFile {
  if (!existsSync(path)) {
    return createEmptyDeferredResumeState();
  }

  try {
    const raw = readFileSync(path, 'utf-8').trim();
    if (raw.length === 0) {
      return createEmptyDeferredResumeState();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.resumes)) {
      return createEmptyDeferredResumeState();
    }

    const resumes: Record<string, DeferredResumeRecord> = {};
    for (const value of Object.values(parsed.resumes)) {
      const legacyRecord = value as LegacyDeferredResumeRecord | undefined;
      const parsedRecord = parseRecord({
        ...legacyRecord,
        status: isRecord(value) && value.status ? value.status : 'scheduled',
      });
      if (!parsedRecord) {
        continue;
      }

      resumes[parsedRecord.id] = parsedRecord;
    }

    return {
      version: 2,
      resumes: sortResumeIds(resumes),
    };
  } catch {
    return createEmptyDeferredResumeState();
  }
}

export function saveDeferredResumeState(state: DeferredResumeStateFile, path = resolveDeferredResumeStateFile()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({
    version: 2,
    resumes: sortResumeIds(state.resumes),
  }, null, 2)}\n`);
}

export function loadDeferredResumeEntries(stateFile = resolveDeferredResumeStateFile()): Array<{ sessionFile: string }> {
  const state = loadDeferredResumeState(stateFile);
  return Object.values(state.resumes).map((record) => ({ sessionFile: record.sessionFile }));
}

export function listDeferredResumeRecords(state: DeferredResumeStateFile): DeferredResumeRecord[] {
  return Object.values(state.resumes).sort(compareDeferredResumeRecords);
}

export function getSessionDeferredResumeEntries(state: DeferredResumeStateFile, sessionFile: string): DeferredResumeRecord[] {
  return listDeferredResumeRecords(state).filter((entry) => entry.sessionFile === sessionFile);
}

export function getReadySessionDeferredResumeEntries(state: DeferredResumeStateFile, sessionFile: string): DeferredResumeRecord[] {
  return getSessionDeferredResumeEntries(state, sessionFile).filter((entry) => entry.status === 'ready');
}

export function getDueScheduledSessionDeferredResumeEntries(
  state: DeferredResumeStateFile,
  sessionFile: string,
  at = new Date(),
): DeferredResumeRecord[] {
  const nowMs = at.getTime();
  return getSessionDeferredResumeEntries(state, sessionFile)
    .filter((entry) => entry.status === 'scheduled' && Date.parse(entry.dueAt) <= nowMs);
}

export function activateDeferredResume(
  state: DeferredResumeStateFile,
  input: { id: string; at?: Date },
): DeferredResumeRecord | undefined {
  const current = state.resumes[input.id];
  if (!current) {
    return undefined;
  }

  if (current.status === 'ready') {
    return { ...current };
  }

  current.status = 'ready';
  current.readyAt = (input.at ?? new Date()).toISOString();
  return { ...current };
}

export function activateDueDeferredResumes(
  state: DeferredResumeStateFile,
  input?: { at?: Date; sessionFile?: string },
): DeferredResumeRecord[] {
  const at = input?.at ?? new Date();
  const nowMs = at.getTime();
  const activated: DeferredResumeRecord[] = [];

  for (const entry of listDeferredResumeRecords(state)) {
    if (input?.sessionFile && entry.sessionFile !== input.sessionFile) {
      continue;
    }

    if (entry.status !== 'scheduled') {
      continue;
    }

    if (Date.parse(entry.dueAt) > nowMs) {
      continue;
    }

    const activatedEntry = activateDeferredResume(state, {
      id: entry.id,
      at,
    });
    if (activatedEntry) {
      activated.push(activatedEntry);
    }
  }

  return activated.sort(compareDeferredResumeRecords);
}

export function scheduleDeferredResume(
  state: DeferredResumeStateFile,
  entry: Omit<DeferredResumeRecord, 'status' | 'readyAt'>,
): DeferredResumeRecord {
  const record: DeferredResumeRecord = {
    ...entry,
    status: 'scheduled',
  };

  state.resumes[record.id] = record;
  return record;
}

export function removeDeferredResume(state: DeferredResumeStateFile, id: string): boolean {
  if (!state.resumes[id]) {
    return false;
  }

  delete state.resumes[id];
  return true;
}

export function retryDeferredResume(
  state: DeferredResumeStateFile,
  input: { id: string; dueAt: string },
): DeferredResumeRecord | undefined {
  const current = state.resumes[input.id];
  if (!current) {
    return undefined;
  }

  const dueAt = normalizeIsoTimestamp(input.dueAt);
  if (!dueAt) {
    throw new Error(`Invalid retry dueAt timestamp: ${input.dueAt}`);
  }

  current.attempts += 1;
  current.status = 'scheduled';
  current.dueAt = dueAt;
  delete current.readyAt;
  return { ...current };
}

export function readSessionConversationId(sessionFile: string): string | undefined {
  if (!existsSync(sessionFile)) {
    return undefined;
  }

  try {
    const lines = readFileSync(sessionFile, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      const parsed = JSON.parse(line) as { type?: string; id?: string };
      if (parsed.type === 'session' && typeof parsed.id === 'string' && parsed.id.trim().length > 0) {
        return parsed.id.trim();
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}
