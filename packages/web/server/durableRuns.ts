import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import {
  cancelDurableRun as cancelDurableRunFromDaemon,
  getDurableRun as getDurableRunFromDaemon,
  listDurableRuns as listDurableRunsFromDaemon,
  pingDaemon,
  resolveDaemonPaths,
  resolveDurableRunsRoot,
  scanDurableRun,
  scanDurableRunsForRecovery,
  summarizeScannedDurableRuns,
  type CancelDurableRunResult,
  type GetDurableRunResult,
  type ListDurableRunsResult,
  type ScannedDurableRun,
} from '@personal-agent/daemon';
import { decorateRemoteExecutionRun } from './remoteExecution.js';

const LIST_DURABLE_RUNS_CACHE_TTL_MS = 1_500;

let durableRunsListCache:
  | {
      expiresAt: number;
      value: (ListDurableRunsResult & { runsRoot: string }) | null;
      promise: Promise<ListDurableRunsResult & { runsRoot: string }> | null;
    }
  | null = null;

function isDaemonUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('enoent')
    || message.includes('econnrefused')
    || message.includes('timed out')
    || message.includes('closed without response')
    || message.includes('unknown request type');
}

function isRunNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes('run not found');
}

function resolveRunsRoot(): string {
  return resolveDurableRunsRoot(resolveDaemonPaths().root);
}

function decorateRuns<T extends ScannedDurableRun>(runs: T[]) {
  return runs.map((run) => decorateRemoteExecutionRun(run));
}

function readTailText(filePath: string | undefined, maxLines = 120, maxBytes = 64 * 1024): string {
  if (!filePath || !existsSync(filePath)) {
    return '';
  }

  let fd: number | undefined;

  try {
    const stats = statSync(filePath);
    const readLength = Math.min(maxBytes, stats.size);
    if (readLength <= 0) {
      return '';
    }

    const buffer = Buffer.alloc(readLength);
    fd = openSync(filePath, 'r');
    readSync(fd, buffer, 0, readLength, stats.size - readLength);

    return buffer
      .toString('utf-8')
      .split(/\r?\n/)
      .slice(-maxLines)
      .join('\n')
      .trim();
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

export async function listDurableRuns(): Promise<ListDurableRunsResult & { runsRoot: string }> {
  const now = Date.now();
  if (durableRunsListCache?.value && durableRunsListCache.expiresAt > now) {
    return durableRunsListCache.value;
  }

  if (durableRunsListCache?.promise) {
    return durableRunsListCache.promise;
  }

  const request = (async () => {
    const runsRoot = resolveRunsRoot();

    try {
      if (await pingDaemon()) {
        const result = await listDurableRunsFromDaemon();
        return {
          ...result,
          runsRoot,
        };
      }
    } catch (error) {
      if (!isDaemonUnavailable(error)) {
        throw error;
      }
    }

    const scannedAt = new Date().toISOString();
    const runs = scanDurableRunsForRecovery(runsRoot);
    return {
      scannedAt,
      runs,
      summary: summarizeScannedDurableRuns(runs),
      runsRoot,
    };
  })();

  durableRunsListCache = {
    expiresAt: now + LIST_DURABLE_RUNS_CACHE_TTL_MS,
    value: durableRunsListCache?.value ?? null,
    promise: request,
  };

  return request
    .then((result) => {
      durableRunsListCache = {
        expiresAt: Date.now() + LIST_DURABLE_RUNS_CACHE_TTL_MS,
        value: result,
        promise: null,
      };
      return result;
    })
    .catch((error) => {
      durableRunsListCache = null;
      throw error;
    });
}

export async function getDurableRun(runId: string): Promise<(GetDurableRunResult & { runsRoot: string }) | undefined> {
  const runsRoot = resolveRunsRoot();

  try {
    if (await pingDaemon()) {
      const result = await getDurableRunFromDaemon(runId);
      return {
        ...result,
        runsRoot,
      };
    }
  } catch (error) {
    if (isRunNotFound(error)) {
      return undefined;
    }

    if (!isDaemonUnavailable(error)) {
      throw error;
    }
  }

  const run = scanDurableRun(runsRoot, runId);
  if (!run) {
    return undefined;
  }

  return {
    scannedAt: new Date().toISOString(),
    run,
    runsRoot,
  };
}

export async function getDurableRunSnapshot(runId: string, tail = 120): Promise<{
  detail: GetDurableRunResult & { runsRoot: string };
  log: { path: string; log: string };
} | undefined> {
  const detail = await getDurableRun(runId);
  if (!detail) {
    return undefined;
  }

  return {
    detail,
    log: {
      path: detail.run.paths.outputLogPath,
      log: readTailText(detail.run.paths.outputLogPath, tail),
    },
  };
}

export async function getDurableRunLog(runId: string, tail = 120): Promise<{ path: string; log: string } | undefined> {
  const snapshot = await getDurableRunSnapshot(runId, tail);
  return snapshot?.log;
}

export async function cancelDurableRun(runId: string): Promise<CancelDurableRunResult> {
  return cancelDurableRunFromDaemon(runId);
}
