import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getConversationCommitCheckpoint,
  listConversationCommitCheckpoints,
  resolveConversationCommitCheckpointPath,
  resolveProfileConversationCommitCheckpointsDir,
  saveConversationCommitCheckpoint,
  validateConversationCommitCheckpointId,
} from './conversation-commit-checkpoints.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-conversation-commit-checkpoints-'));
  tempDirs.push(dir);
  return dir;
}

describe('conversation commit checkpoint storage', () => {
  it('saves and lists commit checkpoints', () => {
    const stateRoot = createTempStateRoot();

    expect(resolveProfileConversationCommitCheckpointsDir({ stateRoot, profile: 'assistant' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-commit-checkpoints', 'assistant'));

    const record = saveConversationCommitCheckpoint({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conversation-1',
      commitSha: 'abc1234def567890abc1234def567890abc12345',
      shortSha: 'abc1234',
      title: 'feat: add checkpoint review',
      cwd: '/tmp/workspace',
      subject: 'feat: add checkpoint review',
      body: 'Detailed body.',
      authorName: 'Patrick Lee',
      authorEmail: 'patrick@example.com',
      committedAt: '2026-04-14T12:00:00.000Z',
      createdAt: '2026-04-14T12:00:01.000Z',
      updatedAt: '2026-04-14T12:00:01.000Z',
      linesAdded: 12,
      linesDeleted: 3,
      files: [
        {
          path: 'packages/web/src/pages/ConversationPage.tsx',
          status: 'modified',
          additions: 12,
          deletions: 3,
          patch: 'diff --git a/packages/web/src/pages/ConversationPage.tsx b/packages/web/src/pages/ConversationPage.tsx\n@@ -1 +1 @@\n-old\n+new\n',
        },
      ],
    });

    expect(record.fileCount).toBe(1);
    expect(record.linesAdded).toBe(12);
    expect(record.linesDeleted).toBe(3);

    expect(resolveConversationCommitCheckpointPath({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conversation-1',
      checkpointId: record.id,
    })).toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-commit-checkpoints', 'assistant', 'conversation-1', `${record.id}.json`));

    expect(getConversationCommitCheckpoint({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conversation-1',
      checkpointId: record.id,
    })).toEqual(record);

    expect(listConversationCommitCheckpoints({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conversation-1',
    })).toEqual([
      {
        id: 'abc1234def567890abc1234def567890abc12345',
        conversationId: 'conversation-1',
        title: 'feat: add checkpoint review',
        cwd: '/tmp/workspace',
        commitSha: 'abc1234def567890abc1234def567890abc12345',
        shortSha: 'abc1234',
        subject: 'feat: add checkpoint review',
        body: 'Detailed body.',
        authorName: 'Patrick Lee',
        authorEmail: 'patrick@example.com',
        committedAt: '2026-04-14T12:00:00.000Z',
        createdAt: '2026-04-14T12:00:01.000Z',
        updatedAt: '2026-04-14T12:00:01.000Z',
        fileCount: 1,
        linesAdded: 12,
        linesDeleted: 3,
      },
    ]);
  });

  it('rejects invalid checkpoint ids', () => {
    expect(() => validateConversationCommitCheckpointId('bad/id')).toThrow('Invalid commit checkpoint id');
  });
});
