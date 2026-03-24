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
import { decorateDurableRunAttention, decorateDurableRunsAttention } from './durableRunAttention.js';

const LIST_DURABLE_RUNS_CACHE_TTL_MS = 1_500;

export interface DurableRunsListTelemetry {
  cache: 'hit' | 'inflight' | 'miss';
  source: 'daemon' | 'scan';
  durationMs: number;
  runCount: number;
}

let durableRunsListCache:
  | {
      expiresAt: number;
      value: (ListDurableRunsResult & { runsRoot: string }) | null;
      promise: Promise<ListDurableRunsResult & { runsRoot: string }> | null;
      source: DurableRunsListTelemetry['source'] | null;
    }
  | null = null;

export function clearDurableRunsListCache(): void {
  durableRunsListCache = null;
}

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
  return decorateDurableRunsAttention(runs.map((run) => decorateRemoteExecutionRun(run)));
}

function decorateRun<T extends ScannedDurableRun>(run: T) {
  return decorateDurableRunAttention(decorateRemoteExecutionRun(run));
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

export async function listDurableRunsWithTelemetry(): Promise<{
  result: ListDurableRunsResult & { runsRoot: string };
  telemetry: DurableRunsListTelemetry;
}> {
  const startedAt = process.hrtime.bigint();
  const now = Date.now();
  if (durableRunsListCache?.value && durableRunsListCache.expiresAt > now) {
    return {
      result: durableRunsListCache.value,
      telemetry: {
        cache: 'hit',
        source: durableRunsListCache.source ?? 'scan',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        runCount: durableRunsListCache.value.runs.length,
      },
    };
  }

  if (durableRunsListCache?.promise) {
    const result = await durableRunsListCache.promise;
    return {
      result,
      telemetry: {
        cache: 'inflight',
        source: durableRunsListCache.source ?? 'scan',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        runCount: result.runs.length,
      },
    };
  }

  let source: DurableRunsListTelemetry['source'] = 'scan';
  const request = (async () => {
    const runsRoot = resolveRunsRoot();

    try {
      if (await pingDaemon()) {
        source = 'daemon';
        const result = await listDurableRunsFromDaemon();
        return {
          ...result,
          runs: decorateRuns(result.runs),
          runsRoot,
        };
      }
    } catch (error) {
      if (!isDaemonUnavailable(error)) {
        throw error;
      }
    }

    source = 'scan';
    const scannedAt = new Date().toISOString();
    const runs = scanDurableRunsForRecovery(runsRoot);
    return {
      scannedAt,
      runs: decorateRuns(runs),
      summary: summarizeScannedDurableRuns(runs),
      runsRoot,
    };
  })();

  durableRunsListCache = {
    expiresAt: now + LIST_DURABLE_RUNS_CACHE_TTL_MS,
    value: durableRunsListCache?.value ?? null,
    promise: request,
    source: durableRunsListCache?.source ?? null,
  };

  try {
    const result = await request;
    durableRunsListCache = {
      expiresAt: Date.now() + LIST_DURABLE_RUNS_CACHE_TTL_MS,
      value: result,
      promise: null,
      source,
    };
    return {
      result,
      telemetry: {
        cache: 'miss',
        source,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        runCount: result.runs.length,
      },
    };
  } catch (error) {
    durableRunsListCache = null;
    throw error;
  }
}

export async function listDurableRuns(): Promise<ListDurableRunsResult & { runsRoot: string }> {
  return (await listDurableRunsWithTelemetry()).result;
}

export async function getDurableRun(runId: string): Promise<(GetDurableRunResult & { runsRoot: string }) | undefined> {
  const runsRoot = resolveRunsRoot();

  try {
    if (await pingDaemon()) {
      const result = await getDurableRunFromDaemon(runId);
      return {
        ...result,
        run: decorateRun(result.run),
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
    run: decorateRun(run),
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
