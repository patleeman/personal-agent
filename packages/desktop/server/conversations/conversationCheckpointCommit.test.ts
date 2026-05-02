import { describe, expect, it, vi } from 'vitest';

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }));

import {
  readRequiredCheckpointString,
  normalizeCheckpointPaths,
  parseCheckpointDiffSections,
  createConversationCheckpointCommit,
} from './conversationCheckpointCommit.js';

const NULL = '\x00';
const MOCK_METADATA = `abc123def4567890abc123def4567890abc123${NULL}abc123d${NULL}Fix test${NULL}${NULL}Test Author${NULL}author@test.com${NULL}2026-05-02T10:00:00.000Z${NULL}`;

function mockGit(stdout: string, status = 0, stderr = '') {
  spawnSyncMock.mockReturnValueOnce({ stdout, stderr, status, error: undefined, pid: 0, output: [], signal: null });
}

function mockError(error: Error) {
  spawnSyncMock.mockReturnValueOnce({ stdout: '', stderr: '', status: 1, error, pid: 0, output: [], signal: null });
}

describe('readRequiredCheckpointString', () => {
  it('returns trimmed value for valid input', () => {
    expect(readRequiredCheckpointString('  hello  ', 'Label')).toBe('hello');
  });
  it('throws for undefined', () => {
    expect(() => readRequiredCheckpointString(undefined, 'Label')).toThrow('Label is required.');
  });
  it('throws for empty string', () => {
    expect(() => readRequiredCheckpointString('', 'Label')).toThrow('Label is required.');
  });
  it('throws for whitespace-only', () => {
    expect(() => readRequiredCheckpointString('   ', 'Label')).toThrow('Label is required.');
  });
});

describe('normalizeCheckpointPaths', () => {
  const cwd = '/repo';

  it('returns [.] for root path', () => {
    expect(normalizeCheckpointPaths(cwd, ['.'])).toEqual(['.']);
  });
  it('returns [.] for ./', () => {
    expect(normalizeCheckpointPaths(cwd, ['./'])).toEqual(['.']);
  });
  it('normalizes relative paths', () => {
    expect(normalizeCheckpointPaths(cwd, ['src/index.ts'])).toEqual(['src/index.ts']);
  });
  it('normalizes ./ prefix', () => {
    expect(normalizeCheckpointPaths(cwd, ['./src/index.ts'])).toEqual(['src/index.ts']);
  });
  it('resolves absolute paths', () => {
    expect(normalizeCheckpointPaths('/repo', ['/repo/packages/core/src/index.ts'])).toEqual(['packages/core/src/index.ts']);
  });
  it('deduplicates paths', () => {
    expect(normalizeCheckpointPaths(cwd, ['src/a.ts', 'src/a.ts'])).toEqual(['src/a.ts']);
  });
  it('strips empty values', () => {
    expect(normalizeCheckpointPaths(cwd, ['', 'src/a.ts'])).toEqual(['src/a.ts']);
  });
  it('throws for out-of-repo paths', () => {
    expect(() => normalizeCheckpointPaths(cwd, ['/other/path'])).toThrow('Invalid checkpoint path');
  });
  it('throws when no valid paths remain', () => {
    expect(() => normalizeCheckpointPaths(cwd, [''])).toThrow('paths are required.');
  });
});

describe('parseCheckpointDiffSections', () => {
  it('parses a modified file section', () => {
    const patch = [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1 +1,2 @@',
      ' unchanged',
      '+added line',
      '-deleted line',
    ].join('\n');
    const files = parseCheckpointDiffSections(patch);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'src/index.ts', status: 'modified', additions: 1, deletions: 1 });
  });

  it('parses an added file', () => {
    const patch = [
      'diff --git a/new-file.ts b/new-file.ts',
      '--- /dev/null',
      '+++ b/new-file.ts',
      '@@ -0,0 +1 @@',
      '+new content',
    ].join('\n');
    const files = parseCheckpointDiffSections(patch);
    expect(files[0]).toMatchObject({ path: 'new-file.ts', status: 'added', additions: 1, deletions: 0 });
  });

  it('parses a deleted file', () => {
    const patch = [
      'diff --git a/old-file.ts b/old-file.ts',
      '--- a/old-file.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-removed line',
    ].join('\n');
    const files = parseCheckpointDiffSections(patch);
    expect(files[0]).toMatchObject({ path: 'old-file.ts', status: 'deleted', additions: 0, deletions: 1 });
  });

  it('parses a renamed file', () => {
    const patch = [
      'diff --git a/old-name.ts b/new-name.ts',
      'rename from old-name.ts',
      'rename to new-name.ts',
      '--- a/old-name.ts',
      '+++ b/new-name.ts',
    ].join('\n');
    const files = parseCheckpointDiffSections(patch);
    expect(files[0]).toMatchObject({ path: 'new-name.ts', status: 'renamed', previousPath: 'old-name.ts' });
  });

  it('parses a copied file', () => {
    const patch = [
      'diff --git a/source.ts b/copy.ts',
      'copy from source.ts',
      'copy to copy.ts',
      '--- a/source.ts',
      '+++ b/copy.ts',
    ].join('\n');
    const files = parseCheckpointDiffSections(patch);
    expect(files[0]).toMatchObject({ path: 'copy.ts', status: 'copied' });
  });

  it('parses multiple file sections', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-old', '+new',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts', '+++ b/b.ts', '@@ -1 +1 @@', '-x', '+y',
    ].join('\n');
    expect(parseCheckpointDiffSections(patch)).toHaveLength(2);
  });

  it('returns empty array for input with no diff sections', () => {
    expect(parseCheckpointDiffSections('random text')).toEqual([]);
  });
});

describe('createConversationCheckpointCommit', () => {
  afterEach(() => {
    spawnSyncMock.mockClear();
  });

  it('creates a commit and parses the result', () => {
    // 1. git rev-parse --show-toplevel
    mockGit('/repo\n', 0);
    // 2. git add --all
    mockGit('', 0);
    // 3. git diff --cached --quiet (spawnSync directly) exit 1 = has changes
    mockGit('', 1);
    // 4. git commit
    mockGit('', 0);
    // 5. git rev-parse HEAD
    mockGit('abc123def4567890abc123def4567890abc123\n', 0);
    // 6. git show -s --format=...
    mockGit(MOCK_METADATA, 0);
    // 7. git show --format= --patch ...
    const diffOutput = [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1 +1,2 @@',
      ' unchanged',
      '+added',
      '-removed',
    ].join('\n');
    mockGit(diffOutput, 0);

    const result = createConversationCheckpointCommit({
      cwd: '/repo',
      message: 'Fix test',
      paths: ['src/index.ts'],
    });

    expect(result.metadata.commitSha).toBe('abc123def4567890abc123def4567890abc123');
    expect(result.metadata.shortSha).toBe('abc123d');
    expect(result.metadata.subject).toBe('Fix test');
    expect(result.metadata.authorName).toBe('Test Author');
    expect(result.linesAdded).toBe(1);
    expect(result.linesDeleted).toBe(1);
    expect(result.files).toHaveLength(1);
  });

  it('throws when git rev-parse fails', () => {
    mockGit('', 1, 'fatal: not a git repository');
    expect(() => createConversationCheckpointCommit({
      cwd: '/not-repo', message: 'msg', paths: ['file.ts'],
    })).toThrow('not a git repository');
  });

  it('throws when no staged changes found', () => {
    mockGit('/repo\n', 0);
    mockGit('', 0);
    // git diff --cached --quiet exit 0 = no changes
    mockGit('', 0);

    expect(() => createConversationCheckpointCommit({
      cwd: '/repo', message: 'msg', paths: ['file.ts'],
    })).toThrow('No staged changes were found');
  });

  it('throws on spawn error', () => {
    mockError(new Error('ENOENT'));
    expect(() => createConversationCheckpointCommit({
      cwd: '/repo', message: 'msg', paths: ['file.ts'],
    })).toThrow('ENOENT');
  });
});
