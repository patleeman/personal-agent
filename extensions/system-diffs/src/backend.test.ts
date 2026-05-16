import { describe, expect, it, vi } from 'vitest';

const mockListCheckpoints = vi.fn();
const mockGetCheckpoint = vi.fn();
const mockSaveCheckpoint = vi.fn();

vi.mock('@personal-agent/extensions/backend/checkpoints', () => ({
  listConversationCommitCheckpoints: (...args: unknown[]) => mockListCheckpoints(...args),
  getConversationCommitCheckpoint: (...args: unknown[]) => mockGetCheckpoint(...args),
  saveConversationCommitCheckpoint: (...args: unknown[]) => mockSaveCheckpoint(...args),
}));

import { checkpoint } from './backend.js';

function createCtx(overrides?: Record<string, unknown>) {
  return {
    profile: 'test-profile',
    toolContext: { conversationId: 'conv-1', cwd: '/tmp/test-repo' },
    ui: { invalidate: vi.fn() },
    ...overrides,
  };
}

describe('system-diffs backend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('input validation', () => {
    it('throws when conversationId is missing', async () => {
      await expect(checkpoint({ action: 'list' }, createCtx({ toolContext: { cwd: '/tmp/test-repo' } }))).rejects.toThrow(
        'conversationId is required',
      );
    });

    it('throws for unsupported action', async () => {
      await expect(checkpoint({ action: 'unknown' } as never, createCtx())).rejects.toThrow('Unsupported checkpoint action');
    });
  });

  describe('list action', () => {
    it('returns formatted list when checkpoints exist', async () => {
      mockListCheckpoints.mockReturnValue([
        { id: 'abc1234', shortSha: 'abc1234', subject: 'Add feature', fileCount: 3, linesAdded: 10, linesDeleted: 2 },
        { id: 'def5678', shortSha: 'def5678', subject: 'Fix bug', fileCount: 1, linesAdded: 5, linesDeleted: 1 },
      ]);

      const result = await checkpoint({ action: 'list' }, createCtx());
      expect(result.action).toBe('list');
      expect(result.checkpointCount).toBe(2);
      expect(result.checkpointIds).toEqual(['abc1234', 'def5678']);
      expect(result.text).toContain('Commit checkpoints for conversation conv-1');
      expect(result.text).toContain('abc1234 Add feature');
      expect(result.text).toContain('def5678 Fix bug');
    });

    it('returns empty message when no checkpoints', async () => {
      mockListCheckpoints.mockReturnValue([]);
      const result = await checkpoint({ action: 'list' }, createCtx());
      expect(result.text).toContain('No commit checkpoints saved');
      expect(result.checkpointCount).toBe(0);
    });
  });

  describe('get action', () => {
    it('returns formatted checkpoint detail when found', async () => {
      mockGetCheckpoint.mockReturnValue({
        id: 'abc1234',
        commitSha: 'abc1234def5678',
        shortSha: 'abc1234',
        subject: 'Add README',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: '2025-01-01T00:00:00Z',
        fileCount: 2,
        linesAdded: 20,
        linesDeleted: 0,
        files: [
          { path: 'README.md', status: 'added', additions: 15, deletions: 0 },
          { path: 'CONTRIBUTING.md', status: 'added', additions: 5, deletions: 0 },
        ],
      });

      const result = await checkpoint({ action: 'get', checkpointId: 'abc1234' }, createCtx());
      expect(result.action).toBe('get');
      expect(result.shortSha).toBe('abc1234');
      expect(result.subject).toBe('Add README');
      expect(result.text).toContain('abc1234 Add README');
      expect(result.text).toContain('Test User <test@example.com>');
      expect(result.text).toContain('added README.md (+15 -0)');
      expect(result.text).toContain('added CONTRIBUTING.md (+5 -0)');
    });

    it('returns checkpoint without email when authorEmail is empty', async () => {
      mockGetCheckpoint.mockReturnValue({
        id: 'abc1234',
        commitSha: 'abc1234def5678',
        shortSha: 'abc1234',
        subject: 'Quick fix',
        authorName: 'Test User',
        authorEmail: '',
        committedAt: '2025-01-01T00:00:00Z',
        fileCount: 1,
        linesAdded: 1,
        linesDeleted: 1,
        files: [{ path: 'index.ts', status: 'modified', additions: 1, deletions: 1 }],
      });

      const result = await checkpoint({ action: 'get', checkpointId: 'abc1234' }, createCtx());
      expect(result.text).not.toContain('<');
      expect(mockGetCheckpoint).toHaveBeenCalledWith({ profile: 'test-profile', conversationId: 'conv-1', checkpointId: 'abc1234' });
    });

    it('throws when checkpoint is not found', async () => {
      mockGetCheckpoint.mockReturnValue(null);
      await expect(checkpoint({ action: 'get', checkpointId: 'abc1234' }, createCtx())).rejects.toThrow(
        'Commit checkpoint abc1234 was not found',
      );
    });

    it('throws when checkpointId is missing', async () => {
      await expect(checkpoint({ action: 'get' } as never, createCtx())).rejects.toThrow('checkpointId is required');
    });
  });

  describe('save action', () => {
    it('does not fail when UI invalidation is unavailable', async () => {
      const shell = {
        exec: vi.fn(async ({ args }: { args: string[] }) => {
          const command = args.join(' ');
          if (command === 'rev-parse --show-toplevel') return { stdout: '/tmp/test-repo\n' };
          if (command.startsWith('add --all --')) return { stdout: '' };
          if (command.startsWith('diff --cached --name-only --')) return { stdout: 'src/file.ts\n' };
          if (command.startsWith('commit --only -m msg --')) return { stdout: '' };
          if (command === 'rev-parse HEAD') return { stdout: 'abc1234def5678\n' };
          if (command.startsWith('show -s --format=')) {
            return {
              stdout: 'abc1234def5678\u0000abc1234\u0000msg\u0000msg\u0000Test User\u0000test@example.com\u00002025-01-01T00:00:00Z',
            };
          }
          if (command.startsWith('show --format= --patch')) {
            return { stdout: 'diff --git a/src/file.ts b/src/file.ts\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1 +1 @@\n-old\n+new\n' };
          }
          throw new Error(`unexpected git command: ${command}`);
        }),
      };
      mockSaveCheckpoint.mockReturnValue({
        id: 'abc1234def5678',
        commitSha: 'abc1234def5678',
        shortSha: 'abc1234',
        title: 'msg',
        subject: 'msg',
        fileCount: 1,
        linesAdded: 1,
        linesDeleted: 1,
        cwd: '/tmp/test-repo',
        updatedAt: '2025-01-01T00:00:00Z',
      });

      const result = await checkpoint({ action: 'save', message: 'msg', paths: ['src/file.ts'] }, createCtx({ shell, ui: undefined }));

      expect(result.text).toContain('Saved checkpoint abc1234 msg');
    });
  });

  describe('save action validation', () => {
    it('throws when cwd is missing from toolContext', async () => {
      await expect(
        checkpoint({ action: 'save', message: 'msg', paths: ['src/'] }, createCtx({ toolContext: { conversationId: 'conv-1' } })),
      ).rejects.toThrow('cwd is required');
    });

    it('throws when message is missing', async () => {
      await expect(checkpoint({ action: 'save', paths: ['src/'] }, createCtx())).rejects.toThrow('message is required');
    });

    it('throws when message is empty string', async () => {
      await expect(checkpoint({ action: 'save', message: '   ', paths: ['src/'] }, createCtx())).rejects.toThrow('message is required');
    });

    it('throws when paths is missing', async () => {
      await expect(checkpoint({ action: 'save', message: 'msg' }, createCtx())).rejects.toThrow('paths are required');
    });

    it('throws when paths is empty array', async () => {
      await expect(checkpoint({ action: 'save', message: 'msg', paths: [] }, createCtx())).rejects.toThrow('paths are required');
    });

    it('throws when paths only contains trivial entries', async () => {
      await expect(checkpoint({ action: 'save', message: 'msg', paths: ['.'] }, createCtx())).rejects.toThrow('paths are required');
    });

    it('throws when path escapes cwd', async () => {
      await expect(checkpoint({ action: 'save', message: 'msg', paths: ['../outside'] }, createCtx())).rejects.toThrow(
        'Invalid checkpoint path',
      );
    });
  });
});
