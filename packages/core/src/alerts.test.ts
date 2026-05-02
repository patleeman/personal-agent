import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { acknowledgeAlert, countActiveAlerts, dismissAlert, getAlert, listAlerts, upsertAlert } from './alerts.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('alerts', () => {
  it('creates and lists active alerts', () => {
    const stateRoot = createTempDir('pa-alerts-');

    upsertAlert({
      stateRoot,
      profile: 'datadog',
      alert: {
        id: 'reminder-1',
        profile: 'datadog',
        kind: 'reminder',
        severity: 'disruptive',
        status: 'active',
        title: 'Watch the prod gates',
        body: 'Approve the kube changes when the prompt appears.',
        createdAt: '2026-03-26T13:00:00.000Z',
        sourceKind: 'reminder-tool',
        sourceId: 'resume_123',
        conversationId: 'conv-123',
        wakeupId: 'resume_123',
        requiresAck: true,
      },
    });

    expect(countActiveAlerts({ stateRoot, profile: 'datadog' })).toBe(1);
    expect(listAlerts({ stateRoot, profile: 'datadog' })).toEqual([
      expect.objectContaining({ id: 'reminder-1', title: 'Watch the prod gates', status: 'active', wakeupId: 'resume_123' }),
    ]);
  });

  it('acknowledges and dismisses alerts without losing the durable record', () => {
    const stateRoot = createTempDir('pa-alerts-');

    upsertAlert({
      stateRoot,
      profile: 'datadog',
      alert: {
        id: 'reminder-1',
        profile: 'datadog',
        kind: 'reminder',
        severity: 'disruptive',
        status: 'active',
        title: 'Watch the prod gates',
        body: 'Approve the kube changes when the prompt appears.',
        createdAt: '2026-03-26T13:00:00.000Z',
        sourceKind: 'reminder-tool',
        sourceId: 'resume_123',
        wakeupId: 'resume_123',
        requiresAck: true,
      },
    });

    const acknowledged = acknowledgeAlert({ stateRoot, profile: 'datadog', alertId: 'reminder-1', at: '2026-03-26T13:01:00.000Z' });
    expect(acknowledged).toEqual(expect.objectContaining({ status: 'acknowledged', acknowledgedAt: '2026-03-26T13:01:00.000Z' }));
    expect(countActiveAlerts({ stateRoot, profile: 'datadog' })).toBe(0);

    const dismissed = dismissAlert({ stateRoot, profile: 'datadog', alertId: 'reminder-1', at: '2026-03-26T13:02:00.000Z' });
    expect(dismissed).toEqual(expect.objectContaining({ status: 'dismissed', dismissedAt: '2026-03-26T13:02:00.000Z' }));
    expect(getAlert({ stateRoot, profile: 'datadog', alertId: 'reminder-1' })).toEqual(expect.objectContaining({ status: 'dismissed' }));
  });
});
