import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { getStateRoot } from './runtime/paths.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

export type AlertKind = 'reminder' | 'approval-needed' | 'blocked' | 'task-completed' | 'task-failed' | 'deferred-resume' | 'task-callback';
export type AlertSeverity = 'passive' | 'disruptive';
export type AlertStatus = 'active' | 'acknowledged' | 'dismissed';

export interface AlertRecord {
  id: string;
  profile: string;
  kind: AlertKind;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  conversationId?: string;
  activityId?: string;
  wakeupId?: string;
  sourceKind: string;
  sourceId: string;
  requiresAck: boolean;
  acknowledgedAt?: string;
  dismissedAt?: string;
}

export interface AlertStateFile {
  version: 1;
  alerts: Record<string, AlertRecord>;
}

export interface ResolveAlertOptions {
  profile: string;
  stateRoot?: string;
}

function assertProfile(profile: string): string {
  const normalized = profile.trim();
  if (!PROFILE_NAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid profile name "${profile}".`);
  }

  return normalized;
}

function resolveStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeIsoTimestamp(value: unknown, fallback?: string): string {
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

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeSeverity(value: unknown): AlertSeverity {
  return value === 'passive' ? 'passive' : 'disruptive';
}

function normalizeStatus(value: unknown): AlertStatus {
  if (value === 'acknowledged' || value === 'dismissed') {
    return value;
  }

  return 'active';
}

function normalizeKind(value: unknown): AlertKind {
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

function parseAlertRecord(value: unknown): AlertRecord | undefined {
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

  const alert: AlertRecord = {
    id,
    profile,
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

export function createEmptyAlertState(): AlertStateFile {
  return {
    version: 1,
    alerts: {},
  };
}

export function resolveProfileAlertsStateFile(options: ResolveAlertOptions): string {
  const profile = assertProfile(options.profile);
  return join(resolveStateRoot(options.stateRoot), 'pi-agent', 'state', 'alerts', `${profile}.json`);
}

export function loadAlertState(options: ResolveAlertOptions): AlertStateFile {
  const path = resolveProfileAlertsStateFile(options);
  if (!existsSync(path)) {
    return createEmptyAlertState();
  }

  try {
    const raw = readFileSync(path, 'utf-8').trim();
    if (raw.length === 0) {
      return createEmptyAlertState();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.alerts)) {
      return createEmptyAlertState();
    }

    const alerts: Record<string, AlertRecord> = {};
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

export function saveAlertState(options: ResolveAlertOptions & { state: AlertStateFile }): string {
  const path = resolveProfileAlertsStateFile(options);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(options.state, null, 2)}\n`);
  return path;
}

export function listAlerts(
  options: ResolveAlertOptions & { includeDismissed?: boolean; includeAcknowledged?: boolean } = { profile: 'shared' },
): AlertRecord[] {
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

export function getAlert(options: ResolveAlertOptions & { alertId: string }): AlertRecord | undefined {
  return loadAlertState(options).alerts[options.alertId];
}

export function upsertAlert(
  options: ResolveAlertOptions & {
    alert: Omit<AlertRecord, 'updatedAt'> & { updatedAt?: string };
  },
): AlertRecord {
  const state = loadAlertState(options);
  const createdAt = normalizeIsoTimestamp(options.alert.createdAt);
  const updatedAt = normalizeIsoTimestamp(options.alert.updatedAt, createdAt);
  const next: AlertRecord = {
    ...options.alert,
    profile: assertProfile(options.alert.profile),
    createdAt,
    updatedAt,
  };

  state.alerts[next.id] = next;
  saveAlertState({ ...options, state });
  return next;
}

export function acknowledgeAlert(options: ResolveAlertOptions & { alertId: string; at?: string }): AlertRecord | undefined {
  const state = loadAlertState(options);
  const existing = state.alerts[options.alertId];
  if (!existing) {
    return undefined;
  }

  const at = normalizeIsoTimestamp(options.at, new Date().toISOString());
  existing.status = 'acknowledged';
  existing.updatedAt = at;
  existing.acknowledgedAt = at;
  saveAlertState({ ...options, state });
  return { ...existing };
}

export function dismissAlert(options: ResolveAlertOptions & { alertId: string; at?: string }): AlertRecord | undefined {
  const state = loadAlertState(options);
  const existing = state.alerts[options.alertId];
  if (!existing) {
    return undefined;
  }

  const at = normalizeIsoTimestamp(options.at, new Date().toISOString());
  existing.status = 'dismissed';
  existing.updatedAt = at;
  existing.dismissedAt = at;
  saveAlertState({ ...options, state });
  return { ...existing };
}

export function countActiveAlerts(options: ResolveAlertOptions): number {
  return listAlerts(options).filter((alert) => alert.status === 'active').length;
}
