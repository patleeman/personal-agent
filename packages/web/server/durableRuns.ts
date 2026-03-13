import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import {
  getDurableRun as getDurableRunFromDaemon,
  listDurableRuns as listDurableRunsFromDaemon,
  pingDaemon,
  resolveDaemonPaths,
  resolveDurableRunsRoot,
  scanDurableRun,
  scanDurableRunsForRecovery,
  summarizeScannedDurableRuns,
  type GetDurableRunResult,
  type ListDurableRunsResult,
} from '@personal-agent/daemon';

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

function resolveRunsRoot(): string {
  return resolveDurableRunsRoot(resolveDaemonPaths().root);
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

export async function getDurableRunLog(runId: string, tail = 120): Promise<{ path: string; log: string } | undefined> {
  const result = await getDurableRun(runId);
  if (!result) {
    return undefined;
  }

  return {
    path: result.run.paths.outputLogPath,
    log: readTailText(result.run.paths.outputLogPath, tail),
  };
}
