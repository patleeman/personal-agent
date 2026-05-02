import {
  acknowledgeAlert,
  type AlertRecord,
  countActiveAlerts,
  type DeferredResumeRecord,
  dismissAlert,
  getAlert,
  listAlerts,
  loadDeferredResumeState,
  parseDeferredResumeDelayMs,
  readSessionConversationId,
  retryDeferredResume,
  saveDeferredResumeState,
} from '@personal-agent/core';
import { loadDaemonConfig, markDeferredResumeConversationRunSnoozed, resolveDaemonPaths } from '@personal-agent/daemon';

export interface AlertSummary extends AlertRecord {}

export interface AlertSnapshot {
  entries: AlertSummary[];
  activeCount: number;
}

export interface SnoozedAlertResult {
  alert: AlertSummary;
  resume: DeferredResumeRecord;
}

function toSummary(record: AlertRecord): AlertSummary {
  return { ...record };
}

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

function resolveValidNow(input?: Date): Date {
  return input instanceof Date && Number.isFinite(input.getTime()) ? input : new Date();
}

const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|[+-]\d{2}:\d{2})$/;

function hasValidIsoDateParts(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7]) : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millisecond
  );
}

function normalizeIsoTimestamp(value: string): string | undefined {
  const match = value.match(ISO_TIMESTAMP_PATTERN);
  if (!match || !hasValidIsoDateParts(match)) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function resolveSnoozeDueAt(input: { delay?: string; at?: string; now?: Date }): string {
  const now = resolveValidNow(input.now);

  if (input.delay && input.at) {
    throw new Error('Specify only one of delay or at when snoozing an alert.');
  }

  if (!input.delay && !input.at) {
    throw new Error('delay is required when snoozing an alert.');
  }

  if (input.delay) {
    const delayMs = parseDeferredResumeDelayMs(input.delay);
    if (!delayMs) {
      throw new Error('Invalid delay. Use forms like 30s, 10m, 2h, or 1d.');
    }

    return new Date(now.getTime() + delayMs).toISOString();
  }

  const dueAt = normalizeIsoTimestamp(input.at as string);
  if (!dueAt) {
    throw new Error('Invalid at timestamp. Use an ISO-8601 timestamp or another Date.parse-compatible string.');
  }

  if (Date.parse(dueAt) <= now.getTime()) {
    throw new Error('Snooze time must be in the future.');
  }

  return dueAt;
}

export function listAlertsForProfile(profile: string): AlertSummary[] {
  return listAlerts({ profile }).map(toSummary);
}

export function getAlertSnapshotForProfile(profile: string): AlertSnapshot {
  const entries = listAlertsForProfile(profile);
  return {
    entries,
    activeCount: countActiveAlerts({ profile }),
  };
}

export function getAlertForProfile(profile: string, alertId: string): AlertSummary | undefined {
  const record = getAlert({ profile, alertId });
  return record ? toSummary(record) : undefined;
}

export function acknowledgeAlertForProfile(profile: string, alertId: string): AlertSummary | undefined {
  const record = acknowledgeAlert({ profile, alertId });
  return record ? toSummary(record) : undefined;
}

export function dismissAlertForProfile(profile: string, alertId: string): AlertSummary | undefined {
  const record = dismissAlert({ profile, alertId });
  return record ? toSummary(record) : undefined;
}

export async function snoozeAlertForProfile(
  profile: string,
  alertId: string,
  input: { delay?: string; at?: string; now?: Date },
): Promise<SnoozedAlertResult | undefined> {
  const now = resolveValidNow(input.now);
  const alert = getAlert({ profile, alertId });
  if (!alert) {
    return undefined;
  }

  if (!alert.wakeupId) {
    throw new Error('Only conversation wakeup alerts can be snoozed.');
  }

  const dueAt = resolveSnoozeDueAt(input);
  const state = loadDeferredResumeState();
  const existingResume = state.resumes[alert.wakeupId];
  if (!existingResume) {
    throw new Error('Wakeup record not found for this alert.');
  }

  const retried = retryDeferredResume(state, {
    id: existingResume.id,
    dueAt,
  });
  if (!retried) {
    throw new Error('Wakeup record not found for this alert.');
  }

  saveDeferredResumeState(state);

  await markDeferredResumeConversationRunSnoozed({
    daemonRoot: resolveDaemonRoot(),
    deferredResumeId: retried.id,
    sessionFile: retried.sessionFile,
    prompt: retried.prompt,
    dueAt: retried.dueAt,
    createdAt: retried.createdAt,
    conversationId: alert.conversationId ?? readSessionConversationId(retried.sessionFile),
    snoozedUntil: retried.dueAt,
  });

  const acknowledged = acknowledgeAlert({
    profile,
    alertId,
    at: now.toISOString(),
  });
  if (!acknowledged) {
    throw new Error('Alert disappeared while snoozing.');
  }

  return {
    alert: toSummary(acknowledged),
    resume: retried,
  };
}
