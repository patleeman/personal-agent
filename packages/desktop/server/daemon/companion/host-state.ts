import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

interface StoredCompanionHostState {
  hostInstanceId: string;
  hostLabel: string;
}

function normalizeHostLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return hostname();
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, 120) : hostname();
}

function normalizeState(value: unknown): StoredCompanionHostState {
  const candidate = value && typeof value === 'object' ? (value as Partial<StoredCompanionHostState>) : {};

  const hostInstanceId =
    typeof candidate.hostInstanceId === 'string' && candidate.hostInstanceId.trim().length > 0
      ? candidate.hostInstanceId.trim()
      : `host_${randomUUID()}`;

  return {
    hostInstanceId,
    hostLabel: normalizeHostLabel(candidate.hostLabel),
  };
}

export function resolveCompanionHostStateFile(stateRoot: string): string {
  return join(stateRoot, 'companion', 'host-state.json');
}

export function readCompanionHostState(stateRoot: string): StoredCompanionHostState {
  const filePath = resolveCompanionHostStateFile(stateRoot);
  if (!existsSync(filePath)) {
    const created = normalizeState({});
    writeCompanionHostState(stateRoot, created);
    return created;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    const normalized = normalizeState(parsed);
    writeCompanionHostState(stateRoot, normalized);
    return normalized;
  } catch {
    const fallback = normalizeState({});
    writeCompanionHostState(stateRoot, fallback);
    return fallback;
  }
}

export function writeCompanionHostState(stateRoot: string, state: StoredCompanionHostState): StoredCompanionHostState {
  const normalized = normalizeState(state);
  const filePath = resolveCompanionHostStateFile(stateRoot);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
  return normalized;
}

export function updateCompanionHostLabel(stateRoot: string, hostLabel: string): StoredCompanionHostState {
  const current = readCompanionHostState(stateRoot);
  return writeCompanionHostState(stateRoot, {
    ...current,
    hostLabel: normalizeHostLabel(hostLabel),
  });
}
