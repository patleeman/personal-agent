import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { readGitRepoInfo, readGitStatusSummary, type GitStatusChangeKind } from './gitStatus.js';

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

  return trimmed.split('/').filter((part) => part && part !== '.').join('/');
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

function statKind(stats: ReturnType<typeof statSync>): WorkspaceEntryKind {
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
    return { ...snapshot, path, name: basename(path), exists: false, kind: 'file', size: null, modifiedAt: null, binary: false, tooLarge: false, truncated: false, content: null, gitStatus: statusForPath(snapshot, path) };
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
    content = buffer.subarray(0, force ? buffer.length : MAX_FILE_BYTES).toString('utf-8').replace(/\r\n?/g, '\n');
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

function parseDiffOverlay(diff: string): { addedLines: number[]; deletedBlocks: Array<{ afterLine: number; lines: string[] }> } {
  const addedLines: number[] = [];
  const deletedBlocks: Array<{ afterLine: number; lines: string[] }> = [];
  let newLine = 0;
  let currentDeleted: { afterLine: number; lines: string[] } | null = null;

  const flushDeleted = () => {
    if (currentDeleted && currentDeleted.lines.length > 0) {
      deletedBlocks.push(currentDeleted);
    }
    currentDeleted = null;
  };

  for (const line of diff.split('\n')) {
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      flushDeleted();
      newLine = Number.parseInt(hunk[3] ?? '1', 10);
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
      addedLines.push(newLine);
      newLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      const afterLine = Math.max(0, newLine - 1);
      if (!currentDeleted || currentDeleted.afterLine !== afterLine) {
        flushDeleted();
        currentDeleted = { afterLine, lines: [] };
      }
      currentDeleted.lines.push(line.slice(1));
      continue;
    }
    flushDeleted();
    if (line.startsWith(' ')) {
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
    return { ...file, gitStatus: status, binary: file.binary, tooLarge: file.size !== null && file.size > MAX_DIFF_FILE_BYTES, addedLines: [], deletedBlocks: [] };
  }

  if (status === 'untracked') {
    const lineCount = file.content ? file.content.split('\n').length : 0;
    return { ...file, gitStatus: status, binary: file.binary, tooLarge: file.tooLarge, addedLines: Array.from({ length: lineCount }, (_, index) => index + 1), deletedBlocks: [] };
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

export const __workspaceExplorerInternals = { parseDiffOverlay, normalizeRelativePath };
