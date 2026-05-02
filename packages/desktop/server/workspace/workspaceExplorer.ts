import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { type LocalCheckpointCommitFile, parseCheckpointDiffSections } from '../conversations/conversationCheckpointCommit.js';
import { type GitStatusChangeKind, readGitRepoInfo, readGitStatusSummary } from './gitStatus.js';

export type WorkspaceEntryKind = 'file' | 'directory' | 'symlink' | 'other';

export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: WorkspaceEntryKind;
  size: number | null;
  modifiedAt: string | null;
  gitStatus: GitStatusChangeKind | null;
  descendantGitStatusCount: number;
}

export interface WorkspaceRootSnapshot {
  cwd: string;
  root: string;
  rootName: string;
  rootKind: 'git' | 'cwd';
  activeCwdRelativePath: string | null;
  branch: string | null;
  changes: Array<{ relativePath: string; change: GitStatusChangeKind }>;
}

export interface WorkspaceDirectoryListing extends WorkspaceRootSnapshot {
  path: string;
  entries: WorkspaceEntry[];
}

export interface WorkspaceFileContent extends WorkspaceRootSnapshot {
  path: string;
  name: string;
  exists: boolean;
  kind: WorkspaceEntryKind;
  size: number | null;
  modifiedAt: string | null;
  binary: boolean;
  tooLarge: boolean;
  truncated: boolean;
  content: string | null;
  gitStatus: GitStatusChangeKind | null;
}

export interface WorkspaceDiffOverlay extends WorkspaceRootSnapshot {
  path: string;
  gitStatus: GitStatusChangeKind | null;
  binary: boolean;
  tooLarge: boolean;
  addedLines: number[];
  deletedBlocks: Array<{ afterLine: number; lines: string[] }>;
}

const MAX_FILE_BYTES = 1024 * 512;
const MAX_DIFF_FILE_BYTES = 1024 * 1024;
const UNCOMMITTED_DIFF_MAX_FILES = 200;
const UNCOMMITTED_DIFF_TIMEOUT_MS = 5_000;

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
    timeout: 2_500,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function normalizeRelativePath(input: string | null | undefined): string {
  const trimmed = (input ?? '').replace(/\\/g, '/').trim();
  if (!trimmed || trimmed === '.') {
    return '';
  }

  return trimmed
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
}

function assertSafeWorkspacePath(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const absolute = resolve(root, normalized);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    throw new Error('Path escapes workspace root');
  }

  return absolute;
}

function toWorkspaceRelative(root: string, absolutePath: string): string | null {
  const rel = relative(root, absolutePath).replace(/\\/g, '/');
  if (!rel || rel === '.') {
    return '';
  }
  if (rel.startsWith('..')) {
    return null;
  }
  return rel;
}

export function readWorkspaceRootSnapshot(cwd: string): WorkspaceRootSnapshot {
  const absoluteCwd = realpathSync(resolve(cwd));
  const repo = readGitRepoInfo(absoluteCwd);
  const root = repo?.root ?? absoluteCwd;
  const git = repo ? readGitStatusSummary(root) : null;
  return {
    cwd: absoluteCwd,
    root,
    rootName: repo?.name ?? basename(root),
    rootKind: repo ? 'git' : 'cwd',
    activeCwdRelativePath: toWorkspaceRelative(root, absoluteCwd),
    branch: git?.branch ?? null,
    changes: git?.changes ?? [],
  };
}

function statKind(stats: Stats): WorkspaceEntryKind {
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  if (stats.isSymbolicLink()) return 'symlink';
  return 'other';
}

function statusForPath(snapshot: WorkspaceRootSnapshot, relativePath: string): GitStatusChangeKind | null {
  return snapshot.changes.find((change) => change.relativePath === relativePath)?.change ?? null;
}

function descendantStatusCount(snapshot: WorkspaceRootSnapshot, relativePath: string): number {
  if (!relativePath) return snapshot.changes.length;
  const prefix = `${relativePath}/`;
  return snapshot.changes.filter((change) => change.relativePath.startsWith(prefix)).length;
}

export function listWorkspaceDirectory(cwd: string, relativePath?: string | null): WorkspaceDirectoryListing {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  const absolutePath = assertSafeWorkspacePath(snapshot.root, path);
  const stats = statSync(absolutePath);
  if (!stats.isDirectory()) {
    throw new Error('Path is not a directory');
  }

  const entries = readdirSync(absolutePath, { withFileTypes: true })
    .map((entry): WorkspaceEntry | null => {
      const entryRelativePath = [path, entry.name].filter(Boolean).join('/');
      const entryAbsolutePath = resolve(absolutePath, entry.name);
      let entryStats: ReturnType<typeof statSync>;
      try {
        entryStats = statSync(entryAbsolutePath);
      } catch {
        return null;
      }
      const kind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symlink' : statKind(entryStats);
      return {
        name: entry.name,
        path: entryRelativePath,
        kind,
        size: entryStats.isFile() ? entryStats.size : null,
        modifiedAt: entryStats.mtime.toISOString(),
        gitStatus: statusForPath(snapshot, entryRelativePath),
        descendantGitStatusCount: kind === 'directory' ? descendantStatusCount(snapshot, entryRelativePath) : 0,
      };
    })
    .filter((entry): entry is WorkspaceEntry => Boolean(entry))
    .sort((left, right) => {
      if (left.kind === 'directory' && right.kind !== 'directory') return -1;
      if (left.kind !== 'directory' && right.kind === 'directory') return 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });

  return { ...snapshot, path, entries };
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious++;
  }
  return sample.length > 0 && suspicious / sample.length > 0.08;
}

function readFileSample(path: string, size: number): Buffer {
  const length = Math.min(size, 8192);
  if (length <= 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    const bytesRead = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

export function readWorkspaceFile(cwd: string, relativePath: string, force = false): WorkspaceFileContent {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  const absolutePath = assertSafeWorkspacePath(snapshot.root, path);
  const exists = existsSync(absolutePath);
  if (!exists) {
    return {
      ...snapshot,
      path,
      name: basename(path),
      exists: false,
      kind: 'file',
      size: null,
      modifiedAt: null,
      binary: false,
      tooLarge: false,
      truncated: false,
      content: null,
      gitStatus: statusForPath(snapshot, path),
    };
  }

  const stats = statSync(absolutePath);
  const kind = statKind(stats);
  const size = stats.isFile() ? stats.size : null;
  const sample = stats.isFile() ? readFileSample(absolutePath, stats.size) : Buffer.alloc(0);
  const binary = stats.isFile() ? looksBinary(sample) : false;
  const tooLarge = stats.isFile() && stats.size > MAX_FILE_BYTES;
  let content: string | null = null;
  let truncated = false;

  if (stats.isFile() && !binary && (!tooLarge || force)) {
    const buffer = readFileSync(absolutePath);
    truncated = !force && buffer.length > MAX_FILE_BYTES;
    content = buffer
      .subarray(0, force ? buffer.length : MAX_FILE_BYTES)
      .toString('utf-8')
      .replace(/\r\n?/g, '\n');
  }

  return {
    ...snapshot,
    path,
    name: basename(path),
    exists: true,
    kind,
    size,
    modifiedAt: stats.mtime.toISOString(),
    binary,
    tooLarge,
    truncated,
    content,
    gitStatus: statusForPath(snapshot, path),
  };
}

export function writeWorkspaceFile(cwd: string, relativePath: string, content: string): WorkspaceFileContent {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  if (!path) {
    throw new Error('path required');
  }
  const absolutePath = assertSafeWorkspacePath(snapshot.root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content.replace(/\r\n?/g, '\n'), 'utf-8');
  return readWorkspaceFile(cwd, path, true);
}

export function createWorkspaceFolder(cwd: string, relativePath: string): WorkspaceEntry {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  if (!path) {
    throw new Error('path required');
  }
  const absolutePath = assertSafeWorkspacePath(snapshot.root, path);
  mkdirSync(absolutePath, { recursive: true });
  return workspaceEntryForPath(snapshot, path);
}

export function deleteWorkspacePath(cwd: string, relativePath: string): { ok: true } {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  if (!path) {
    throw new Error('Refusing to delete workspace root');
  }
  rmSync(assertSafeWorkspacePath(snapshot.root, path), { recursive: true, force: true });
  return { ok: true };
}

export function renameWorkspacePath(cwd: string, relativePath: string, newName: string): WorkspaceEntry {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  const normalizedName = normalizeRelativePath(newName);
  if (!path || !normalizedName || normalizedName.includes('/')) {
    throw new Error('Invalid rename target');
  }
  const source = assertSafeWorkspacePath(snapshot.root, path);
  const targetPath = normalizeRelativePath(join(dirname(path), normalizedName));
  const target = assertSafeWorkspacePath(snapshot.root, targetPath);
  renameSync(source, target);
  return workspaceEntryForPath(snapshot, targetPath);
}

export function moveWorkspacePath(cwd: string, relativePath: string, targetDir: string): WorkspaceEntry {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  const destinationDir = normalizeRelativePath(targetDir);
  if (!path) {
    throw new Error('Refusing to move workspace root');
  }
  const source = assertSafeWorkspacePath(snapshot.root, path);
  const targetPath = normalizeRelativePath(join(destinationDir, basename(path)));
  if (path === targetPath) {
    return workspaceEntryForPath(snapshot, path);
  }
  if (targetPath.startsWith(`${path}/`)) {
    throw new Error('Cannot move a folder into itself');
  }
  const target = assertSafeWorkspacePath(snapshot.root, targetPath);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(source, target);
  return workspaceEntryForPath(snapshot, targetPath);
}

function workspaceEntryForPath(snapshot: WorkspaceRootSnapshot, relativePath: string): WorkspaceEntry {
  const path = normalizeRelativePath(relativePath);
  const absolutePath = assertSafeWorkspacePath(snapshot.root, path);
  const stats = statSync(absolutePath);
  const kind = statKind(stats);
  return {
    name: basename(path),
    path,
    kind,
    size: stats.isFile() ? stats.size : null,
    modifiedAt: stats.mtime.toISOString(),
    gitStatus: statusForPath(snapshot, path),
    descendantGitStatusCount: kind === 'directory' ? descendantStatusCount(snapshot, path) : 0,
  };
}

function parseDiffOverlay(diff: string): { addedLines: number[]; deletedBlocks: Array<{ afterLine: number; lines: string[] }> } {
  const addedLines: number[] = [];
  const deletedBlocks: Array<{ afterLine: number; lines: string[] }> = [];
  let newLine: number | null = 0;
  let currentDeleted: { afterLine: number; lines: string[] } | null = null;

  const flushDeleted = () => {
    if (currentDeleted && currentDeleted.lines.length > 0) {
      deletedBlocks.push(currentDeleted);
    }
    currentDeleted = null;
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('@@ ')) {
      flushDeleted();
      const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!hunk) {
        newLine = null;
        continue;
      }

      const parsedNewLine = Number.parseInt(hunk[3] ?? '', 10);
      newLine = Number.isSafeInteger(parsedNewLine) && parsedNewLine > 0 ? parsedNewLine : null;
      continue;
    }

    if (!line || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }
    if (line.startsWith('\\')) {
      continue;
    }
    if (line.startsWith('+')) {
      flushDeleted();
      if (newLine !== null) {
        addedLines.push(newLine);
        newLine += 1;
      }
      continue;
    }
    if (line.startsWith('-')) {
      if (newLine === null) {
        continue;
      }
      const afterLine = Math.max(0, newLine - 1);
      if (!currentDeleted || currentDeleted.afterLine !== afterLine) {
        flushDeleted();
        currentDeleted = { afterLine, lines: [] };
      }
      currentDeleted.lines.push(line.slice(1));
      continue;
    }
    flushDeleted();
    if (line.startsWith(' ') && newLine !== null) {
      newLine += 1;
    }
  }
  flushDeleted();

  return { addedLines, deletedBlocks };
}

export function readWorkspaceDiffOverlay(cwd: string, relativePath: string): WorkspaceDiffOverlay {
  const file = readWorkspaceFile(cwd, relativePath, false);
  const path = file.path;
  const status = file.gitStatus;
  if (!status || file.binary || (file.size !== null && file.size > MAX_DIFF_FILE_BYTES)) {
    return {
      ...file,
      gitStatus: status,
      binary: file.binary,
      tooLarge: file.size !== null && file.size > MAX_DIFF_FILE_BYTES,
      addedLines: [],
      deletedBlocks: [],
    };
  }

  if (status === 'untracked') {
    const lineCount = file.content ? file.content.split('\n').length : 0;
    return {
      ...file,
      gitStatus: status,
      binary: file.binary,
      tooLarge: file.tooLarge,
      addedLines: Array.from({ length: lineCount }, (_, index) => index + 1),
      deletedBlocks: [],
    };
  }

  let diff = '';
  try {
    diff = runGit(['diff', '--find-renames', '--unified=0', 'HEAD', '--', path], file.root);
  } catch {
    diff = '';
  }
  const overlay = parseDiffOverlay(diff);
  return { ...file, gitStatus: status, binary: file.binary, tooLarge: file.tooLarge, ...overlay };
}

// ── Uncommitted (working tree) diff ──────────────────────────────────────────

export interface UncommittedDiffResult {
  branch: string | null;
  changeCount: number;
  linesAdded: number;
  linesDeleted: number;
  files: LocalCheckpointCommitFile[];
}

function runGitAllowFailure(args: string[], cwd: string): { stdout: string; exitCode: number } {
  try {
    return {
      stdout: execFileSync('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf-8',
        timeout: UNCOMMITTED_DIFF_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      }),
      exitCode: 0,
    };
  } catch (error: unknown) {
    const childError = error as { stdout?: string | Buffer; status?: number | null; code?: string };
    const stdout =
      typeof childError.stdout === 'string'
        ? childError.stdout
        : Buffer.isBuffer(childError.stdout)
          ? childError.stdout.toString('utf-8')
          : '';
    return {
      stdout,
      exitCode: typeof childError.status === 'number' ? childError.status : 1,
    };
  }
}

function buildUntrackedPatch(root: string, relativePath: string): string {
  const absolutePath = resolve(root, relativePath);
  let content: string;
  try {
    content = readFileSync(absolutePath, 'utf-8');
  } catch {
    content = '';
  }
  const lines = content.split('\n');
  const actualLines = lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  const lineCount = actualLines.length;
  if (lineCount === 0) {
    return `diff --git a/dev/null b/${relativePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relativePath}\n@@ -0,0 +0,0 @@\n`;
  }
  return [
    `diff --git a/dev/null b/${relativePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${lineCount} @@`,
    ...actualLines.map((line) => `+${line}`),
  ].join('\n');
}

export function readUncommittedDiff(cwd: string): UncommittedDiffResult | null {
  const repo = readGitRepoInfo(cwd);
  if (!repo) {
    return null;
  }

  const status = readGitStatusSummary(repo.root);
  if (!status) {
    return null;
  }

  if (status.changes.length === 0) {
    return {
      branch: status.branch,
      changeCount: 0,
      linesAdded: 0,
      linesDeleted: 0,
      files: [],
    };
  }

  const files: LocalCheckpointCommitFile[] = [];
  const trackedChanges = status.changes.filter((c) => c.change !== 'untracked');
  const untrackedChanges = status.changes.filter((c) => c.change === 'untracked');

  // Get tracked diffs in one shot so rename detection works
  if (trackedChanges.length > 0) {
    const fileArgs = trackedChanges.flatMap((c) => ['--', c.relativePath]);
    const result = runGitAllowFailure(['diff', 'HEAD', '--unified=3', '--find-renames', ...fileArgs], repo.root);
    if (result.exitCode === 0 || result.exitCode === 1) {
      try {
        const parsed = parseCheckpointDiffSections(result.stdout);
        files.push(...parsed);
      } catch {
        // Fall back to per-file diffing
        for (const change of trackedChanges) {
          const fileResult = runGitAllowFailure(['diff', 'HEAD', '--unified=3', '--', change.relativePath], repo.root);
          if (fileResult.exitCode === 0 || fileResult.exitCode === 1) {
            try {
              const fileParsed = parseCheckpointDiffSections(fileResult.stdout);
              if (fileParsed.length > 0) {
                files.push(fileParsed[0]!);
              }
            } catch {
              // skip
            }
          }
        }
      }
    }
  }

  // Untracked files — construct patches manually
  if (untrackedChanges.length > 0 && files.length < UNCOMMITTED_DIFF_MAX_FILES) {
    for (const change of untrackedChanges) {
      if (files.length >= UNCOMMITTED_DIFF_MAX_FILES) {
        break;
      }
      const patch = buildUntrackedPatch(repo.root, change.relativePath);
      try {
        const parsed = parseCheckpointDiffSections(patch);
        if (parsed.length > 0) {
          files.push(parsed[0]!);
        } else {
          files.push({
            path: change.relativePath,
            status: 'added',
            additions: 0,
            deletions: 0,
            patch: '',
          });
        }
      } catch {
        files.push({
          path: change.relativePath,
          status: 'added',
          additions: 0,
          deletions: 0,
          patch: '',
        });
      }
    }
  }

  return {
    branch: status.branch,
    changeCount: files.length,
    linesAdded: files.reduce((sum, f) => sum + f.additions, 0),
    linesDeleted: files.reduce((sum, f) => sum + f.deletions, 0),
    files,
  };
}

export const __workspaceExplorerInternals = { parseDiffOverlay, normalizeRelativePath };
