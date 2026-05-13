import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { getStateRoot } from './runtime/paths.js';

export const DEFERRED_RESUME_STATE_FILE_NAME = 'deferred-resumes-state.json';

export type DeferredResumeStatus = 'scheduled' | 'ready';
export type DeferredResumeKind = 'continue' | 'reminder' | 'task-callback';
export type DeferredResumeAlertLevel = 'none' | 'passive' | 'disruptive';
export type DeferredResumeBehavior = 'steer' | 'followUp';

export interface DeferredResumeDelivery {
  alertLevel: DeferredResumeAlertLevel;
  autoResumeIfOpen: boolean;
  requireAck: boolean;
}

export interface DeferredResumeSource {
  kind: string;
  id?: string;
}

export interface DeferredResumeRecord {
  id: string;
  sessionFile: string;
  prompt: string;
  dueAt: string;
  createdAt: string;
  attempts: number;
  status: DeferredResumeStatus;
  kind: DeferredResumeKind;
  title?: string;
  behavior?: DeferredResumeBehavior;
  delivery: DeferredResumeDelivery;
  source?: DeferredResumeSource;
  readyAt?: string;
}

export interface DeferredResumeStateFile {
  version: 3;
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

function normalizeKind(value: unknown): DeferredResumeKind {
  if (value === 'reminder' || value === 'task-callback') {
    return value;
  }

  return 'continue';
}

function normalizeAlertLevel(value: unknown, fallback: DeferredResumeAlertLevel = 'none'): DeferredResumeAlertLevel {
  if (value === 'passive' || value === 'disruptive' || value === 'none') {
    return value;
  }

  return fallback;
}

function normalizeBehavior(value: unknown): DeferredResumeBehavior | undefined {
  return value === 'steer' || value === 'followUp' ? value : undefined;
}

function parseDelivery(value: unknown, kind: DeferredResumeKind): DeferredResumeDelivery {
  const defaultsByKind: Record<DeferredResumeKind, DeferredResumeDelivery> = {
    continue: {
      alertLevel: 'none',
      autoResumeIfOpen: true,
      requireAck: false,
    },
    reminder: {
      alertLevel: 'disruptive',
      autoResumeIfOpen: true,
      requireAck: true,
    },
    'task-callback': {
      alertLevel: 'disruptive',
      autoResumeIfOpen: true,
      requireAck: true,
    },
  };

  const defaults = defaultsByKind[kind];
  if (!isRecord(value)) {
    return { ...defaults };
  }

  return {
    alertLevel: normalizeAlertLevel(value.alertLevel, defaults.alertLevel),
    autoResumeIfOpen: typeof value.autoResumeIfOpen === 'boolean' ? value.autoResumeIfOpen : defaults.autoResumeIfOpen,
    requireAck: typeof value.requireAck === 'boolean' ? value.requireAck : defaults.requireAck,
  };
}

function parseSource(value: unknown): DeferredResumeSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const kind = toString(value.kind);
  if (!kind) {
    return undefined;
  }

  const source: DeferredResumeSource = { kind };
  const id = toString(value.id);
  if (id) {
    source.id = id;
  }

  return source;
}

export function parseDeferredResumeDelayMs(raw: string): number | undefined {
  const match = raw
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
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
    case 'sec':
    case 'secs':
    case 'second':
    case 'seconds':
      return value * 1_000;
    case 'm':
    case 'min':
    case 'mins':
    case 'minute':
    case 'minutes':
      return value * 60_000;
    case 'h':
    case 'hr':
    case 'hrs':
    case 'hour':
    case 'hours':
      return value * 60 * 60_000;
    case 'd':
    case 'day':
    case 'days':
      return value * 24 * 60 * 60_000;
    default:
      return undefined;
  }
}

function compareDeferredResumeRecords(left: DeferredResumeRecord, right: DeferredResumeRecord): number {
  const leftKey = left.status === 'ready' ? (left.readyAt ?? left.dueAt) : left.dueAt;
  const rightKey = right.status === 'ready' ? (right.readyAt ?? right.dueAt) : right.dueAt;
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
  const kind = normalizeKind(value.kind);
  const readyAt = status === 'ready' ? (normalizeIsoTimestamp(toString(value.readyAt) ?? dueAt) ?? dueAt) : undefined;

  const record: DeferredResumeRecord = {
    id,
    sessionFile,
    prompt,
    dueAt,
    createdAt,
    attempts: toAttempts(value.attempts),
    status,
    kind,
    delivery: parseDelivery(value.delivery, kind),
  };

  const title = toString(value.title);
  if (title) {
    record.title = title;
  }

  const behavior = normalizeBehavior(value.behavior);
  if (behavior) {
    record.behavior = behavior;
  }

  const source = parseSource(value.source);
  if (source) {
    record.source = source;
  }

  if (readyAt) {
    record.readyAt = readyAt;
  }

  return record;
}

function compareDeferredResumeMergePriority(left: DeferredResumeRecord, right: DeferredResumeRecord): number {
  if (left.attempts !== right.attempts) {
    return left.attempts - right.attempts;
  }

  const leftKey = left.status === 'ready' ? (left.readyAt ?? left.dueAt) : left.dueAt;
  const rightKey = right.status === 'ready' ? (right.readyAt ?? right.dueAt) : right.dueAt;
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
  return Object.fromEntries(Object.entries(resumes).sort(([left], [right]) => left.localeCompare(right)));
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
    version: 3,
    resumes: sortResumeIds(resumes),
  };
}

export function mergeDeferredResumeStateDocuments(options: { documents: unknown[] }): DeferredResumeStateFile {
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
      resumes[id] = existing ? mergeDeferredResumeRecord(existing, parsedRecord) : parsedRecord;
    }
  }

  return {
    version: 3,
    resumes: sortResumeIds(resumes),
  };
}

export function createEmptyDeferredResumeState(): DeferredResumeStateFile {
  return {
    version: 3,
    resumes: {},
  };
}

export function resolveDeferredResumeStateFile(stateRoot = getStateRoot()): string {
  return join(stateRoot, 'pi-agent', DEFERRED_RESUME_STATE_FILE_NAME);
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
      version: 3,
      resumes: sortResumeIds(resumes),
    };
  } catch {
    return createEmptyDeferredResumeState();
  }
}

export function saveDeferredResumeState(state: DeferredResumeStateFile, path = resolveDeferredResumeStateFile()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        version: 3,
        resumes: sortResumeIds(state.resumes),
      },
      null,
      2,
    )}\n`,
  );
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
  return getSessionDeferredResumeEntries(state, sessionFile).filter(
    (entry) => entry.status === 'scheduled' && Date.parse(entry.dueAt) <= nowMs,
  );
}

export function activateDeferredResume(state: DeferredResumeStateFile, input: { id: string; at?: Date }): DeferredResumeRecord | undefined {
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
  entry: Omit<DeferredResumeRecord, 'status' | 'readyAt' | 'kind' | 'delivery'> & {
    kind?: DeferredResumeKind;
    delivery?: Partial<DeferredResumeDelivery>;
  },
): DeferredResumeRecord {
  const kind = normalizeKind(entry.kind);
  const delivery = parseDelivery(entry.delivery, kind);
  const record: DeferredResumeRecord = {
    ...entry,
    kind,
    delivery,
    status: 'scheduled',
  };

  state.resumes[record.id] = record;
  return record;
}

export function createReadyDeferredResume(
  state: DeferredResumeStateFile,
  entry: Omit<DeferredResumeRecord, 'status' | 'readyAt' | 'kind' | 'delivery'> & {
    readyAt?: string;
    kind?: DeferredResumeKind;
    delivery?: Partial<DeferredResumeDelivery>;
  },
): DeferredResumeRecord {
  const kind = normalizeKind(entry.kind);
  const delivery = parseDelivery(entry.delivery, kind);
  const readyAt = normalizeIsoTimestamp(entry.readyAt ?? entry.dueAt) ?? entry.dueAt;
  const record: DeferredResumeRecord = {
    ...entry,
    kind,
    delivery,
    status: 'ready',
    readyAt,
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
