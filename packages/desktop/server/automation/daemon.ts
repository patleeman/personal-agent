import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

import { getDaemonStatus, loadDaemonConfig, pingDaemon, resolveDaemonPaths } from '@personal-agent/daemon';

import { filterSystemLogTailLines } from '../shared/systemLogTail.js';

interface LogTail {
  path?: string;
  lines: string[];
}

function getDesktopDaemonLogFile(): string | undefined {
  return process.env.PERSONAL_AGENT_DESKTOP_DAEMON_LOG_FILE?.trim() || undefined;
}

interface DaemonServiceSummary {
  platform: string;
  identifier: string;
  manifestPath: string;
  installed: boolean;
  running: boolean;
  logFile?: string;
  error?: string;
}

interface DaemonRuntimeSummary {
  running: boolean;
  socketPath: string;
  pid?: number;
  startedAt?: string;
  moduleCount: number;
  queueDepth?: number;
  maxQueueDepth?: number;
}

export interface DaemonStateSnapshot {
  warnings: string[];
  service: DaemonServiceSummary;
  runtime: DaemonRuntimeSummary;
  log: LogTail;
}

function readTailLines(filePath: string | undefined, maxLines = 160, maxBytes = 192 * 1024): string[] {
  if (!filePath || !existsSync(filePath)) {
    return [];
  }

  let fd: number | undefined;

  try {
    const stats = statSync(filePath);
    const readLength = Math.min(maxBytes, stats.size);
    if (readLength <= 0) {
      return [];
    }

    const buffer = Buffer.alloc(readLength);
    fd = openSync(filePath, 'r');
    readSync(fd, buffer, 0, readLength, stats.size - readLength);

    const text = buffer.toString('utf-8');
    return filterSystemLogTailLines(
      text
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0),
    ).slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

function readDaemonServiceSummary(defaultLogFile: string): DaemonServiceSummary {
  return {
    platform: 'desktop',
    identifier: 'desktop-local-daemon',
    manifestPath: 'desktop menubar runtime',
    installed: true,
    running: true,
    logFile: getDesktopDaemonLogFile() ?? defaultLogFile,
  };
}

export async function readDaemonState(): Promise<DaemonStateSnapshot> {
  const config = loadDaemonConfig();
  const paths = resolveDaemonPaths(config.ipc.socketPath);
  const service = readDaemonServiceSummary(paths.logFile);

  const runtime: DaemonRuntimeSummary = {
    running: false,
    socketPath: paths.socketPath,
    moduleCount: 0,
  };
  let runtimeInspectionError: string | undefined;

  try {
    if (await pingDaemon(config)) {
      const status = await getDaemonStatus(config);
      runtime.running = true;
      runtime.socketPath = status.socketPath;
      runtime.pid = status.pid;
      runtime.startedAt = status.startedAt;
      runtime.moduleCount = status.modules.length;
      runtime.queueDepth = status.queue.currentDepth;
      runtime.maxQueueDepth = status.queue.maxDepth;
    }
  } catch (error) {
    runtimeInspectionError = error instanceof Error ? error.message : String(error);
  }

  const warnings: string[] = [];

  if (runtimeInspectionError) {
    warnings.push(`Could not inspect daemon runtime: ${runtimeInspectionError}`);
  } else if (!runtime.running) {
    warnings.push('Daemon runtime is not responding on the local socket.');
  }

  const logPath = service.logFile ?? paths.logFile;

  return {
    warnings,
    service,
    runtime,
    log: {
      path: logPath,
      lines: readTailLines(logPath),
    },
  };
}
