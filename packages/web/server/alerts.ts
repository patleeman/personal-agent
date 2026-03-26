import {
  acknowledgeAlert,
  countActiveAlerts,
  dismissAlert,
  getAlert,
  listAlerts,
  type AlertRecord,
} from '@personal-agent/core';

export interface AlertSummary extends AlertRecord {}

export interface AlertSnapshot {
  entries: AlertSummary[];
  activeCount: number;
}

function toSummary(record: AlertRecord): AlertSummary {
  return { ...record };
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
