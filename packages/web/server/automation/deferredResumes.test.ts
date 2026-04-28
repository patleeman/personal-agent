import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDeferredResumeState } from '@personal-agent/core';
import {
  DEFAULT_DEFERRED_RESUME_PROMPT,
  activateDueDeferredResumesForSessionFile,
  cancelDeferredResumeForSessionFile,
  completeDeferredResumeForSessionFile,
  createReadyDeferredResumeForSessionFile,
  fireDeferredResumeNowForSessionFile,
  listDeferredResumesForSessionFile,
  retryDeferredResumeForSessionFile,
  scheduleDeferredResumeForSessionFile,
} from './deferredResumes.js';

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

describe('deferredResumes', () => {
  it('schedules and lists deferred resumes for a session file', async () => {
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const scheduled = await scheduleDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/conv-123.jsonl',
      delay: '10m',
      prompt: 'check the logs and continue',
      behavior: 'followUp',
      now: new Date('2026-03-12T13:00:00.000Z'),
    });

    expect(scheduled.prompt).toBe('check the logs and continue');
    expect(scheduled.status).toBe('scheduled');
    expect(scheduled.dueAt).toBe('2026-03-12T13:10:00.000Z');
    expect(scheduled.behavior).toBe('followUp');

    expect(listDeferredResumesForSessionFile('/tmp/sessions/conv-123.jsonl')).toEqual([
      expect.objectContaining({
        id: scheduled.id,
        prompt: 'check the logs and continue',
        status: 'scheduled',
        behavior: 'followUp',
      }),
    ]);
  });

  it('uses the default prompt when one is not provided', async () => {
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const scheduled = await scheduleDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/conv-123.jsonl',
      delay: '30s',
      now: new Date('2026-03-12T13:00:00.000Z'),
    });

    expect(scheduled.prompt).toBe(DEFAULT_DEFERRED_RESUME_PROMPT);
  });

  it('falls back to the current clock when scheduling with an invalid Date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T13:00:00.000Z'));
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const scheduled = await scheduleDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/conv-invalid-now.jsonl',
      delay: '10m',
      now: new Date(Number.NaN),
    });

    expect(scheduled.id).toMatch(/^resume_1773320400000_/);
    expect(scheduled.createdAt).toBe('2026-03-12T13:00:00.000Z');
    expect(scheduled.dueAt).toBe('2026-03-12T13:10:00.000Z');
  });

  it('uses the default prompt for ready resumes with blank prompt text', () => {
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const ready = createReadyDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/conv-123.jsonl',
      prompt: '   ',
    });

    expect(ready.prompt).toBe(DEFAULT_DEFERRED_RESUME_PROMPT);
  });

  it('cancels only entries that belong to the requested session file', async () => {
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const keep = await scheduleDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/other.jsonl',
      delay: '30s',
      now: new Date('2026-03-12T13:00:00.000Z'),
    });
    const remove = await scheduleDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/current.jsonl',
      delay: '30s',
      now: new Date('2026-03-12T13:00:01.000Z'),
    });

    const cancelled = await cancelDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/current.jsonl',
      id: remove.id,
    });

    expect(cancelled.id).toBe(remove.id);
    expect(listDeferredResumesForSessionFile('/tmp/sessions/current.jsonl')).toEqual([]);
    expect(listDeferredResumesForSessionFile('/tmp/sessions/other.jsonl')).toEqual([
      expect.objectContaining({ id: keep.id }),
    ]);
  });

  it('fires a scheduled resume immediately without dropping a newer schedule', async () => {
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const sessionFile = '/tmp/sessions/current.jsonl';

    const first = await scheduleDeferredResumeForSessionFile({
      sessionFile,
      delay: '10m',
      prompt: 'first',
      now: new Date('2026-03-12T13:00:00.000Z'),
    });

    const second = await scheduleDeferredResumeForSessionFile({
      sessionFile,
      delay: '20m',
      prompt: 'second',
      now: new Date('2026-03-12T13:00:01.000Z'),
    });

    const fired = await fireDeferredResumeNowForSessionFile({
      sessionFile,
      id: first.id,
      at: new Date('2026-03-12T13:00:30.000Z'),
    });

    expect(fired).toEqual(expect.objectContaining({
      id: first.id,
      status: 'ready',
      readyAt: '2026-03-12T13:00:30.000Z',
    }));
    expect(listDeferredResumesForSessionFile(sessionFile)).toEqual([
      expect.objectContaining({ id: first.id, status: 'ready', readyAt: '2026-03-12T13:00:30.000Z' }),
      expect.objectContaining({ id: second.id, prompt: 'second', status: 'scheduled' }),
    ]);
  });

  it('completes a ready resume without dropping a newer schedule', async () => {
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const sessionFile = '/tmp/sessions/current.jsonl';

    const first = await scheduleDeferredResumeForSessionFile({
      sessionFile,
      delay: '30s',
      prompt: 'first',
      now: new Date('2026-03-12T13:00:00.000Z'),
    });

    const activated = activateDueDeferredResumesForSessionFile({
      sessionFile,
      at: new Date('2026-03-12T13:00:31.000Z'),
    });
    expect(activated).toEqual([
      expect.objectContaining({ id: first.id, status: 'ready' }),
    ]);

    const second = await scheduleDeferredResumeForSessionFile({
      sessionFile,
      delay: '10m',
      prompt: 'second',
      now: new Date('2026-03-12T13:00:32.000Z'),
    });

    const completed = completeDeferredResumeForSessionFile({
      sessionFile,
      id: first.id,
    });

    expect(completed).toEqual(expect.objectContaining({ id: first.id, status: 'ready' }));
    expect(listDeferredResumesForSessionFile(sessionFile)).toEqual([
      expect.objectContaining({ id: second.id, prompt: 'second', status: 'scheduled' }),
    ]);
  });

  it('retries a ready resume without dropping a newer schedule', async () => {
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const sessionFile = '/tmp/sessions/current.jsonl';

    const first = await scheduleDeferredResumeForSessionFile({
      sessionFile,
      delay: '30s',
      prompt: 'first',
      now: new Date('2026-03-12T13:00:00.000Z'),
    });

    activateDueDeferredResumesForSessionFile({
      sessionFile,
      at: new Date('2026-03-12T13:00:31.000Z'),
    });

    const second = await scheduleDeferredResumeForSessionFile({
      sessionFile,
      delay: '10m',
      prompt: 'second',
      now: new Date('2026-03-12T13:00:32.000Z'),
    });

    const retried = retryDeferredResumeForSessionFile({
      sessionFile,
      id: first.id,
      dueAt: '2026-03-12T13:05:00.000Z',
    });

    expect(retried).toEqual(expect.objectContaining({
      id: first.id,
      status: 'scheduled',
      dueAt: '2026-03-12T13:05:00.000Z',
      attempts: 1,
    }));
    expect(listDeferredResumesForSessionFile(sessionFile)).toEqual([
      expect.objectContaining({ id: first.id, status: 'scheduled', attempts: 1 }),
      expect.objectContaining({ id: second.id, prompt: 'second', status: 'scheduled' }),
    ]);
  });

  it('preserves reminder metadata and absolute times', async () => {
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const scheduled = await scheduleDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/current.jsonl',
      at: '2026-03-12T09:30:00-04:00',
      prompt: 'Watch the prod gates.',
      title: 'Watch the prod gates',
      kind: 'reminder',
      notify: 'disruptive',
      requireAck: true,
      autoResumeIfOpen: false,
      source: { kind: 'reminder-tool', id: 'reminder-1' },
      now: new Date('2026-03-12T12:00:00.000Z'),
    });

    expect(scheduled).toEqual(expect.objectContaining({
      prompt: 'Watch the prod gates.',
      title: 'Watch the prod gates',
      kind: 'reminder',
      dueAt: '2026-03-12T13:30:00.000Z',
      delivery: {
        alertLevel: 'disruptive',
        autoResumeIfOpen: false,
        requireAck: true,
      },
    }));

    const stored = Object.values(loadDeferredResumeState().resumes)[0];
    expect(stored).toEqual(expect.objectContaining({
      source: { kind: 'reminder-tool', id: 'reminder-1' },
    }));
  });

  it('rejects invalid delays', async () => {
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    await expect(scheduleDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/current.jsonl',
      delay: 'later',
    })).rejects.toThrow('Invalid delay. Use forms like 30s, 10m, 2h, or 1d.');
  });
});
