import {
  acknowledgeAlertForProfile,
  dismissAlertForProfile,
  getAlertForProfile,
  getAlertSnapshotForProfile,
  snoozeAlertForProfile,
} from './alerts.js';
import { invalidateAppTopics } from '../shared/appEvents.js';

function normalizeAlertId(alertId: string): string {
  return alertId.trim();
}

export function readAlertSnapshotCapability(profile: string) {
  return getAlertSnapshotForProfile(profile);
}

export function readAlertCapability(profile: string, alertId: string) {
  const normalizedAlertId = normalizeAlertId(alertId);
  if (!normalizedAlertId) {
    return undefined;
  }

  return getAlertForProfile(profile, normalizedAlertId);
}

export function acknowledgeAlertCapability(profile: string, alertId: string) {
  const normalizedAlertId = normalizeAlertId(alertId);
  if (!normalizedAlertId) {
    return undefined;
  }

  const alert = acknowledgeAlertForProfile(profile, normalizedAlertId);
  if (alert) {
    invalidateAppTopics('sessions', 'runs');
  }

  return alert;
}

export function dismissAlertCapability(profile: string, alertId: string) {
  const normalizedAlertId = normalizeAlertId(alertId);
  if (!normalizedAlertId) {
    return undefined;
  }

  const alert = dismissAlertForProfile(profile, normalizedAlertId);
  if (alert) {
    invalidateAppTopics('sessions', 'runs');
  }

  return alert;
}

export async function snoozeAlertCapability(
  profile: string,
  alertId: string,
  input: { delay?: string; at?: string },
) {
  const normalizedAlertId = normalizeAlertId(alertId);
  if (!normalizedAlertId) {
    return undefined;
  }

  const result = await snoozeAlertForProfile(profile, normalizedAlertId, input);
  if (result) {
    invalidateAppTopics('sessions', 'runs');
  }

  return result;
}
