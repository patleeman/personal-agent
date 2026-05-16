import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getStateRoot } from './runtime/paths.js';
const DEFAULT_RUNTIME_SCOPE = 'shared';
function normalizeRuntimeScope(_profile) {
  return DEFAULT_RUNTIME_SCOPE;
}
function resolveStateRoot(stateRoot) {
  return resolve(stateRoot ?? getStateRoot());
}
function isRecord(value) {
  return typeof value === 'object' && value !== null;
}
function normalizeIsoTimestamp(value, fallback) {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  if (fallback) {
    return fallback;
  }
  return new Date().toISOString();
}
function requireIsoTimestamp(value, label, fallback) {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
    throw new Error(`Invalid ${label}: ${value}`);
  }
  if (fallback) {
    return fallback;
  }
  throw new Error(`${label} is required`);
}
function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
function normalizeSeverity(value) {
  return value === 'passive' ? 'passive' : 'disruptive';
}
function normalizeStatus(value) {
  if (value === 'acknowledged' || value === 'dismissed') {
    return value;
  }
  return 'active';
}
function normalizeKind(value) {
  switch (value) {
    case 'reminder':
    case 'approval-needed':
    case 'blocked':
    case 'task-completed':
    case 'task-failed':
    case 'deferred-resume':
    case 'task-callback':
      return value;
    default:
      return 'reminder';
  }
}
function parseAlertRecord(value) {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = normalizeOptionalString(value.id);
  const profile = normalizeOptionalString(value.profile);
  const title = normalizeOptionalString(value.title);
  const body = normalizeOptionalString(value.body);
  const sourceKind = normalizeOptionalString(value.sourceKind);
  const sourceId = normalizeOptionalString(value.sourceId);
  if (!id || !profile || !title || !body || !sourceKind || !sourceId) {
    return undefined;
  }
  const createdAt = normalizeIsoTimestamp(value.createdAt);
  const updatedAt = normalizeIsoTimestamp(value.updatedAt, createdAt);
  const alert = {
    id,
    profile: normalizeRuntimeScope(profile),
    kind: normalizeKind(value.kind),
    severity: normalizeSeverity(value.severity),
    status: normalizeStatus(value.status),
    title,
    body,
    createdAt,
    updatedAt,
    sourceKind,
    sourceId,
    requiresAck: value.requiresAck !== false,
  };
  const conversationId = normalizeOptionalString(value.conversationId);
  if (conversationId) {
    alert.conversationId = conversationId;
  }
  const activityId = normalizeOptionalString(value.activityId);
  if (activityId) {
    alert.activityId = activityId;
  }
  const wakeupId = normalizeOptionalString(value.wakeupId);
  if (wakeupId) {
    alert.wakeupId = wakeupId;
  }
  const acknowledgedAt = normalizeOptionalString(value.acknowledgedAt);
  if (acknowledgedAt) {
    alert.acknowledgedAt = normalizeIsoTimestamp(acknowledgedAt, updatedAt);
  }
  const dismissedAt = normalizeOptionalString(value.dismissedAt);
  if (dismissedAt) {
    alert.dismissedAt = normalizeIsoTimestamp(dismissedAt, updatedAt);
  }
  return alert;
}
export function createEmptyAlertState() {
  return {
    version: 1,
    alerts: {},
  };
}
export function resolveProfileAlertsStateFile(options) {
  return join(resolveStateRoot(options.stateRoot), 'pi-agent', 'state', 'alerts', `${normalizeRuntimeScope(options.profile)}.json`);
}
function resolveLegacyProfileAlertsStateFile(options) {
  const legacyProfile = options.profile.trim();
  if (!legacyProfile || legacyProfile === DEFAULT_RUNTIME_SCOPE) {
    return undefined;
  }
  return join(resolveStateRoot(options.stateRoot), 'pi-agent', 'state', 'alerts', `${legacyProfile}.json`);
}
export function loadAlertState(options) {
  const path = resolveProfileAlertsStateFile(options);
  const legacyPath = resolveLegacyProfileAlertsStateFile(options);
  const readablePath = existsSync(path) ? path : legacyPath && existsSync(legacyPath) ? legacyPath : undefined;
  if (!readablePath) {
    return createEmptyAlertState();
  }
  try {
    const raw = readFileSync(readablePath, 'utf-8').trim();
    if (raw.length === 0) {
      return createEmptyAlertState();
    }
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.alerts)) {
      return createEmptyAlertState();
    }
    const alerts = {};
    for (const [id, value] of Object.entries(parsed.alerts)) {
      const record = parseAlertRecord(isRecord(value) ? { id, ...value } : { id });
      if (!record) {
        continue;
      }
      alerts[record.id] = record;
    }
    return {
      version: 1,
      alerts,
    };
  } catch {
    return createEmptyAlertState();
  }
}
export function saveAlertState(options) {
  const path = resolveProfileAlertsStateFile(options);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(options.state, null, 2)}\n`);
  return path;
}
export function listAlerts(options = { profile: 'shared' }) {
  const state = loadAlertState(options);
  return Object.values(state.alerts)
    .filter((alert) => {
      if (alert.status === 'dismissed' && !options.includeDismissed) {
        return false;
      }
      if (alert.status === 'acknowledged' && !options.includeAcknowledged) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const updatedCompare = right.updatedAt.localeCompare(left.updatedAt);
      if (updatedCompare !== 0) {
        return updatedCompare;
      }
      return right.id.localeCompare(left.id);
    });
}
export function getAlert(options) {
  return loadAlertState(options).alerts[options.alertId];
}
export function upsertAlert(options) {
  const state = loadAlertState(options);
  const createdAt = requireIsoTimestamp(options.alert.createdAt, 'alert createdAt');
  const updatedAt = requireIsoTimestamp(options.alert.updatedAt, 'alert updatedAt', createdAt);
  const next = {
    ...options.alert,
    profile: normalizeRuntimeScope(options.alert.profile),
    createdAt,
    updatedAt,
  };
  state.alerts[next.id] = next;
  saveAlertState({ ...options, state });
  return next;
}
export function acknowledgeAlert(options) {
  const state = loadAlertState(options);
  const existing = state.alerts[options.alertId];
  if (!existing) {
    return undefined;
  }
  const at = requireIsoTimestamp(options.at, 'alert acknowledgedAt', new Date().toISOString());
  existing.status = 'acknowledged';
  existing.updatedAt = at;
  existing.acknowledgedAt = at;
  saveAlertState({ ...options, state });
  return { ...existing };
}
export function dismissAlert(options) {
  const state = loadAlertState(options);
  const existing = state.alerts[options.alertId];
  if (!existing) {
    return undefined;
  }
  const at = requireIsoTimestamp(options.at, 'alert dismissedAt', new Date().toISOString());
  existing.status = 'dismissed';
  existing.updatedAt = at;
  existing.dismissedAt = at;
  saveAlertState({ ...options, state });
  return { ...existing };
}
export function countActiveAlerts(options) {
  return listAlerts(options).filter((alert) => alert.status === 'active').length;
}
