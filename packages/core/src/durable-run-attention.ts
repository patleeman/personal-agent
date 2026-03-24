import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getPiAgentStateDir, getStateRoot } from './runtime/paths.js';

export interface DurableRunAttentionStateOptions {
  stateRoot?: string;
}

export interface DurableRunAttentionRecord {
  runId: string;
  attentionSignature: string;
  readAt: string;
}

export interface DurableRunAttentionStateDocument {
  version: 1;
  runs: Record<string, DurableRunAttentionRecord>;
}

function resolveAttentionStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function validateRunId(runId: string): string {
  const normalized = typeof runId === 'string' ? runId.trim() : '';
  if (!normalized) {
    throw new Error('Durable run id must not be empty.');
  }

  return normalized;
}

function validateAttentionSignature(attentionSignature: string): string {
  const normalized = typeof attentionSignature === 'string' ? attentionSignature.trim() : '';
  if (!normalized) {
    throw new Error('Durable run attention signature must not be empty.');
  }

  return normalized;
}

function normalizeIsoTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return new Date(parsed).toISOString();
}

function emptyDocument(): DurableRunAttentionStateDocument {
  return {
    version: 1,
    runs: {},
  };
}

function normalizeRecord(value: unknown, fallbackRunId?: string): DurableRunAttentionRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<DurableRunAttentionRecord>;
  const rawRunId = typeof record.runId === 'string' ? record.runId : fallbackRunId ?? '';
  const runId = typeof rawRunId === 'string' ? rawRunId.trim() : '';

  if (!runId || typeof record.attentionSignature !== 'string' || typeof record.readAt !== 'string') {
    return null;
  }

  try {
    return {
      runId: validateRunId(runId),
      attentionSignature: validateAttentionSignature(record.attentionSignature),
      readAt: normalizeIsoTimestamp(record.readAt, `durable run attention readAt for ${runId}`),
    };
  } catch {
    return null;
  }
}

function normalizeDocument(value: unknown): DurableRunAttentionStateDocument | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const document = value as Partial<DurableRunAttentionStateDocument>;
  if (document.version !== 1 || !document.runs || typeof document.runs !== 'object') {
    return null;
  }

  const runs: Record<string, DurableRunAttentionRecord> = {};
  for (const [runId, record] of Object.entries(document.runs)) {
    const normalized = normalizeRecord(record, runId);
    if (!normalized) {
      continue;
    }

    runs[normalized.runId] = normalized;
  }

  return {
    version: 1,
    runs: sortRuns(runs),
  };
}

function sortRuns(runs: Record<string, DurableRunAttentionRecord>): Record<string, DurableRunAttentionRecord> {
  return Object.fromEntries(
    Object.entries(runs)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function resolveDurableRunAttentionStatePath(options: DurableRunAttentionStateOptions = {}): string {
  return join(getPiAgentStateDir(resolveAttentionStateRoot(options.stateRoot)), 'state', 'durable-run-attention.json');
}

export function loadDurableRunAttentionState(options: DurableRunAttentionStateOptions = {}): DurableRunAttentionStateDocument {
  const path = resolveDurableRunAttentionStatePath(options);
  if (!existsSync(path)) {
    return emptyDocument();
  }

  try {
    return normalizeDocument(JSON.parse(readFileSync(path, 'utf-8')) as unknown) ?? emptyDocument();
  } catch {
    return emptyDocument();
  }
}

export function saveDurableRunAttentionState(options: DurableRunAttentionStateOptions & { document: DurableRunAttentionStateDocument }): string {
  if (options.document.version !== 1) {
    throw new Error('Durable run attention document version must be 1.');
  }

  const runs: Record<string, DurableRunAttentionRecord> = {};
  for (const [runId, value] of Object.entries(options.document.runs)) {
    const normalized = normalizeRecord(value, runId);
    if (!normalized) {
      continue;
    }

    runs[normalized.runId] = normalized;
  }

  const path = resolveDurableRunAttentionStatePath(options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, runs: sortRuns(runs) }, null, 2)}\n`);
  return path;
}

export function markDurableRunAttentionRead(options: DurableRunAttentionStateOptions & {
  runId: string;
  attentionSignature: string;
  readAt?: string;
}): DurableRunAttentionStateDocument {
  const runId = validateRunId(options.runId);
  const attentionSignature = validateAttentionSignature(options.attentionSignature);
  const readAt = normalizeIsoTimestamp(options.readAt ?? new Date().toISOString(), `durable run attention readAt for ${runId}`);
  const document = loadDurableRunAttentionState(options);

  document.runs[runId] = {
    runId,
    attentionSignature,
    readAt,
  };

  saveDurableRunAttentionState({
    stateRoot: options.stateRoot,
    document,
  });

  return document;
}

export function markDurableRunAttentionUnread(options: DurableRunAttentionStateOptions & { runId: string }): DurableRunAttentionStateDocument {
  const runId = validateRunId(options.runId);
  const document = loadDurableRunAttentionState(options);

  if (document.runs[runId]) {
    delete document.runs[runId];
    saveDurableRunAttentionState({
      stateRoot: options.stateRoot,
      document,
    });
  }

  return document;
}

export function isDurableRunAttentionDismissed(options: DurableRunAttentionStateOptions & {
  runId: string;
  attentionSignature: string;
}): boolean {
  const runId = validateRunId(options.runId);
  const attentionSignature = validateAttentionSignature(options.attentionSignature);
  const document = loadDurableRunAttentionState(options);

  return document.runs[runId]?.attentionSignature === attentionSignature;
}
