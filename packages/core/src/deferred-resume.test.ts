import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activateDeferredResume,
  activateDueDeferredResumes,
  createEmptyDeferredResumeState,
  getDueScheduledSessionDeferredResumeEntries,
  getReadySessionDeferredResumeEntries,
  loadDeferredResumeState,
  mergeDeferredResumeStateDocuments,
  parseDeferredResumeDelayMs,
  readSessionConversationId,
  removeDeferredResume,
  retryDeferredResume,
  saveDeferredResumeState,
  scheduleDeferredResume,
} from './deferred-resume.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('deferred resume state', () => {
  it('parses supported deferred resume delay strings', () => {
    expect(parseDeferredResumeDelayMs('30s')).toBe(30_000);
    expect(parseDeferredResumeDelayMs('10m')).toBe(600_000);
    expect(parseDeferredResumeDelayMs('2h')).toBe(7_200_000);
    expect(parseDeferredResumeDelayMs('1d')).toBe(86_400_000);
    expect(parseDeferredResumeDelayMs('later')).toBeUndefined();
  });

  it('loads legacy entries without explicit status as scheduled', () => {
    const dir = createTempDir('deferred-resume-state-');
    const stateFile = join(dir, 'state.json');

    writeFileSync(stateFile, JSON.stringify({
      version: 1,
      resumes: {
        one: {
          id: 'one',
          sessionFile: '/tmp/sessions/1.jsonl',
          prompt: 'continue',
          dueAt: '2026-03-08T12:00:00.000Z',
          createdAt: '2026-03-08T11:50:00.000Z',
          attempts: 0,
        },
      },
    }));

    const state = loadDeferredResumeState(stateFile);
    expect(state.resumes.one).toMatchObject({
      id: 'one',
      status: 'scheduled',
    });
  });

  it('schedules, activates, retries, and removes deferred resumes', () => {
    const state = createEmptyDeferredResumeState();

    scheduleDeferredResume(state, {
      id: 'resume-1',
      sessionFile: '/tmp/sessions/current.jsonl',
      prompt: 'continue',
      dueAt: '2026-03-08T12:00:00.000Z',
      createdAt: '2026-03-08T11:50:00.000Z',
      attempts: 0,
    });

    expect(getDueScheduledSessionDeferredResumeEntries(state, '/tmp/sessions/current.jsonl', new Date('2026-03-08T11:59:59.000Z'))).toEqual([]);

    const activatedEarly = activateDeferredResume(state, {
      id: 'resume-1',
      at: new Date('2026-03-08T11:55:00.000Z'),
    });
    expect(activatedEarly).toMatchObject({
      id: 'resume-1',
      status: 'ready',
      readyAt: '2026-03-08T11:55:00.000Z',
    });
    expect(getReadySessionDeferredResumeEntries(state, '/tmp/sessions/current.jsonl')).toHaveLength(1);

    const retried = retryDeferredResume(state, {
      id: 'resume-1',
      dueAt: '2026-03-08T12:05:00.000Z',
    });
    expect(retried).toMatchObject({
      id: 'resume-1',
      status: 'scheduled',
      dueAt: '2026-03-08T12:05:00.000Z',
      attempts: 1,
    });
    expect(getReadySessionDeferredResumeEntries(state, '/tmp/sessions/current.jsonl')).toEqual([]);

    const activated = activateDueDeferredResumes(state, {
      at: new Date('2026-03-08T12:05:30.000Z'),
    });

    expect(activated).toHaveLength(1);
    expect(activated[0]).toMatchObject({
      id: 'resume-1',
      status: 'ready',
      readyAt: '2026-03-08T12:05:30.000Z',
    });
    expect(getReadySessionDeferredResumeEntries(state, '/tmp/sessions/current.jsonl')).toHaveLength(1);

    expect(removeDeferredResume(state, 'resume-1')).toBe(true);
    expect(removeDeferredResume(state, 'resume-1')).toBe(false);
  });

  it('persists normalized state to disk', () => {
    const dir = createTempDir('deferred-resume-save-');
    const stateFile = join(dir, 'state.json');
    const state = createEmptyDeferredResumeState();

    scheduleDeferredResume(state, {
      id: 'resume-1',
      sessionFile: '/tmp/sessions/current.jsonl',
      prompt: 'continue',
      dueAt: '2026-03-08T12:00:00.000Z',
      createdAt: '2026-03-08T11:50:00.000Z',
      attempts: 0,
    });

    saveDeferredResumeState(state, stateFile);
    const persisted = JSON.parse(readFileSync(stateFile, 'utf-8')) as {
      version: number;
      resumes: Record<string, { status: string }>;
    };

    expect(persisted.version).toBe(3);
    expect(persisted.resumes['resume-1']?.status).toBe('scheduled');
  });

  it('merges deferred resume documents by union and latest retry state', () => {
    const merged = mergeDeferredResumeStateDocuments({
      documents: [
        {
          version: 2,
          resumes: {
            'resume-1': {
              id: 'resume-1',
              sessionFile: '/tmp/sessions/current.jsonl',
              prompt: 'continue',
              dueAt: '2026-03-08T12:00:00.000Z',
              createdAt: '2026-03-08T11:50:00.000Z',
              attempts: 0,
              status: 'scheduled',
            },
          },
        },
        {
          version: 2,
          resumes: {
            'resume-1': {
              id: 'resume-1',
              sessionFile: '/tmp/sessions/current.jsonl',
              prompt: 'continue',
              dueAt: '2026-03-08T12:00:00.000Z',
              createdAt: '2026-03-08T11:50:00.000Z',
              attempts: 0,
              status: 'ready',
              readyAt: '2026-03-08T12:00:30.000Z',
            },
          },
        },
        {
          version: 2,
          resumes: {
            'resume-1': {
              id: 'resume-1',
              sessionFile: '/tmp/sessions/current.jsonl',
              prompt: 'continue later',
              dueAt: '2026-03-08T12:05:00.000Z',
              createdAt: '2026-03-08T11:50:00.000Z',
              attempts: 1,
              status: 'scheduled',
            },
            'resume-2': {
              id: 'resume-2',
              sessionFile: '/tmp/sessions/other.jsonl',
              prompt: 'follow up',
              dueAt: '2026-03-08T13:00:00.000Z',
              createdAt: '2026-03-08T12:55:00.000Z',
              attempts: 0,
              status: 'scheduled',
            },
          },
        },
      ],
    });

    expect(merged).toEqual({
      version: 3,
      resumes: {
        'resume-1': {
          id: 'resume-1',
          sessionFile: '/tmp/sessions/current.jsonl',
          prompt: 'continue later',
          dueAt: '2026-03-08T12:05:00.000Z',
          createdAt: '2026-03-08T11:50:00.000Z',
          attempts: 1,
          status: 'scheduled',
          kind: 'continue',
          delivery: {
            alertLevel: 'none',
            autoResumeIfOpen: true,
            requireAck: false,
          },
        },
        'resume-2': {
          id: 'resume-2',
          sessionFile: '/tmp/sessions/other.jsonl',
          prompt: 'follow up',
          dueAt: '2026-03-08T13:00:00.000Z',
          createdAt: '2026-03-08T12:55:00.000Z',
          attempts: 0,
          status: 'scheduled',
          kind: 'continue',
          delivery: {
            alertLevel: 'none',
            autoResumeIfOpen: true,
            requireAck: false,
          },
        },
      },
    });
  });
});

describe('deferred resume session file parsing', () => {
  it('reads the conversation id from a session file', () => {
    const dir = createTempDir('deferred-resume-session-');
    const sessionDir = join(dir, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, 'current.jsonl');
    writeFileSync(
      sessionFile,
      JSON.stringify({ type: 'session', id: 'conv-123', timestamp: '2026-03-08T12:00:00.000Z', cwd: '/tmp/workspace' }) + '\n',
    );

    expect(readSessionConversationId(sessionFile)).toBe('conv-123');
  });

  it('returns undefined when the session file is missing or invalid', () => {
    const dir = createTempDir('deferred-resume-session-missing-');
    expect(readSessionConversationId(join(dir, 'missing.jsonl'))).toBeUndefined();
  });
});
