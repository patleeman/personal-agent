import { execFileSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { type LocalCheckpointCommitFile, parseCheckpointDiffSections } from '../conversations/conversationCheckpointCommit.js';
import { createCoreWorkspaceRoot } from '../filesystem/filesystemAuthority.js';
import { execFileProcess } from '../shared/processLauncher.js';
import {
  type GitRepoInfo,
  type GitStatusChangeKind,
  type GitStatusSummary,
  parseGitNumstat,
  parseGitStatusBranch,
  parseGitStatusChanges,
  readGitRepoInfo,
  readGitStatusSummary,
} from './gitStatus.js';

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
const UNCOMMITTED_DIFF_MAX_RENDERED_FILES = 25;
const UNCOMMITTED_DIFF_MAX_UNTRACKED_FILE_BYTES = 256 * 1024;
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
  const absoluteCwd = execFileSync('pwd', ['-P'], { cwd: resolve(cwd), encoding: 'utf-8' }).trim();
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

function statusForPath(snapshot: WorkspaceRootSnapshot, relativePath: string): GitStatusChangeKind | null {
  return snapshot.changes.find((change) => change.relativePath === relativePath)?.change ?? null;
}

function descendantStatusCount(snapshot: WorkspaceRootSnapshot, relativePath: string): number {
  if (!relativePath) return snapshot.changes.length;
  const prefix = `${relativePath}/`;
  return snapshot.changes.filter((change) => change.relativePath.startsWith(prefix)).length;
}

export async function listWorkspaceDirectory(cwd: string, relativePath?: string | null): Promise<WorkspaceDirectoryListing> {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  const workspaceRoot = await createCoreWorkspaceRoot(snapshot.root, 'list workspace directory', ['list', 'metadata']);
  const stats = await workspaceRoot.stat(path);
  if (stats.type !== 'directory') throw new Error('Path is not a directory');
  const entries = (await workspaceRoot.list(path, { depth: 0 }))
    .map(
      (entry): WorkspaceEntry => ({
        name: entry.name,
        path: entry.path,
        kind: entry.type === 'directory' || entry.type === 'file' || entry.type === 'symlink' ? entry.type : 'other',
        size: entry.size ?? null,
        modifiedAt: entry.modifiedAt ?? null,
        gitStatus: statusForPath(snapshot, entry.path),
        descendantGitStatusCount: entry.type === 'directory' ? descendantStatusCount(snapshot, entry.path) : 0,
      }),
    )
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

export async function readWorkspaceFile(cwd: string, relativePath: string, force = false): Promise<WorkspaceFileContent> {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  const workspaceRoot = await createCoreWorkspaceRoot(snapshot.root, 'read workspace file', ['read', 'metadata']);
  const exists = await workspaceRoot.exists(path);
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
  const stats = await workspaceRoot.stat(path);
  const kind = stats.type === 'directory' || stats.type === 'file' || stats.type === 'symlink' ? stats.type : 'other';
  const size = stats.type === 'file' ? stats.size : null;
  const sample =
    stats.type === 'file' && size !== null
      ? Buffer.from(await workspaceRoot.readBytes(path, { maxBytes: Math.min(size, 8192) }).catch(async () => Buffer.alloc(0)))
      : Buffer.alloc(0);
  const binary = stats.type === 'file' ? looksBinary(sample) : false;
  const tooLarge = stats.type === 'file' && size !== null && size > MAX_FILE_BYTES;
  let content: string | null = null;
  let truncated = false;
  if (stats.type === 'file' && !binary && (!tooLarge || force)) {
    const buffer = Buffer.from(await workspaceRoot.readBytes(path));
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
    modifiedAt: stats.modifiedAt,
    binary,
    tooLarge,
    truncated,
    content,
    gitStatus: statusForPath(snapshot, path),
  };
}

export async function writeWorkspaceFile(cwd: string, relativePath: string, content: string): Promise<WorkspaceFileContent> {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  if (!path) throw new Error('path required');
  const workspaceRoot = await createCoreWorkspaceRoot(snapshot.root, 'write workspace file', ['read', 'write', 'metadata']);
  await workspaceRoot.writeText(path, content.replace(/\r\n?/g, '\n'));
  return readWorkspaceFile(cwd, path, true);
}

export async function createWorkspaceFolder(cwd: string, relativePath: string): Promise<WorkspaceEntry> {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  if (!path) throw new Error('path required');
  const workspaceRoot = await createCoreWorkspaceRoot(snapshot.root, 'create workspace folder', ['write', 'metadata']);
  await workspaceRoot.createDirectory(path);
  return workspaceEntryForPath(snapshot, path);
}

export async function deleteWorkspacePath(cwd: string, relativePath: string): Promise<{ ok: true }> {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  if (!path) throw new Error('Refusing to delete workspace root');
  const workspaceRoot = await createCoreWorkspaceRoot(snapshot.root, 'delete workspace path', ['delete']);
  await workspaceRoot.remove(path, { recursive: true, force: true });
  return { ok: true };
}

export async function renameWorkspacePath(cwd: string, relativePath: string, newName: string): Promise<WorkspaceEntry> {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  const normalizedName = normalizeRelativePath(newName);
  if (!path || !normalizedName || normalizedName.includes('/')) throw new Error('Invalid rename target');
  const workspaceRoot = await createCoreWorkspaceRoot(snapshot.root, 'rename workspace path', ['move', 'metadata']);
  const targetPath = normalizeRelativePath(join(dirname(path), normalizedName));
  await workspaceRoot.move(path, targetPath);
  return workspaceEntryForPath(snapshot, targetPath);
}

export async function moveWorkspacePath(cwd: string, relativePath: string, targetDir: string): Promise<WorkspaceEntry> {
  const snapshot = readWorkspaceRootSnapshot(cwd);
  const path = normalizeRelativePath(relativePath);
  const destinationDir = normalizeRelativePath(targetDir);
  if (!path) throw new Error('Refusing to move workspace root');
  const targetPath = normalizeRelativePath(join(destinationDir, basename(path)));
  if (path === targetPath) return workspaceEntryForPath(snapshot, path);
  if (targetPath.startsWith(`${path}/`)) throw new Error('Cannot move a folder into itself');
  const workspaceRoot = await createCoreWorkspaceRoot(snapshot.root, 'move workspace path', ['move', 'metadata']);
  await workspaceRoot.move(path, targetPath);
  return workspaceEntryForPath(snapshot, targetPath);
}

async function workspaceEntryForPath(snapshot: WorkspaceRootSnapshot, relativePath: string): Promise<WorkspaceEntry> {
  const path = normalizeRelativePath(relativePath);
  const workspaceRoot = await createCoreWorkspaceRoot(snapshot.root, 'workspace entry metadata', ['metadata']);
  const stats = await workspaceRoot.stat(path);
  const kind = stats.type === 'directory' || stats.type === 'file' || stats.type === 'symlink' ? stats.type : 'other';
  return {
    name: basename(path),
    path,
    kind,
    size: stats.type === 'file' ? stats.size : null,
    modifiedAt: stats.modifiedAt,
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

export async function readWorkspaceDiffOverlay(cwd: string, relativePath: string): Promise<WorkspaceDiffOverlay> {
  const file = await readWorkspaceFile(cwd, relativePath, false);
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

  // Cap diff overlay to prevent renderer crashes from oversized responses.
  const MAX_ADDED_LINES = 10_000;
  const MAX_DELETED_BLOCKS = 1_000;
  const totalDeletedLines = overlay.deletedBlocks.reduce((sum, block) => sum + block.lines.length, 0);

  if (overlay.addedLines.length > MAX_ADDED_LINES) {
    overlay.addedLines = overlay.addedLines.slice(0, MAX_ADDED_LINES);
  }

  if (overlay.deletedBlocks.length > MAX_DELETED_BLOCKS) {
    // Keep earliest blocks so the diff context at the top of the file survives.
    overlay.deletedBlocks = overlay.deletedBlocks.slice(0, MAX_DELETED_BLOCKS);
  } else if (totalDeletedLines > MAX_ADDED_LINES * 2) {
    // If individual blocks contain many lines each, truncate each block.
    overlay.deletedBlocks = overlay.deletedBlocks.map((block) => ({
      afterLine: block.afterLine,
      lines: block.lines.slice(0, 500),
    }));
  }

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

function readChildProcessStdout(error: unknown): string {
  const childError = error as { stdout?: string | Buffer };
  if (typeof childError.stdout === 'string') {
    return childError.stdout;
  }
  if (Buffer.isBuffer(childError.stdout)) {
    return childError.stdout.toString('utf-8');
  }
  return '';
}

function readChildProcessExitCode(error: unknown): number {
  const childError = error as { status?: number | null; code?: string };
  return typeof childError.status === 'number' ? childError.status : 1;
}

async function runGitAllowFailureAsync(args: string[], cwd: string): Promise<{ stdout: string; exitCode: number }> {
  try {
    const result = await execFileProcess({
      command: 'git',
      args,
      cwd,
      timeoutMs: UNCOMMITTED_DIFF_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: result.stdout, exitCode: 0 };
  } catch (error: unknown) {
    return {
      stdout: readChildProcessStdout(error),
      exitCode: readChildProcessExitCode(error),
    };
  }
}

function buildEmptyUntrackedPatch(relativePath: string): string {
  return `diff --git a/dev/null b/${relativePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relativePath}\n@@ -0,0 +0,0 @@\n`;
}

function buildUntrackedPatchFromContent(relativePath: string, content: string): string {
  const lines = content.split('\n');
  const actualLines = lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  const lineCount = actualLines.length;
  if (lineCount === 0) {
    return buildEmptyUntrackedPatch(relativePath);
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

async function buildUntrackedPatchAsync(root: string, relativePath: string): Promise<string> {
  try {
    const workspaceRoot = await createCoreWorkspaceRoot(root, 'read untracked workspace diff', ['read', 'metadata']);
    const stats = await workspaceRoot.stat(relativePath);
    if (stats.type !== 'file' || (stats.size ?? 0) > UNCOMMITTED_DIFF_MAX_UNTRACKED_FILE_BYTES) {
      return buildEmptyUntrackedPatch(relativePath);
    }
    return buildUntrackedPatchFromContent(
      relativePath,
      await workspaceRoot.readText(relativePath, { maxBytes: UNCOMMITTED_DIFF_MAX_UNTRACKED_FILE_BYTES }),
    );
  } catch {
    return buildEmptyUntrackedPatch(relativePath);
  }
}

function emptyUncommittedFile(change: { relativePath: string }): LocalCheckpointCommitFile {
  return {
    path: change.relativePath,
    status: 'added',
    additions: 0,
    deletions: 0,
    patch: '',
  };
}

function pushParsedPatch(files: LocalCheckpointCommitFile[], patch: string, change: { relativePath: string }) {
  try {
    const parsed = parseCheckpointDiffSections(patch);
    if (parsed.length > 0) {
      files.push(parsed[0]!);
      return;
    }
  } catch {
    // Fall through to an empty placeholder row.
  }
  files.push(emptyUncommittedFile(change));
}

async function readGitRepoInfoAsync(cwd: string): Promise<GitRepoInfo | null> {
  const isWorkTree = await runGitAllowFailureAsync(['rev-parse', '--is-inside-work-tree'], cwd);
  if (isWorkTree.exitCode !== 0 || isWorkTree.stdout.trim() !== 'true') {
    return null;
  }
  const rootResult = await runGitAllowFailureAsync(['rev-parse', '--show-toplevel'], cwd);
  if (rootResult.exitCode !== 0) {
    return null;
  }
  const root = resolve(rootResult.stdout.trim());
  const name = basename(root).trim();
  return name ? { root, name } : null;
}

async function readUncommittedStatusAsync(repoRoot: string): Promise<GitStatusSummary | null> {
  const statusResult = await runGitAllowFailureAsync(['status', '--porcelain=v1', '--branch', '--untracked-files=all'], repoRoot);
  if (statusResult.exitCode !== 0) {
    return null;
  }

  const changes = parseGitStatusChanges(statusResult.stdout);
  const branch = parseGitStatusBranch(statusResult.stdout);
  const trackedSummary = changes.some((change) => change.change !== 'untracked')
    ? parseGitNumstat((await runGitAllowFailureAsync(['diff', '--numstat', 'HEAD'], repoRoot)).stdout)
    : { linesAdded: 0, linesDeleted: 0 };

  return {
    branch,
    changeCount: changes.length,
    linesAdded: trackedSummary.linesAdded,
    linesDeleted: trackedSummary.linesDeleted,
    changes,
  };
}

async function readUncommittedDiffForRepo(
  repo: GitRepoInfo,
  status: GitStatusSummary,
  options: {
    buildUntrackedPatch: (root: string, relativePath: string) => Promise<string>;
    runGit: (args: string[], cwd: string) => Promise<{ stdout: string; exitCode: number }>;
  },
): Promise<UncommittedDiffResult> {
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
  const trackedChanges = status.changes.filter((c) => c.change !== 'untracked').slice(0, UNCOMMITTED_DIFF_MAX_RENDERED_FILES);
  const untrackedChanges = status.changes.filter((c) => c.change === 'untracked').slice(0, UNCOMMITTED_DIFF_MAX_RENDERED_FILES);

  // Get tracked diffs in one shot so rename detection works. Keep the response bounded; the full repository
  // status count still comes from git status, but the renderer only receives a manageable patch set.
  if (trackedChanges.length > 0 && files.length < UNCOMMITTED_DIFF_MAX_RENDERED_FILES) {
    const fileArgs = trackedChanges.map((c) => c.relativePath);
    const result = await options.runGit(['diff', 'HEAD', '--unified=3', '--find-renames', '--', ...fileArgs], repo.root);
    if (result.exitCode === 0 || result.exitCode === 1) {
      try {
        const parsed = parseCheckpointDiffSections(result.stdout);
        files.push(...parsed.slice(0, UNCOMMITTED_DIFF_MAX_RENDERED_FILES - files.length));
      } catch {
        // Fall back to per-file diffing
        for (const change of trackedChanges) {
          if (files.length >= UNCOMMITTED_DIFF_MAX_RENDERED_FILES) {
            break;
          }
          const fileResult = await options.runGit(['diff', 'HEAD', '--unified=3', '--', change.relativePath], repo.root);
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

  // Untracked files — construct patches manually, capped by file count and file size.
  if (untrackedChanges.length > 0 && files.length < UNCOMMITTED_DIFF_MAX_RENDERED_FILES) {
    for (const change of untrackedChanges) {
      if (files.length >= UNCOMMITTED_DIFF_MAX_RENDERED_FILES) {
        break;
      }
      const patch = await options.buildUntrackedPatch(repo.root, change.relativePath);
      pushParsedPatch(files, patch, change);
    }
  }

  return {
    branch: status.branch,
    changeCount: status.changeCount,
    linesAdded: status.linesAdded,
    linesDeleted: status.linesDeleted,
    files,
  };
}

export async function readUncommittedDiffAsync(cwd: string): Promise<UncommittedDiffResult | null> {
  const repo = await readGitRepoInfoAsync(cwd);
  if (!repo) {
    return null;
  }

  const status = await readUncommittedStatusAsync(repo.root);
  if (!status) {
    return null;
  }

  return readUncommittedDiffForRepo(repo, status, { buildUntrackedPatch: buildUntrackedPatchAsync, runGit: runGitAllowFailureAsync });
}

export const __workspaceExplorerInternals = { parseDiffOverlay, normalizeRelativePath };
