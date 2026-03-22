import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { readGitRepoInfo, readGitStatusSummary } from './gitStatus.js';

export type WorkspaceChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted';

export interface WorkspaceTreeNode {
  name: string;
  path: string;
  relativePath: string;
  kind: 'directory' | 'file';
  exists: boolean;
  change: WorkspaceChangeKind | null;
  children?: WorkspaceTreeNode[];
}

export interface WorkspaceChangeEntry {
  path: string;
  relativePath: string;
  exists: boolean;
  change: WorkspaceChangeKind;
}

export interface WorkspaceSnapshot {
  cwd: string;
  root: string;
  repoRoot: string | null;
  branch: string | null;
  focusPath: string | null;
  fileCount: number;
  changedCount: number;
  truncated: boolean;
  tree: WorkspaceTreeNode[];
  changes: WorkspaceChangeEntry[];
}

export interface WorkspaceFileDetail {
  cwd: string;
  root: string;
  repoRoot: string | null;
  path: string;
  relativePath: string;
  exists: boolean;
  sizeBytes: number;
  binary: boolean;
  tooLarge: boolean;
  content: string | null;
  originalContent: string | null;
  change: WorkspaceChangeKind | null;
  diff: string | null;
}

const MAX_TEXT_FILE_BYTES = 512 * 1024;
const MAX_FALLBACK_FILE_COUNT = 3_000;
const SKIPPED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-server',
  'coverage',
  '.next',
]);

interface WorkspaceRootResolution {
  cwd: string;
  root: string;
  repoRoot: string | null;
  branch: string | null;
  focusPath: string | null;
}

interface MutableWorkspaceTreeNode {
  name: string;
  path: string;
  relativePath: string;
  kind: 'directory' | 'file';
  exists: boolean;
  change: WorkspaceChangeKind | null;
  children?: Map<string, MutableWorkspaceTreeNode>;
}

function runGitCommand(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  });
}

function runGitCommandAllowFailure(args: string[], cwd: string): { stdout: string; exitCode: number } {
  try {
    return {
      stdout: runGitCommand(args, cwd),
      exitCode: 0,
    };
  } catch (error) {
    const childError = error as { stdout?: string | Buffer; status?: number };
    const stdout = typeof childError.stdout === 'string'
      ? childError.stdout
      : Buffer.isBuffer(childError.stdout)
        ? childError.stdout.toString('utf-8')
        : '';

    return {
      stdout,
      exitCode: childError.status ?? 1,
    };
  }
}

function hasHeadCommit(cwd: string): boolean {
  return runGitCommandAllowFailure(['rev-parse', '--verify', 'HEAD'], cwd).exitCode === 0;
}

function isInsideRoot(root: string, targetPath: string): boolean {
  const rel = relative(root, targetPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveWorkspaceRoot(cwd: string): WorkspaceRootResolution {
  const resolvedCwd = resolve(cwd);
  if (!existsSync(resolvedCwd)) {
    throw new Error(`Directory does not exist: ${resolvedCwd}`);
  }

  if (!statSync(resolvedCwd).isDirectory()) {
    throw new Error(`Not a directory: ${resolvedCwd}`);
  }

  const normalizedCwd = realpathSync(resolvedCwd);
  const repo = readGitRepoInfo(normalizedCwd);
  const root = repo?.root ? realpathSync(repo.root) : normalizedCwd;
  const repoRoot = repo?.root ? realpathSync(repo.root) : null;
  const branch = repoRoot ? (readGitStatusSummary(repoRoot)?.branch ?? null) : null;
  const focusPath = relative(root, normalizedCwd) || null;

  return {
    cwd: normalizedCwd,
    root,
    repoRoot,
    branch,
    focusPath,
  };
}

function normalizeWorkspaceChange(code: string): WorkspaceChangeKind | null {
  if (code === '??') {
    return 'untracked';
  }

  if (code.includes('U')) {
    return 'conflicted';
  }

  if (code.includes('R')) {
    return 'renamed';
  }

  if (code.includes('C')) {
    return 'copied';
  }

  if (code.includes('D')) {
    return 'deleted';
  }

  if (code.includes('A')) {
    return 'added';
  }

  if (code.includes('T')) {
    return 'typechange';
  }

  if (code.includes('M')) {
    return 'modified';
  }

  return null;
}

function normalizeWorkspaceStatusPath(statusLine: string, change: WorkspaceChangeKind | null): string {
  const rawPath = statusLine.slice(3).trim();
  if ((change === 'renamed' || change === 'copied') && rawPath.includes(' -> ')) {
    return rawPath.split(' -> ').at(-1)?.trim() ?? rawPath;
  }

  return rawPath;
}

function readGitChangeMap(repoRoot: string): Map<string, WorkspaceChangeKind> {
  const output = runGitCommandAllowFailure(['status', '--porcelain=v1', '--untracked-files=all'], repoRoot).stdout;
  const result = new Map<string, WorkspaceChangeKind>();

  for (const line of output.split('\n')) {
    if (line.length < 4) {
      continue;
    }

    const change = normalizeWorkspaceChange(line.slice(0, 2));
    if (!change) {
      continue;
    }

    const normalizedPath = normalizeWorkspaceStatusPath(line, change);
    if (!normalizedPath) {
      continue;
    }

    result.set(normalizedPath, change);
  }

  return result;
}

function readGitWorkspaceFiles(repoRoot: string): string[] {
  return runGitCommand(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], repoRoot)
    .split('\0')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function createMutableDirectoryNode(input: {
  name: string;
  path: string;
  relativePath: string;
}): MutableWorkspaceTreeNode {
  return {
    name: input.name,
    path: input.path,
    relativePath: input.relativePath,
    kind: 'directory',
    exists: true,
    change: null,
    children: new Map(),
  };
}

function buildTreeFromRelativePaths(root: string, relativePaths: string[], changeMap: Map<string, WorkspaceChangeKind>): WorkspaceTreeNode[] {
  const topLevel = new Map<string, MutableWorkspaceTreeNode>();

  for (const relativePath of relativePaths) {
    const normalizedRelativePath = relativePath.trim();
    if (!normalizedRelativePath) {
      continue;
    }

    const segments = normalizedRelativePath.split('/').filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    let currentChildren = topLevel;
    let currentRelativePath = '';

    for (const [index, segment] of segments.entries()) {
      currentRelativePath = currentRelativePath ? `${currentRelativePath}/${segment}` : segment;
      const absolutePath = resolve(root, currentRelativePath);
      const isLeaf = index === segments.length - 1;
      const existing = currentChildren.get(segment);

      if (isLeaf) {
        currentChildren.set(segment, {
          name: segment,
          path: absolutePath,
          relativePath: currentRelativePath,
          kind: 'file',
          exists: existsSync(absolutePath),
          change: changeMap.get(currentRelativePath) ?? null,
        });
        continue;
      }

      if (existing && existing.kind === 'directory') {
        currentChildren = existing.children ?? new Map();
        existing.children = currentChildren;
        continue;
      }

      const next = createMutableDirectoryNode({
        name: segment,
        path: absolutePath,
        relativePath: currentRelativePath,
      });
      currentChildren.set(segment, next);
      currentChildren = next.children ?? new Map();
      next.children = currentChildren;
    }
  }

  return sortWorkspaceTreeNodes(topLevel);
}

function sortWorkspaceTreeNodes(nodes: Map<string, MutableWorkspaceTreeNode>): WorkspaceTreeNode[] {
  return [...nodes.values()]
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    })
    .map((node) => ({
      name: node.name,
      path: node.path,
      relativePath: node.relativePath,
      kind: node.kind,
      exists: node.exists,
      change: node.change,
      ...(node.kind === 'directory'
        ? { children: sortWorkspaceTreeNodes(node.children ?? new Map()) }
        : {}),
    }));
}

function walkFilesystemTree(root: string): { tree: WorkspaceTreeNode[]; fileCount: number; truncated: boolean } {
  let fileCount = 0;
  let truncated = false;

  function walkDirectory(current: string): WorkspaceTreeNode[] {
    if (truncated) {
      return [];
    }

    const entries = readdirSync(current, { withFileTypes: true })
      .filter((entry) => !entry.isSymbolicLink())
      .filter((entry) => !SKIPPED_DIRECTORY_NAMES.has(entry.name))
      .sort((left, right) => {
        const leftIsDir = left.isDirectory() ? 0 : 1;
        const rightIsDir = right.isDirectory() ? 0 : 1;
        if (leftIsDir !== rightIsDir) {
          return leftIsDir - rightIsDir;
        }
        return left.name.localeCompare(right.name);
      });

    const result: WorkspaceTreeNode[] = [];
    for (const entry of entries) {
      if (truncated) {
        break;
      }

      const absolutePath = resolve(current, entry.name);
      const relativePath = relative(root, absolutePath);
      if (entry.isDirectory()) {
        const children = walkDirectory(absolutePath);
        result.push({
          name: entry.name,
          path: absolutePath,
          relativePath,
          kind: 'directory',
          exists: true,
          change: null,
          children,
        });
        continue;
      }

      fileCount += 1;
      if (fileCount > MAX_FALLBACK_FILE_COUNT) {
        truncated = true;
        break;
      }

      result.push({
        name: entry.name,
        path: absolutePath,
        relativePath,
        kind: 'file',
        exists: true,
        change: null,
      });
    }

    return result;
  }

  return { tree: walkDirectory(root), fileCount, truncated };
}

function readWorkspaceTextFile(filePath: string): {
  content: string | null;
  sizeBytes: number;
  binary: boolean;
  tooLarge: boolean;
} {
  const sizeBytes = existsSync(filePath) ? statSync(filePath).size : 0;
  if (!existsSync(filePath)) {
    return {
      content: null,
      sizeBytes: 0,
      binary: false,
      tooLarge: false,
    };
  }

  if (sizeBytes > MAX_TEXT_FILE_BYTES) {
    return {
      content: null,
      sizeBytes,
      binary: false,
      tooLarge: true,
    };
  }

  const buffer = readFileSync(filePath);
  if (buffer.includes(0)) {
    return {
      content: null,
      sizeBytes,
      binary: true,
      tooLarge: false,
    };
  }

  return {
    content: buffer.toString('utf-8'),
    sizeBytes,
    binary: false,
    tooLarge: false,
  };
}

function readWorkspaceOriginalContent(repoRoot: string | null, relativePath: string, change: WorkspaceChangeKind | null, exists: boolean): string | null {
  if (!repoRoot || !change) {
    return null;
  }

  if (change === 'added' || change === 'untracked') {
    return '';
  }

  if (!hasHeadCommit(repoRoot)) {
    return exists ? '' : null;
  }

  const result = runGitCommandAllowFailure(['show', `HEAD:${relativePath}`], repoRoot);
  if (result.exitCode !== 0) {
    return null;
  }

  if (result.stdout.length > MAX_TEXT_FILE_BYTES || result.stdout.includes('\u0000')) {
    return null;
  }

  return result.stdout;
}

function readWorkspaceDiff(repoRoot: string | null, relativePath: string, change: WorkspaceChangeKind | null, exists: boolean): string | null {
  if (!repoRoot || !change) {
    return null;
  }

  if (change === 'untracked' && exists) {
    const result = runGitCommandAllowFailure(['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', relativePath], repoRoot);
    return result.stdout.trim().length > 0 ? result.stdout : null;
  }

  if (hasHeadCommit(repoRoot)) {
    const result = runGitCommandAllowFailure(['diff', '--no-ext-diff', '--unified=3', 'HEAD', '--', relativePath], repoRoot);
    return result.stdout.trim().length > 0 ? result.stdout : null;
  }

  const staged = runGitCommandAllowFailure(['diff', '--no-ext-diff', '--cached', '--unified=3', '--', relativePath], repoRoot).stdout;
  const unstaged = runGitCommandAllowFailure(['diff', '--no-ext-diff', '--unified=3', '--', relativePath], repoRoot).stdout;
  const combined = [staged, unstaged]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join('\n\n');

  if (combined.length > 0) {
    return combined;
  }

  if ((change === 'added' || change === 'untracked') && exists) {
    const result = runGitCommandAllowFailure(['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', relativePath], repoRoot);
    return result.stdout.trim().length > 0 ? result.stdout : null;
  }

  return null;
}

function resolveWorkspaceFilePath(root: string, filePath: string): { absolutePath: string; relativePath: string } {
  const absolutePath = resolve(root, filePath);
  if (!isInsideRoot(root, absolutePath)) {
    throw new Error(`Path is outside the workspace root: ${filePath}`);
  }

  const relativePath = relative(root, absolutePath);
  if (!relativePath || relativePath.startsWith('..')) {
    throw new Error(`Path is outside the workspace root: ${filePath}`);
  }

  return { absolutePath, relativePath };
}

export function readWorkspaceSnapshot(cwd: string): WorkspaceSnapshot {
  const workspace = resolveWorkspaceRoot(cwd);
  const changeMap = workspace.repoRoot ? readGitChangeMap(workspace.repoRoot) : new Map<string, WorkspaceChangeKind>();

  if (workspace.repoRoot) {
    const relativePaths = readGitWorkspaceFiles(workspace.repoRoot);
    const changes = [...changeMap.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([relativePath, change]) => ({
        path: resolve(workspace.root, relativePath),
        relativePath,
        exists: existsSync(resolve(workspace.root, relativePath)),
        change,
      }));

    return {
      cwd: workspace.cwd,
      root: workspace.root,
      repoRoot: workspace.repoRoot,
      branch: workspace.branch,
      focusPath: workspace.focusPath,
      fileCount: relativePaths.length,
      changedCount: changes.length,
      truncated: false,
      tree: buildTreeFromRelativePaths(workspace.root, relativePaths, changeMap),
      changes,
    };
  }

  const fallback = walkFilesystemTree(workspace.root);
  return {
    cwd: workspace.cwd,
    root: workspace.root,
    repoRoot: null,
    branch: null,
    focusPath: workspace.focusPath,
    fileCount: fallback.fileCount,
    changedCount: 0,
    truncated: fallback.truncated,
    tree: fallback.tree,
    changes: [],
  };
}

export function readWorkspaceFile(input: { cwd: string; path: string }): WorkspaceFileDetail {
  const workspace = resolveWorkspaceRoot(input.cwd);
  const changeMap = workspace.repoRoot ? readGitChangeMap(workspace.repoRoot) : new Map<string, WorkspaceChangeKind>();
  const { absolutePath, relativePath } = resolveWorkspaceFilePath(workspace.root, input.path);
  const exists = existsSync(absolutePath);
  const fileData = readWorkspaceTextFile(absolutePath);
  const change = changeMap.get(relativePath) ?? null;
  const originalContent = readWorkspaceOriginalContent(workspace.repoRoot, relativePath, change, exists);

  return {
    cwd: workspace.cwd,
    root: workspace.root,
    repoRoot: workspace.repoRoot,
    path: absolutePath,
    relativePath,
    exists,
    sizeBytes: fileData.sizeBytes,
    binary: fileData.binary,
    tooLarge: fileData.tooLarge,
    content: fileData.content,
    originalContent,
    change,
    diff: readWorkspaceDiff(workspace.repoRoot, relativePath, change, exists),
  };
}

export function writeWorkspaceFile(input: { cwd: string; path: string; content: string }): WorkspaceFileDetail {
  const workspace = resolveWorkspaceRoot(input.cwd);
  const { absolutePath } = resolveWorkspaceFilePath(workspace.root, input.path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, input.content, 'utf-8');
  return readWorkspaceFile({ cwd: workspace.cwd, path: absolutePath });
}

export function workspaceRootLabel(snapshot: WorkspaceSnapshot): string {
  return snapshot.repoRoot ? basename(snapshot.repoRoot) : basename(snapshot.root);
}
