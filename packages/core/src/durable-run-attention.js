import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getPiAgentStateDir, getStateRoot } from './runtime/paths.js';
function resolveAttentionStateRoot(stateRoot) {
  return resolve(stateRoot ?? getStateRoot());
}
function validateRunId(runId) {
  const normalized = typeof runId === 'string' ? runId.trim() : '';
  if (!normalized) {
    throw new Error('Durable run id must not be empty.');
  }
  return normalized;
}
function validateAttentionSignature(attentionSignature) {
  const normalized = typeof attentionSignature === 'string' ? attentionSignature.trim() : '';
  if (!normalized) {
    throw new Error('Durable run attention signature must not be empty.');
  }
  return normalized;
}
function normalizeIsoTimestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return new Date(parsed).toISOString();
}
function emptyDocument() {
  return {
    version: 1,
    runs: {},
  };
}
function normalizeRecord(value, fallbackRunId) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value;
  const rawRunId = typeof record.runId === 'string' ? record.runId : (fallbackRunId ?? '');
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
function normalizeDocument(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const document = value;
  if (document.version !== 1 || !document.runs || typeof document.runs !== 'object') {
    return null;
  }
  const runs = {};
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
function sortRuns(runs) {
  return Object.fromEntries(Object.entries(runs).sort(([left], [right]) => left.localeCompare(right)));
}
export function resolveDurableRunAttentionStatePath(options = {}) {
  return join(getPiAgentStateDir(resolveAttentionStateRoot(options.stateRoot)), 'state', 'durable-run-attention.json');
}
export function loadDurableRunAttentionState(options = {}) {
  const path = resolveDurableRunAttentionStatePath(options);
  if (!existsSync(path)) {
    return emptyDocument();
  }
  try {
    return normalizeDocument(JSON.parse(readFileSync(path, 'utf-8'))) ?? emptyDocument();
  } catch {
    return emptyDocument();
  }
}
export function saveDurableRunAttentionState(options) {
  if (options.document.version !== 1) {
    throw new Error('Durable run attention document version must be 1.');
  }
  const runs = {};
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
export function markDurableRunAttentionRead(options) {
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
export function markDurableRunAttentionUnread(options) {
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
export function isDurableRunAttentionDismissed(options) {
  const runId = validateRunId(options.runId);
  const attentionSignature = validateAttentionSignature(options.attentionSignature);
  const document = loadDurableRunAttentionState(options);
  return document.runs[runId]?.attentionSignature === attentionSignature;
}
