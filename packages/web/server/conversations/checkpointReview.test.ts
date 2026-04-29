import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getConversationCommitCheckpointMock,
  listConversationCommitCheckpointsMock,
  readSessionMetaMock,
} = vi.hoisted(() => ({
  getConversationCommitCheckpointMock: vi.fn(),
  listConversationCommitCheckpointsMock: vi.fn(),
  readSessionMetaMock: vi.fn(),
}));

vi.mock('@personal-agent/core', async () => {
  const actual = await vi.importActual<typeof import('@personal-agent/core')>('@personal-agent/core');
  return {
    ...actual,
    getConversationCommitCheckpoint: getConversationCommitCheckpointMock,
    listConversationCommitCheckpoints: listConversationCommitCheckpointsMock,
  };
});

vi.mock('./sessions.js', () => ({
  readSessionMeta: readSessionMetaMock,
}));

import {
  parseGitHubRemoteUrl,
  resolveConversationCheckpointRecord,
} from './checkpointReview.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  getConversationCommitCheckpointMock.mockReset();
  listConversationCommitCheckpointsMock.mockReset();
  readSessionMetaMock.mockReset();

  getConversationCommitCheckpointMock.mockReturnValue(null);
  listConversationCommitCheckpointsMock.mockReturnValue([]);
  readSessionMetaMock.mockReturnValue(null);
});

function createTempRepoRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-checkpoint-review-'));
  tempDirs.push(dir);
  return dir;
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
  });
  if (result.error || result.status !== 0) {
    throw new Error((result.stderr ?? result.stdout ?? `git ${args.join(' ')} failed`).trim());
  }

  return result.stdout.trim();
}

function createCommittedRepo() {
  const repoRoot = createTempRepoRoot();
  runGit(repoRoot, ['init', '-q']);
  runGit(repoRoot, ['config', 'user.email', 'patrick@example.com']);
  runGit(repoRoot, ['config', 'user.name', 'Patrick Lee']);

  writeFileSync(join(repoRoot, 'README.md'), 'hello\n', 'utf-8');
  runGit(repoRoot, ['add', 'README.md']);
  runGit(repoRoot, ['commit', '-qm', 'init']);

  writeFileSync(join(repoRoot, 'README.md'), 'hello\nworld\n', 'utf-8');
  runGit(repoRoot, ['add', 'README.md']);
  runGit(repoRoot, ['commit', '-qm', 'feat: add world']);

  const commitSha = runGit(repoRoot, ['rev-parse', 'HEAD']);
  const shortSha = runGit(repoRoot, ['rev-parse', '--short', 'HEAD']);

  return {
    repoRoot,
    commitSha,
    shortSha,
  };
}

describe('checkpointReview', () => {
  it('parses common GitHub remote URL formats', () => {
    expect(parseGitHubRemoteUrl('git@github.com:patleeman/personal-agent.git')).toEqual({
      owner: 'patleeman',
      repo: 'personal-agent',
      repoUrl: 'https://github.com/patleeman/personal-agent',
    });

    expect(parseGitHubRemoteUrl('https://github.com/patleeman/personal-agent')).toEqual({
      owner: 'patleeman',
      repo: 'personal-agent',
      repoUrl: 'https://github.com/patleeman/personal-agent',
    });
  });

  it('resolves saved checkpoints by short hash before falling back to local git', () => {
    const savedCheckpoint = {
      id: 'abc1234def567890abc1234def567890abc12345',
      conversationId: 'conv-123',
      title: 'feat: saved checkpoint',
      cwd: '/tmp/repo',
      commitSha: 'abc1234def567890abc1234def567890abc12345',
      shortSha: 'abc1234',
      subject: 'feat: saved checkpoint',
      authorName: 'Patrick Lee',
      committedAt: '2026-04-14T12:00:00.000Z',
      createdAt: '2026-04-14T12:00:00.000Z',
      updatedAt: '2026-04-14T12:00:00.000Z',
      fileCount: 1,
      linesAdded: 3,
      linesDeleted: 1,
      commentCount: 1,
      files: [{ path: 'README.md', status: 'modified', additions: 3, deletions: 1, patch: 'diff --git a/README.md b/README.md\n' }],
      comments: [{ id: 'comment-1', authorName: 'You', body: 'ship it', createdAt: '2026-04-14T12:05:00.000Z', updatedAt: '2026-04-14T12:05:00.000Z' }],
    };

    getConversationCommitCheckpointMock.mockImplementation(({ checkpointId }: { checkpointId: string }) => checkpointId === savedCheckpoint.id ? savedCheckpoint : null);
    listConversationCommitCheckpointsMock.mockReturnValue([{ ...savedCheckpoint, files: undefined, comments: undefined }]);

    const resolved = resolveConversationCheckpointRecord({
      profile: 'assistant',
      conversationId: 'conv-123',
      checkpointId: 'abc1234',
    });

    expect(resolved).toEqual(expect.objectContaining({
      id: savedCheckpoint.id,
      sourceKind: 'checkpoint',
      commentable: true,
      commentCount: 1,
    }));
    expect(readSessionMetaMock).not.toHaveBeenCalled();
  });

  it('falls back to a local git commit when the hash is not a saved checkpoint', () => {
    const { repoRoot, commitSha, shortSha } = createCommittedRepo();
    readSessionMetaMock.mockReturnValue({ cwd: repoRoot });

    const resolved = resolveConversationCheckpointRecord({
      profile: 'assistant',
      conversationId: 'conv-123',
      checkpointId: shortSha,
    });

    expect(resolved).toEqual(expect.objectContaining({
      id: commitSha,
      conversationId: 'conv-123',
      cwd: repoRoot,
      commitSha,
      shortSha,
      subject: 'feat: add world',
      sourceKind: 'git',
      commentable: false,
      commentCount: 0,
      fileCount: 1,
    }));
    expect(resolved?.files[0]).toEqual(expect.objectContaining({
      path: 'README.md',
      additions: 1,
      deletions: 0,
    }));
    expect(resolved?.files[0]?.patch).toContain('+world');
  });
});
