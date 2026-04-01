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
}

const GIT_STATUS_CACHE_TTL_MS = 3_000;
const gitStatusSummaryCache = new Map<string, { fetchedAt: number; summary: GitStatusSummary | null }>();

function runGitCommand(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
    timeout: 3000,
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

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [addedRaw, deletedRaw] = trimmed.split('\t');
    const added = Number.parseInt(addedRaw ?? '', 10);
    const deleted = Number.parseInt(deletedRaw ?? '', 10);

    if (Number.isFinite(added)) {
      linesAdded += added;
    }

    if (Number.isFinite(deleted)) {
      linesDeleted += deleted;
    }
  }

  return { linesAdded, linesDeleted };
}

function parseNulSeparatedPaths(output: string): string[] {
  return output
    .split('\0')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function readUntrackedDiffSummary(cwd: string): { linesAdded: number; linesDeleted: number } {
  const untrackedPaths = parseNulSeparatedPaths(runGitCommand(['ls-files', '--others', '--exclude-standard', '-z'], cwd));

  return untrackedPaths.reduce(
    (summary, filePath) => {
      const result = runGitCommandAllowFailure(['diff', '--no-index', '--numstat', '--', '/dev/null', filePath], cwd);
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return summary;
      }

      const fileSummary = parseGitNumstat(result.stdout);
      return {
        linesAdded: summary.linesAdded + fileSummary.linesAdded,
        linesDeleted: summary.linesDeleted + fileSummary.linesDeleted,
      };
    },
    { linesAdded: 0, linesDeleted: 0 },
  );
}

function hasHeadCommit(cwd: string): boolean {
  return runGitCommandAllowFailure(['rev-parse', '--verify', 'HEAD'], cwd).exitCode === 0;
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

function readGitStatusChanges(cwd: string): GitStatusChange[] {
  const output = runGitCommandAllowFailure(['status', '--porcelain=v1', '--untracked-files=all'], cwd).stdout;
  const result = new Map<string, GitStatusChangeKind>();

  for (const line of output.split('\n')) {
    if (line.length < 4) {
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

export function readGitRepoInfo(cwd: string): GitRepoInfo | null {
  try {
    const isWorkTree = runGitCommand(['rev-parse', '--is-inside-work-tree'], cwd).trim();
    if (isWorkTree !== 'true') {
      return null;
    }

    const root = resolve(runGitCommand(['rev-parse', '--show-toplevel'], cwd).trim());
    const name = basename(root).trim();
    if (!name) {
      return null;
    }

    return { root, name };
  } catch {
    return null;
  }
}

export function readGitStatusSummaryWithTelemetry(cwd: string): {
  summary: GitStatusSummary | null;
  telemetry: GitStatusReadTelemetry;
} {
  const startedAt = process.hrtime.bigint();
  const cached = gitStatusSummaryCache.get(cwd);
  if (cached && (Date.now() - cached.fetchedAt) <= GIT_STATUS_CACHE_TTL_MS) {
    return {
      summary: cached.summary,
      telemetry: {
        cache: 'hit',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        hasRepo: cached.summary !== null,
      },
    };
  }

  const repo = readGitRepoInfo(cwd);
  if (!repo) {
    gitStatusSummaryCache.set(cwd, { fetchedAt: Date.now(), summary: null });
    return {
      summary: null,
      telemetry: {
        cache: 'miss',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        hasRepo: false,
      },
    };
  }

  const repoRoot = repo.root;
  const branch = runGitCommandAllowFailure(['branch', '--show-current'], repoRoot).stdout.trim() || null;
  const changes = readGitStatusChanges(repoRoot);
  const trackedSummary = hasHeadCommit(repoRoot)
    ? parseGitNumstat(runGitCommand(['diff', '--numstat', 'HEAD'], repoRoot))
    : (() => {
        const stagedSummary = parseGitNumstat(runGitCommand(['diff', '--cached', '--numstat'], repoRoot));
        const unstagedSummary = parseGitNumstat(runGitCommand(['diff', '--numstat'], repoRoot));

        return {
          linesAdded: stagedSummary.linesAdded + unstagedSummary.linesAdded,
          linesDeleted: stagedSummary.linesDeleted + unstagedSummary.linesDeleted,
        };
      })();
  const untrackedSummary = readUntrackedDiffSummary(repoRoot);

  const summary = {
    branch,
    changeCount: changes.length,
    linesAdded: trackedSummary.linesAdded + untrackedSummary.linesAdded,
    linesDeleted: trackedSummary.linesDeleted + untrackedSummary.linesDeleted,
    changes,
  } satisfies GitStatusSummary;

  gitStatusSummaryCache.set(cwd, { fetchedAt: Date.now(), summary });
  return {
    summary,
    telemetry: {
      cache: 'miss',
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      hasRepo: true,
    },
  };
}

export function readGitStatusSummary(cwd: string): GitStatusSummary | null {
  return readGitStatusSummaryWithTelemetry(cwd).summary;
}
