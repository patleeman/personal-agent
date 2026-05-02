import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

export interface GitRepoInfo {
  root: string;
  name: string;
}

export type GitStatusChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted';

export interface GitStatusChange {
  relativePath: string;
  change: GitStatusChangeKind;
}

export interface GitStatusSummary {
  branch: string | null;
  changeCount: number;
  linesAdded: number;
  linesDeleted: number;
  changes: GitStatusChange[];
}

export interface GitStatusReadTelemetry {
  cache: 'hit' | 'miss';
  durationMs: number;
  hasRepo: boolean;
  degraded: boolean;
}

const GIT_STATUS_CACHE_TTL_MS = 3_000;
const GIT_STATUS_DEGRADED_CACHE_TTL_MS = 15_000;
const GIT_REPO_INFO_CACHE_TTL_MS = 30_000;
const GIT_STATUS_TOTAL_BUDGET_MS = 2_000;
const GIT_STATUS_COMMAND_TIMEOUT_MS = 1_500;
const MAX_GIT_STATUS_CACHE_ENTRIES = 64;
const MAX_GIT_REPO_INFO_CACHE_ENTRIES = 256;
const gitStatusSummaryCache = new Map<string, {
  fetchedAt: number;
  ttlMs: number;
  summary: GitStatusSummary | null;
  hasRepo: boolean;
  degraded: boolean;
}>();
const gitRepoInfoCache = new Map<string, {
  fetchedAt: number;
  repo: GitRepoInfo | null;
}>();

type HeadCommitState = 'present' | 'absent' | 'unknown';

interface GitCommandResult {
  stdout: string;
  exitCode: number;
  timedOut: boolean;
}

function runGitCommand(args: string[], cwd: string, timeoutMs = GIT_STATUS_COMMAND_TIMEOUT_MS): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
}

function runGitCommandAllowFailure(args: string[], cwd: string, timeoutMs = GIT_STATUS_COMMAND_TIMEOUT_MS): GitCommandResult {
  try {
    return {
      stdout: runGitCommand(args, cwd, timeoutMs),
      exitCode: 0,
      timedOut: false,
    };
  } catch (error) {
    const childError = error as { stdout?: string | Buffer; status?: number | null; code?: string };
    const stdout = typeof childError.stdout === 'string'
      ? childError.stdout
      : Buffer.isBuffer(childError.stdout)
        ? childError.stdout.toString('utf-8')
        : '';

    return {
      stdout,
      exitCode: typeof childError.status === 'number' ? childError.status : 1,
      timedOut: childError.code === 'ETIMEDOUT',
    };
  }
}

function remainingBudgetTimeout(deadlineAt: number): number | null {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    return null;
  }

  return Math.max(50, Math.min(GIT_STATUS_COMMAND_TIMEOUT_MS, remainingMs));
}

function trimOldestEntries<T>(cache: Map<string, T>, maxEntries: number): void {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }

    cache.delete(oldestKey);
  }
}

function cacheGitStatusSummary(cacheKey: string, summary: GitStatusSummary | null, hasRepo: boolean, degraded: boolean): void {
  gitStatusSummaryCache.set(cacheKey, {
    fetchedAt: Date.now(),
    ttlMs: degraded ? GIT_STATUS_DEGRADED_CACHE_TTL_MS : GIT_STATUS_CACHE_TTL_MS,
    summary,
    hasRepo,
    degraded,
  });
  trimOldestEntries(gitStatusSummaryCache, MAX_GIT_STATUS_CACHE_ENTRIES);
}

function cacheGitRepoInfo(cwd: string, repo: GitRepoInfo | null): GitRepoInfo | null {
  gitRepoInfoCache.set(cwd, {
    fetchedAt: Date.now(),
    repo,
  });
  trimOldestEntries(gitRepoInfoCache, MAX_GIT_REPO_INFO_CACHE_ENTRIES);
  return repo;
}

export function countGitStatusEntries(output: string): number {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .length;
}

export function parseGitNumstat(output: string): { linesAdded: number; linesDeleted: number } {
  let linesAdded = 0;
  let linesDeleted = 0;

  const parseCount = (value: string | undefined): number | null => {
    const normalized = value?.trim() ?? '';
    if (!/^\d+$/.test(normalized)) {
      return null;
    }

    const parsed = Number.parseInt(normalized, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [addedRaw, deletedRaw] = trimmed.split('\t');
    const added = parseCount(addedRaw);
    const deleted = parseCount(deletedRaw);

    if (added !== null) {
      linesAdded += added;
    }

    if (deleted !== null) {
      linesDeleted += deleted;
    }
  }

  return { linesAdded, linesDeleted };
}

function readHeadCommitState(cwd: string, deadlineAt: number): HeadCommitState {
  const timeoutMs = remainingBudgetTimeout(deadlineAt);
  if (!timeoutMs) {
    return 'unknown';
  }

  const result = runGitCommandAllowFailure(['rev-parse', '--verify', 'HEAD'], cwd, timeoutMs);
  if (result.timedOut) {
    return 'unknown';
  }

  return result.exitCode === 0 ? 'present' : 'absent';
}

function normalizeGitStatusChange(code: string): GitStatusChangeKind | null {
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

function normalizeGitStatusPath(statusLine: string, change: GitStatusChangeKind | null): string {
  const rawPath = statusLine.slice(3).trim();
  if ((change === 'renamed' || change === 'copied') && rawPath.includes(' -> ')) {
    return rawPath.split(' -> ').at(-1)?.trim() ?? rawPath;
  }

  return rawPath;
}

function parseGitStatusBranch(output: string): string | null {
  const branchLine = output.split('\n').find((line) => line.startsWith('## '));
  if (!branchLine) {
    return null;
  }

  const raw = branchLine.slice(3).trim();
  if (!raw || raw === 'HEAD (no branch)') {
    return null;
  }

  if (raw.startsWith('No commits yet on ')) {
    return raw.slice('No commits yet on '.length).trim() || null;
  }

  return raw.split('...')[0]?.trim() || null;
}

function parseGitStatusChanges(output: string): GitStatusChange[] {
  const result = new Map<string, GitStatusChangeKind>();

  for (const line of output.split('\n')) {
    if (line.length < 4 || line.startsWith('## ')) {
      continue;
    }

    const change = normalizeGitStatusChange(line.slice(0, 2));
    if (!change) {
      continue;
    }

    const relativePath = normalizeGitStatusPath(line, change);
    if (!relativePath) {
      continue;
    }

    result.set(relativePath, change);
  }

  return [...result.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([relativePath, change]) => ({ relativePath, change }));
}

function readTrackedDiffSummary(cwd: string, deadlineAt: number): { linesAdded: number; linesDeleted: number; degraded: boolean } {
  const headState = readHeadCommitState(cwd, deadlineAt);
  if (headState === 'unknown') {
    return { linesAdded: 0, linesDeleted: 0, degraded: true };
  }

  if (headState === 'present') {
    const timeoutMs = remainingBudgetTimeout(deadlineAt);
    if (!timeoutMs) {
      return { linesAdded: 0, linesDeleted: 0, degraded: true };
    }

    const result = runGitCommandAllowFailure(['diff', '--numstat', 'HEAD'], cwd, timeoutMs);
    if (result.exitCode !== 0) {
      return { linesAdded: 0, linesDeleted: 0, degraded: true };
    }

    return {
      ...parseGitNumstat(result.stdout),
      degraded: false,
    };
  }

  let linesAdded = 0;
  let linesDeleted = 0;
  let degraded = false;

  for (const args of [
    ['diff', '--cached', '--numstat'],
    ['diff', '--numstat'],
  ]) {
    const timeoutMs = remainingBudgetTimeout(deadlineAt);
    if (!timeoutMs) {
      return { linesAdded, linesDeleted, degraded: true };
    }

    const result = runGitCommandAllowFailure(args, cwd, timeoutMs);
    if (result.exitCode !== 0) {
      degraded = true;
      if (result.timedOut) {
        break;
      }
      continue;
    }

    const diffSummary = parseGitNumstat(result.stdout);
    linesAdded += diffSummary.linesAdded;
    linesDeleted += diffSummary.linesDeleted;
  }

  return { linesAdded, linesDeleted, degraded };
}

function readUntrackedDiffSummary(cwd: string, untrackedPaths: string[], deadlineAt: number): { linesAdded: number; linesDeleted: number; degraded: boolean } {
  let linesAdded = 0;
  let linesDeleted = 0;
  let degraded = false;

  for (const filePath of untrackedPaths) {
    const timeoutMs = remainingBudgetTimeout(deadlineAt);
    if (!timeoutMs) {
      return { linesAdded, linesDeleted, degraded: true };
    }

    const result = runGitCommandAllowFailure(['diff', '--no-index', '--numstat', '--', '/dev/null', filePath], cwd, timeoutMs);
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      degraded = true;
      if (result.timedOut) {
        break;
      }
      continue;
    }

    const fileSummary = parseGitNumstat(result.stdout);
    linesAdded += fileSummary.linesAdded;
    linesDeleted += fileSummary.linesDeleted;
  }

  return { linesAdded, linesDeleted, degraded };
}

export function readGitRepoInfo(cwd: string): GitRepoInfo | null {
  const cached = gitRepoInfoCache.get(cwd);
  if (cached && (Date.now() - cached.fetchedAt) <= GIT_REPO_INFO_CACHE_TTL_MS) {
    return cached.repo;
  }

  try {
    const isWorkTree = runGitCommand(['rev-parse', '--is-inside-work-tree'], cwd).trim();
    if (isWorkTree !== 'true') {
      return cacheGitRepoInfo(cwd, null);
    }

    const root = resolve(runGitCommand(['rev-parse', '--show-toplevel'], cwd).trim());
    const name = basename(root).trim();
    if (!name) {
      return cacheGitRepoInfo(cwd, null);
    }

    return cacheGitRepoInfo(cwd, { root, name });
  } catch {
    return cacheGitRepoInfo(cwd, null);
  }
}

export function readGitStatusSummaryWithTelemetry(cwd: string): {
  summary: GitStatusSummary | null;
  telemetry: GitStatusReadTelemetry;
} {
  const startedAt = process.hrtime.bigint();
  const repo = readGitRepoInfo(cwd);
  if (!repo) {
    return {
      summary: null,
      telemetry: {
        cache: 'miss',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        hasRepo: false,
        degraded: false,
      },
    };
  }

  const repoRoot = repo.root;
  const cached = gitStatusSummaryCache.get(repoRoot);
  if (cached && (Date.now() - cached.fetchedAt) <= cached.ttlMs) {
    return {
      summary: cached.summary,
      telemetry: {
        cache: 'hit',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        hasRepo: cached.hasRepo,
        degraded: cached.degraded,
      },
    };
  }

  const deadlineAt = Date.now() + GIT_STATUS_TOTAL_BUDGET_MS;
  const statusTimeoutMs = remainingBudgetTimeout(deadlineAt);
  if (!statusTimeoutMs) {
    cacheGitStatusSummary(repoRoot, null, true, true);
    return {
      summary: null,
      telemetry: {
        cache: 'miss',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        hasRepo: true,
        degraded: true,
      },
    };
  }

  const statusResult = runGitCommandAllowFailure(['status', '--porcelain=v1', '--branch', '--untracked-files=all'], repoRoot, statusTimeoutMs);
  if (statusResult.exitCode !== 0) {
    cacheGitStatusSummary(repoRoot, null, true, true);
    return {
      summary: null,
      telemetry: {
        cache: 'miss',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        hasRepo: true,
        degraded: true,
      },
    };
  }

  const branch = parseGitStatusBranch(statusResult.stdout);
  const changes = parseGitStatusChanges(statusResult.stdout);
  let linesAdded = 0;
  let linesDeleted = 0;
  let degraded = false;

  if (changes.length > 0) {
    const untrackedPaths = changes
      .filter((change) => change.change === 'untracked')
      .map((change) => change.relativePath);
    const hasTrackedChanges = changes.some((change) => change.change !== 'untracked');

    if (hasTrackedChanges) {
      const trackedSummary = readTrackedDiffSummary(repoRoot, deadlineAt);
      linesAdded += trackedSummary.linesAdded;
      linesDeleted += trackedSummary.linesDeleted;
      degraded = trackedSummary.degraded;
    }

    if ((!hasTrackedChanges || !degraded) && untrackedPaths.length > 0) {
      const untrackedSummary = readUntrackedDiffSummary(repoRoot, untrackedPaths, deadlineAt);
      linesAdded += untrackedSummary.linesAdded;
      linesDeleted += untrackedSummary.linesDeleted;
      degraded = degraded || untrackedSummary.degraded;
    }
  }

  const summary = {
    branch,
    changeCount: changes.length,
    linesAdded,
    linesDeleted,
    changes,
  } satisfies GitStatusSummary;

  cacheGitStatusSummary(repoRoot, summary, true, degraded);
  return {
    summary,
    telemetry: {
      cache: 'miss',
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      hasRepo: true,
      degraded,
    },
  };
}

export function readGitStatusSummary(cwd: string): GitStatusSummary | null {
  return readGitStatusSummaryWithTelemetry(cwd).summary;
}
