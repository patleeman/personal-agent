import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  acknowledgeAlert,
  countActiveAlerts,
  dismissAlert,
  getAlert,
  listAlerts,
  resolveProfileAlertsStateFile,
  upsertAlert,
} from './alerts.js';

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
        id: 'wakeup-1',
        profile: 'datadog',
        kind: 'deferred-resume',
        severity: 'disruptive',
        status: 'active',
        title: 'Watch the prod gates',
        body: 'Approve the kube changes when the prompt appears.',
        createdAt: '2026-03-26T13:00:00.000Z',
        sourceKind: 'queue-followup-tool',
        sourceId: 'resume_123',
        conversationId: 'conv-123',
        wakeupId: 'resume_123',
        requiresAck: true,
      },
    });

    expect(countActiveAlerts({ stateRoot, profile: 'datadog' })).toBe(1);
    expect(resolveProfileAlertsStateFile({ stateRoot, profile: 'datadog' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'alerts', 'shared.json'),
    );
    expect(listAlerts({ stateRoot, profile: 'datadog' })).toEqual([
      expect.objectContaining({
        id: 'wakeup-1',
        profile: 'shared',
        title: 'Watch the prod gates',
        status: 'active',
        wakeupId: 'resume_123',
      }),
    ]);
  });

  it('reads legacy per-profile alert files and writes updates to shared state', () => {
    const stateRoot = createTempDir('pa-alerts-');
    const legacyPath = join(stateRoot, 'pi-agent', 'state', 'alerts', 'datadog.json');
    mkdirSync(join(stateRoot, 'pi-agent', 'state', 'alerts'), { recursive: true });
    writeFileSync(
      legacyPath,
      `${JSON.stringify(
        {
          version: 1,
          alerts: {
            'legacy-alert': {
              profile: 'datadog',
              kind: 'deferred-resume',
              severity: 'disruptive',
              status: 'active',
              title: 'Legacy alert',
              body: 'Old profile-scoped alert.',
              createdAt: '2026-03-26T13:00:00.000Z',
              sourceKind: 'legacy',
              sourceId: 'legacy-alert',
              requiresAck: true,
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    expect(listAlerts({ stateRoot, profile: 'datadog' })).toEqual([expect.objectContaining({ id: 'legacy-alert', profile: 'shared' })]);

    acknowledgeAlert({ stateRoot, profile: 'datadog', alertId: 'legacy-alert', at: '2026-03-26T13:01:00.000Z' });

    expect(existsSync(join(stateRoot, 'pi-agent', 'state', 'alerts', 'shared.json'))).toBe(true);
    expect(getAlert({ stateRoot, profile: 'shared', alertId: 'legacy-alert' })).toEqual(
      expect.objectContaining({ status: 'acknowledged', profile: 'shared' }),
    );
  });

  it('acknowledges and dismisses alerts without losing the durable record', () => {
    const stateRoot = createTempDir('pa-alerts-');

    upsertAlert({
      stateRoot,
      profile: 'datadog',
      alert: {
        id: 'wakeup-1',
        profile: 'datadog',
        kind: 'deferred-resume',
        severity: 'disruptive',
        status: 'active',
        title: 'Watch the prod gates',
        body: 'Approve the kube changes when the prompt appears.',
        createdAt: '2026-03-26T13:00:00.000Z',
        sourceKind: 'queue-followup-tool',
        sourceId: 'resume_123',
        wakeupId: 'resume_123',
        requiresAck: true,
      },
    });

    const acknowledged = acknowledgeAlert({ stateRoot, profile: 'datadog', alertId: 'wakeup-1', at: '2026-03-26T13:01:00.000Z' });
    expect(acknowledged).toEqual(expect.objectContaining({ status: 'acknowledged', acknowledgedAt: '2026-03-26T13:01:00.000Z' }));
    expect(countActiveAlerts({ stateRoot, profile: 'datadog' })).toBe(0);

    const dismissed = dismissAlert({ stateRoot, profile: 'datadog', alertId: 'wakeup-1', at: '2026-03-26T13:02:00.000Z' });
    expect(dismissed).toEqual(expect.objectContaining({ status: 'dismissed', dismissedAt: '2026-03-26T13:02:00.000Z' }));
    expect(getAlert({ stateRoot, profile: 'datadog', alertId: 'wakeup-1' })).toEqual(expect.objectContaining({ status: 'dismissed' }));
  });
});
