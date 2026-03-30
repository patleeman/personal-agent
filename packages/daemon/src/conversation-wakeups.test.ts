import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acknowledgeAlert, getAlert, type DeferredResumeRecord } from '@personal-agent/core';
import { buildDeferredResumeAlertId, surfaceReadyDeferredResume } from './conversation-wakeups.js';
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('conversation wakeups', () => {
  it('reactivates an acknowledged wakeup alert when the same wakeup becomes ready again later', () => {
    const stateRoot = createTempDir('pa-wakeup-state-');
    const repoRoot = createTempDir('pa-wakeup-repo-');
    const record: DeferredResumeRecord = {
      id: 'resume_123',
      sessionFile: '/tmp/sessions/conv-123.jsonl',
      prompt: 'Watch the prod gates.',
      dueAt: '2026-03-26T14:00:00.000Z',
      createdAt: '2026-03-26T13:00:00.000Z',
      attempts: 0,
      status: 'ready',
      kind: 'reminder',
      title: 'Watch the prod gates',
      delivery: {
        alertLevel: 'disruptive',
        autoResumeIfOpen: false,
        requireAck: true,
      },
      source: {
        kind: 'reminder-tool',
        id: 'reminder-1',
      },
      readyAt: '2026-03-26T14:00:00.000Z',
    };

    const first = surfaceReadyDeferredResume({
      entry: record,
      repoRoot,
      profile: 'shared',
      stateRoot,
      conversationId: 'conv-123',
    });

    acknowledgeAlert({
      stateRoot,
      profile: 'shared',
      alertId: first.alertId as string,
      at: '2026-03-26T14:01:00.000Z',
    });

    const snoozedReadyRecord: DeferredResumeRecord = {
      ...record,
      attempts: 1,
      dueAt: '2026-03-26T14:15:00.000Z',
      readyAt: '2026-03-26T14:15:00.000Z',
    };

    surfaceReadyDeferredResume({
      entry: snoozedReadyRecord,
      repoRoot,
      profile: 'shared',
      stateRoot,
      conversationId: 'conv-123',
    });

    const alert = getAlert({
      stateRoot,
      profile: 'shared',
      alertId: buildDeferredResumeAlertId(record),
    });
    expect(alert).toEqual(expect.objectContaining({
      status: 'active',
      createdAt: '2026-03-26T14:15:00.000Z',
      wakeupId: 'resume_123',
    }));
    expect(alert).not.toHaveProperty('acknowledgedAt');
    expect(alert).not.toHaveProperty('dismissedAt');
  });
});
