import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DEFERRED_RESUME_PROMPT,
  cancelDeferredResumeForSessionFile,
  listDeferredResumesForSessionFile,
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
      now: new Date('2026-03-12T13:00:00.000Z'),
    });

    expect(scheduled.prompt).toBe('check the logs and continue');
    expect(scheduled.status).toBe('scheduled');
    expect(scheduled.dueAt).toBe('2026-03-12T13:10:00.000Z');

    expect(listDeferredResumesForSessionFile('/tmp/sessions/conv-123.jsonl')).toEqual([
      expect.objectContaining({
        id: scheduled.id,
        prompt: 'check the logs and continue',
        status: 'scheduled',
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

  it('rejects invalid delays', async () => {
    const stateRoot = createTempDir('pa-web-deferred-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    await expect(scheduleDeferredResumeForSessionFile({
      sessionFile: '/tmp/sessions/current.jsonl',
      delay: 'later',
    })).rejects.toThrow('Invalid delay. Use forms like 30s, 10m, 2h, or 1d.');
  });
});
