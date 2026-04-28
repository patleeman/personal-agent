import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAlert, upsertAlert } from '@personal-agent/core';
import { createReadyDeferredResumeForSessionFile, listDeferredResumesForSessionFile } from './deferredResumes.js';
import {
  acknowledgeAlertForProfile,
  dismissAlertForProfile,
  getAlertForProfile,
  getAlertSnapshotForProfile,
  listAlertsForProfile,
  snoozeAlertForProfile,
} from './alerts.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  vi.useRealTimers();
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('alerts server helpers', () => {
  function createAlert(overrides: Partial<Parameters<typeof upsertAlert>[0]['alert']> & { id: string }) {
    return {
      id: overrides.id,
      profile: overrides.profile ?? 'shared',
      kind: overrides.kind ?? 'reminder',
      severity: overrides.severity ?? 'disruptive',
      status: overrides.status ?? 'active',
      title: overrides.title ?? 'Watch the prod gates',
      body: overrides.body ?? 'Watch the prod gates.',
      createdAt: overrides.createdAt ?? '2026-03-26T14:00:00.000Z',
      updatedAt: overrides.updatedAt ?? '2026-03-26T14:00:00.000Z',
      conversationId: overrides.conversationId,
      wakeupId: overrides.wakeupId,
      sourceKind: overrides.sourceKind ?? 'reminder-tool',
      sourceId: overrides.sourceId ?? overrides.id,
      requiresAck: overrides.requiresAck ?? true,
    };
  }

  it('lists, snapshots, acknowledges, and dismisses alerts for a profile', () => {
    const stateRoot = createTempDir('pa-web-alerts-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    upsertAlert({ stateRoot, profile: 'shared', alert: createAlert({ id: 'alert-1' }) });

    const listed = listAlertsForProfile('shared');
    expect(listed).toEqual([
      expect.objectContaining({ id: 'alert-1', status: 'active' }),
    ]);

    expect(getAlertSnapshotForProfile('shared')).toEqual({
      entries: listed,
      activeCount: 1,
    });
    expect(getAlertForProfile('shared', 'alert-1')).toEqual(expect.objectContaining({ id: 'alert-1' }));
    expect(getAlertForProfile('shared', 'missing')).toBeUndefined();

    expect(acknowledgeAlertForProfile('shared', 'alert-1')).toEqual(
      expect.objectContaining({ id: 'alert-1', status: 'acknowledged' }),
    );
    expect(dismissAlertForProfile('shared', 'alert-1')).toEqual(
      expect.objectContaining({ id: 'alert-1', status: 'dismissed' }),
    );
  });

  it('returns undefined for missing alerts and validates snooze inputs before loading wakeup state', async () => {
    const stateRoot = createTempDir('pa-web-alerts-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    expect(await snoozeAlertForProfile('shared', 'missing', { delay: '15m' })).toBeUndefined();

    upsertAlert({
      stateRoot,
      profile: 'shared',
      alert: createAlert({ id: 'wakeup-alert-1', wakeupId: 'resume-1' }),
    });

    await expect(snoozeAlertForProfile('shared', 'wakeup-alert-1', {
      delay: '15m',
      at: '2026-03-26T14:15:00.000Z',
    })).rejects.toThrow('Specify only one of delay or at when snoozing an alert.');

    await expect(snoozeAlertForProfile('shared', 'wakeup-alert-1', {})).rejects.toThrow(
      'delay is required when snoozing an alert.',
    );

    await expect(snoozeAlertForProfile('shared', 'wakeup-alert-1', { delay: 'bogus' })).rejects.toThrow(
      'Invalid delay. Use forms like 30s, 10m, 2h, or 1d.',
    );

    await expect(snoozeAlertForProfile('shared', 'wakeup-alert-1', { at: 'not-a-date' })).rejects.toThrow(
      'Invalid at timestamp. Use an ISO-8601 timestamp or another Date.parse-compatible string.',
    );

    await expect(snoozeAlertForProfile('shared', 'wakeup-alert-1', { at: '9999' })).rejects.toThrow(
      'Invalid at timestamp. Use an ISO-8601 timestamp or another Date.parse-compatible string.',
    );

    await expect(snoozeAlertForProfile('shared', 'wakeup-alert-1', {
      at: '2026-03-26T13:59:00.000Z',
      now: new Date('2026-03-26T14:00:00.000Z'),
    })).rejects.toThrow('Snooze time must be in the future.');
  });

  it('rejects snoozes for alerts without wakeup state', async () => {
    const stateRoot = createTempDir('pa-web-alerts-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    upsertAlert({
      stateRoot,
      profile: 'shared',
      alert: createAlert({ id: 'plain-alert' }),
    });
    await expect(snoozeAlertForProfile('shared', 'plain-alert', { delay: '15m' })).rejects.toThrow(
      'Only conversation wakeup alerts can be snoozed.',
    );

    upsertAlert({
      stateRoot,
      profile: 'shared',
      alert: createAlert({ id: 'missing-resume-alert', wakeupId: 'resume-missing' }),
    });
    await expect(snoozeAlertForProfile('shared', 'missing-resume-alert', { delay: '15m' })).rejects.toThrow(
      'Wakeup record not found for this alert.',
    );
  });

  it('snoozes wakeup alerts by rescheduling the underlying deferred resume', async () => {
    const stateRoot = createTempDir('pa-web-alerts-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const reminder = createReadyDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/conv-123.jsonl',
      prompt: 'Watch the prod gates.',
      title: 'Watch the prod gates',
      kind: 'reminder',
      notify: 'disruptive',
      requireAck: true,
      autoResumeIfOpen: false,
      dueAt: '2026-03-26T14:00:00.000Z',
      readyAt: '2026-03-26T14:00:00.000Z',
      createdAt: '2026-03-26T14:00:00.000Z',
      source: { kind: 'reminder-tool', id: 'reminder-1' },
    });

    upsertAlert({
      stateRoot,
      profile: 'shared',
      alert: createAlert({
        id: 'wakeup-alert-1',
        conversationId: 'conv-123',
        wakeupId: reminder.id,
        sourceId: 'reminder-1',
      }),
    });

    const result = await snoozeAlertForProfile('shared', 'wakeup-alert-1', {
      delay: '15m',
      now: new Date('2026-03-26T14:00:00.000Z'),
    });

    expect(result).toEqual(expect.objectContaining({
      alert: expect.objectContaining({
        id: 'wakeup-alert-1',
        status: 'acknowledged',
      }),
      resume: expect.objectContaining({
        id: reminder.id,
        status: 'scheduled',
        dueAt: '2026-03-26T14:15:00.000Z',
        attempts: 1,
      }),
    }));

    expect(listDeferredResumesForSessionFile('/tmp/sessions/conv-123.jsonl')).toEqual([
      expect.objectContaining({
        id: reminder.id,
        status: 'scheduled',
        dueAt: '2026-03-26T14:15:00.000Z',
      }),
    ]);
    expect(getAlert({ stateRoot, profile: 'shared', alertId: 'wakeup-alert-1' })).toEqual(
      expect.objectContaining({ status: 'acknowledged' }),
    );
  });

  it('falls back to the current clock for invalid snooze Date inputs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T14:00:00.000Z'));
    const stateRoot = createTempDir('pa-web-alerts-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const reminder = createReadyDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/conv-invalid-now.jsonl',
      prompt: 'Watch the prod gates.',
      title: 'Watch the prod gates',
      kind: 'reminder',
      notify: 'disruptive',
      requireAck: true,
      autoResumeIfOpen: false,
      dueAt: '2026-03-26T14:00:00.000Z',
      readyAt: '2026-03-26T14:00:00.000Z',
      createdAt: '2026-03-26T14:00:00.000Z',
      source: { kind: 'reminder-tool', id: 'reminder-invalid-now' },
    });

    upsertAlert({
      stateRoot,
      profile: 'shared',
      alert: createAlert({
        id: 'wakeup-alert-invalid-now',
        conversationId: 'conv-invalid-now',
        wakeupId: reminder.id,
        sourceId: 'reminder-invalid-now',
      }),
    });

    const result = await snoozeAlertForProfile('shared', 'wakeup-alert-invalid-now', {
      delay: '15m',
      now: new Date(Number.NaN),
    });

    expect(result?.resume.dueAt).toBe('2026-03-26T14:15:00.000Z');
    expect(result?.alert).toEqual(expect.objectContaining({
      id: 'wakeup-alert-invalid-now',
      status: 'acknowledged',
      updatedAt: '2026-03-26T14:00:00.000Z',
    }));
  });

  it('supports explicit snooze timestamps', async () => {
    const stateRoot = createTempDir('pa-web-alerts-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const reminder = createReadyDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/conv-456.jsonl',
      prompt: 'Check production.',
      title: 'Check production',
      kind: 'reminder',
      notify: 'disruptive',
      requireAck: true,
      autoResumeIfOpen: false,
      dueAt: '2026-03-26T14:00:00.000Z',
      readyAt: '2026-03-26T14:00:00.000Z',
      createdAt: '2026-03-26T14:00:00.000Z',
      source: { kind: 'reminder-tool', id: 'reminder-2' },
    });

    upsertAlert({
      stateRoot,
      profile: 'shared',
      alert: createAlert({
        id: 'wakeup-alert-2',
        wakeupId: reminder.id,
        sourceId: 'reminder-2',
      }),
    });

    const result = await snoozeAlertForProfile('shared', 'wakeup-alert-2', {
      at: '2026-03-26T15:00:00.000Z',
      now: new Date('2026-03-26T14:00:00.000Z'),
    });

    expect(result).toEqual(expect.objectContaining({
      resume: expect.objectContaining({
        id: reminder.id,
        dueAt: '2026-03-26T15:00:00.000Z',
      }),
    }));
  });
});
