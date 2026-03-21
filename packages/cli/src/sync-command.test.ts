import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './index.js';
import { syncRepoGitattributes } from './sync-command.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('sync conversation attention merge command', () => {
  it('merges base/current/other files into the current file', async () => {
    const dir = createTempDir('personal-agent-sync-merge-');
    const basePath = join(dir, 'base.json');
    const currentPath = join(dir, 'current.json');
    const otherPath = join(dir, 'other.json');

    writeFileSync(basePath, `${JSON.stringify({
      version: 1,
      profile: 'assistant',
      conversations: {
        'conv-123': {
          conversationId: 'conv-123',
          acknowledgedMessageCount: 5,
          readAt: '2026-03-12T12:05:00.000Z',
          updatedAt: '2026-03-12T12:05:00.000Z',
        },
      },
    }, null, 2)}\n`);

    writeFileSync(currentPath, `${JSON.stringify({
      version: 1,
      profile: 'assistant',
      conversations: {
        'conv-123': {
          conversationId: 'conv-123',
          acknowledgedMessageCount: 9,
          readAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '2026-03-12T12:09:00.000Z',
        },
      },
    }, null, 2)}\n`);

    writeFileSync(otherPath, `${JSON.stringify({
      version: 1,
      profile: 'assistant',
      conversations: {
        'conv-789': {
          conversationId: 'conv-789',
          acknowledgedMessageCount: 2,
          readAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '2026-03-12T12:06:00.000Z',
          forcedUnread: true,
        },
      },
    }, null, 2)}\n`);

    const exitCode = await runCli([
      'sync',
      'merge-conversation-attention',
      basePath,
      currentPath,
      otherPath,
    ]);

    expect(exitCode).toBe(0);

    expect(JSON.parse(readFileSync(currentPath, 'utf-8'))).toEqual({
      version: 1,
      profile: 'assistant',
      conversations: {
        'conv-123': {
          conversationId: 'conv-123',
          acknowledgedMessageCount: 9,
          readAt: '2026-03-12T12:05:00.000Z',
          updatedAt: '2026-03-12T12:09:00.000Z',
        },
        'conv-789': {
          conversationId: 'conv-789',
          acknowledgedMessageCount: 2,
          readAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '2026-03-12T12:06:00.000Z',
          forcedUnread: true,
        },
      },
    });
  });

  it('does not sync conversation attention state by managed gitattributes', () => {
    expect(syncRepoGitattributes()).not.toContain('pi-agent/state/conversation-attention');
  });
});

describe('sync deferred resumes merge command', () => {
  it('merges base/current/other files into the current file', async () => {
    const dir = createTempDir('personal-agent-sync-deferred-merge-');
    const basePath = join(dir, 'base.json');
    const currentPath = join(dir, 'current.json');
    const otherPath = join(dir, 'other.json');

    writeFileSync(basePath, `${JSON.stringify({
      version: 2,
      resumes: {
        'resume-1': {
          id: 'resume-1',
          sessionFile: '/tmp/sessions/current.jsonl',
          prompt: 'continue',
          dueAt: '2026-03-12T12:00:00.000Z',
          createdAt: '2026-03-12T11:55:00.000Z',
          attempts: 0,
          status: 'scheduled',
        },
      },
    }, null, 2)}
`);

    writeFileSync(currentPath, `${JSON.stringify({
      version: 2,
      resumes: {
        'resume-1': {
          id: 'resume-1',
          sessionFile: '/tmp/sessions/current.jsonl',
          prompt: 'continue',
          dueAt: '2026-03-12T12:00:00.000Z',
          createdAt: '2026-03-12T11:55:00.000Z',
          attempts: 0,
          status: 'ready',
          readyAt: '2026-03-12T12:00:30.000Z',
        },
      },
    }, null, 2)}
`);

    writeFileSync(otherPath, `${JSON.stringify({
      version: 2,
      resumes: {
        'resume-1': {
          id: 'resume-1',
          sessionFile: '/tmp/sessions/current.jsonl',
          prompt: 'continue later',
          dueAt: '2026-03-12T12:05:00.000Z',
          createdAt: '2026-03-12T11:55:00.000Z',
          attempts: 1,
          status: 'scheduled',
        },
        'resume-2': {
          id: 'resume-2',
          sessionFile: '/tmp/sessions/other.jsonl',
          prompt: 'follow up',
          dueAt: '2026-03-12T13:00:00.000Z',
          createdAt: '2026-03-12T12:50:00.000Z',
          attempts: 0,
          status: 'scheduled',
        },
      },
    }, null, 2)}
`);

    const exitCode = await runCli([
      'sync',
      'merge-deferred-resumes',
      basePath,
      currentPath,
      otherPath,
    ]);

    expect(exitCode).toBe(0);

    expect(JSON.parse(readFileSync(currentPath, 'utf-8'))).toEqual({
      version: 2,
      resumes: {
        'resume-1': {
          id: 'resume-1',
          sessionFile: '/tmp/sessions/current.jsonl',
          prompt: 'continue later',
          dueAt: '2026-03-12T12:05:00.000Z',
          createdAt: '2026-03-12T11:55:00.000Z',
          attempts: 1,
          status: 'scheduled',
        },
        'resume-2': {
          id: 'resume-2',
          sessionFile: '/tmp/sessions/other.jsonl',
          prompt: 'follow up',
          dueAt: '2026-03-12T13:00:00.000Z',
          createdAt: '2026-03-12T12:50:00.000Z',
          attempts: 0,
          status: 'scheduled',
        },
      },
    });
  });

  it('does not sync deferred resume state by managed gitattributes', () => {
    expect(syncRepoGitattributes()).not.toContain('pi-agent/deferred-resumes-state.json');
  });
});
