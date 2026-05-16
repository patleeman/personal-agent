import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import type { AlertSeverity } from './alerts.js';
import { getStateRoot } from './runtime/paths.js';

const DEFAULT_RUNTIME_SCOPE = 'shared';

export interface TaskCallbackBinding {
  taskId: string;
  profile: string;
  conversationId: string;
  sessionFile: string;
  createdAt: string;
  updatedAt: string;
  deliverOnSuccess: boolean;
  deliverOnFailure: boolean;
  notifyOnSuccess: AlertSeverity | 'none';
  notifyOnFailure: AlertSeverity | 'none';
  requireAck: boolean;
  autoResumeIfOpen: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return fallback;
}

function requireIsoTimestamp(value: unknown, label: string, fallback: string): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return fallback;
}

function normalizeNotify(value: unknown): AlertSeverity | 'none' {
  if (value === 'passive' || value === 'disruptive' || value === 'none') {
    return value;
  }

  return 'none';
}

function normalizeRuntimeScope(_profile: string): string {
  return DEFAULT_RUNTIME_SCOPE;
}

function resolveStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function parseBinding(value: unknown): TaskCallbackBinding | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const taskId = normalizeOptionalString(value.taskId);
  const profile = normalizeOptionalString(value.profile);
  const conversationId = normalizeOptionalString(value.conversationId);
  const sessionFile = normalizeOptionalString(value.sessionFile);

  if (!taskId || !profile || !conversationId || !sessionFile) {
    return undefined;
  }

  const createdAt = normalizeIsoTimestamp(value.createdAt, new Date().toISOString());
  const updatedAt = normalizeIsoTimestamp(value.updatedAt, createdAt);

  return {
    taskId,
    profile: normalizeRuntimeScope(profile),
    conversationId,
    sessionFile,
    createdAt,
    updatedAt,
    deliverOnSuccess: value.deliverOnSuccess !== false,
    deliverOnFailure: value.deliverOnFailure !== false,
    notifyOnSuccess: normalizeNotify(value.notifyOnSuccess),
    notifyOnFailure: normalizeNotify(value.notifyOnFailure),
    requireAck: value.requireAck !== false,
    autoResumeIfOpen: value.autoResumeIfOpen !== false,
  };
}

export function resolveTaskCallbackBindingsFile(options: { profile: string; stateRoot?: string }): string {
  return join(
    resolveStateRoot(options.stateRoot),
    'pi-agent',
    'state',
    'task-callback-bindings',
    `${normalizeRuntimeScope(options.profile)}.json`,
  );
}

function resolveLegacyTaskCallbackBindingsFile(options: { profile: string; stateRoot?: string }): string | undefined {
  const legacyProfile = options.profile.trim();
  if (!legacyProfile || legacyProfile === DEFAULT_RUNTIME_SCOPE) {
    return undefined;
  }

  return join(resolveStateRoot(options.stateRoot), 'pi-agent', 'state', 'task-callback-bindings', `${legacyProfile}.json`);
}

export function loadTaskCallbackBindings(options: { profile: string; stateRoot?: string }): Record<string, TaskCallbackBinding> {
  const path = resolveTaskCallbackBindingsFile(options);
  const legacyPath = resolveLegacyTaskCallbackBindingsFile(options);
  const readablePath = existsSync(path) ? path : legacyPath && existsSync(legacyPath) ? legacyPath : undefined;
  if (!readablePath) {
    return {};
  }

  try {
    const raw = readFileSync(readablePath, 'utf-8').trim();
    if (raw.length === 0) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.bindings)) {
      return {};
    }

    const bindings: Record<string, TaskCallbackBinding> = {};
    for (const [taskId, value] of Object.entries(parsed.bindings)) {
      const binding = parseBinding(isRecord(value) ? { taskId, ...value } : { taskId });
      if (!binding) {
        continue;
      }

      bindings[taskId] = binding;
    }

    return bindings;
  } catch {
    return {};
  }
}

export function saveTaskCallbackBindings(options: {
  profile: string;
  stateRoot?: string;
  bindings: Record<string, TaskCallbackBinding>;
}): string {
  const path = resolveTaskCallbackBindingsFile(options);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ version: 1, bindings: options.bindings }, null, 2)}\n`);
  return path;
}

export function getTaskCallbackBinding(options: { profile: string; taskId: string; stateRoot?: string }): TaskCallbackBinding | undefined {
  return loadTaskCallbackBindings(options)[options.taskId];
}

export function setTaskCallbackBinding(options: {
  profile: string;
  taskId: string;
  stateRoot?: string;
  conversationId: string;
  sessionFile: string;
  deliverOnSuccess?: boolean;
  deliverOnFailure?: boolean;
  notifyOnSuccess?: AlertSeverity | 'none';
  notifyOnFailure?: AlertSeverity | 'none';
  requireAck?: boolean;
  autoResumeIfOpen?: boolean;
  updatedAt?: string;
}): TaskCallbackBinding {
  const bindings = loadTaskCallbackBindings(options);
  const existing = bindings[options.taskId];
  const timestamp = requireIsoTimestamp(options.updatedAt, 'task callback updatedAt', new Date().toISOString());
  const next: TaskCallbackBinding = {
    taskId: options.taskId,
    profile: normalizeRuntimeScope(options.profile),
    conversationId: options.conversationId,
    sessionFile: options.sessionFile,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    deliverOnSuccess: options.deliverOnSuccess ?? existing?.deliverOnSuccess ?? true,
    deliverOnFailure: options.deliverOnFailure ?? existing?.deliverOnFailure ?? true,
    notifyOnSuccess: options.notifyOnSuccess ?? existing?.notifyOnSuccess ?? 'disruptive',
    notifyOnFailure: options.notifyOnFailure ?? existing?.notifyOnFailure ?? 'disruptive',
    requireAck: options.requireAck ?? existing?.requireAck ?? true,
    autoResumeIfOpen: options.autoResumeIfOpen ?? existing?.autoResumeIfOpen ?? true,
  };

  bindings[options.taskId] = next;
  saveTaskCallbackBindings({ profile: normalizeRuntimeScope(options.profile), stateRoot: options.stateRoot, bindings });
  return next;
}

export function clearTaskCallbackBinding(options: { profile: string; taskId: string; stateRoot?: string }): boolean {
  const bindings = loadTaskCallbackBindings(options);
  if (!bindings[options.taskId]) {
    return false;
  }

  delete bindings[options.taskId];
  saveTaskCallbackBindings({ profile: options.profile, stateRoot: options.stateRoot, bindings });
  return true;
}
