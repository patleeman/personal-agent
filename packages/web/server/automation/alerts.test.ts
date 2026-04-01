import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAlert, upsertAlert } from '@personal-agent/core';
import { createReadyDeferredResumeForSessionFile, listDeferredResumesForSessionFile } from './deferredResumes.js';
import { snoozeAlertForProfile } from './alerts.js';

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
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('alerts server helpers', () => {
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
      alert: {
        id: 'wakeup-alert-1',
        profile: 'shared',
        kind: 'reminder',
        severity: 'disruptive',
        status: 'active',
        title: 'Watch the prod gates',
        body: 'Watch the prod gates.',
        createdAt: '2026-03-26T14:00:00.000Z',
        updatedAt: '2026-03-26T14:00:00.000Z',
        conversationId: 'conv-123',
        wakeupId: reminder.id,
        sourceKind: 'reminder-tool',
        sourceId: 'reminder-1',
        requiresAck: true,
      },
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
});
