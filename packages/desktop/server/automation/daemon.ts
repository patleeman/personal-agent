import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  getDaemonStatus,
  loadDaemonConfig,
  pingDaemon,
  resolveDaemonPaths,
  setDaemonPowerKeepAwake,
} from '@personal-agent/daemon';
import { filterSystemLogTailLines } from '../shared/systemLogTail.js';
import { getStateRoot } from '@personal-agent/core';

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

interface DaemonPowerSummary {
  keepAwake: boolean;
  supported: boolean;
  active: boolean;
  error?: string;
}

export interface DaemonStateSnapshot {
  warnings: string[];
  service: DaemonServiceSummary;
  runtime: DaemonRuntimeSummary;
  power: DaemonPowerSummary;
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
  let power: DaemonPowerSummary = {
    keepAwake: config.power?.keepAwake === true,
    supported: process.platform === 'darwin',
    active: false,
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
      power = status.power;
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

  if (power.keepAwake && !power.supported) {
    warnings.push('Keeping the daemon awake is only supported on macOS.');
  } else if (power.keepAwake && power.error) {
    warnings.push(`Could not keep the daemon awake: ${power.error}`);
  }

  const logPath = service.logFile ?? paths.logFile;

  return {
    warnings,
    service,
    runtime,
    power,
    log: {
      path: logPath,
      lines: readTailLines(logPath),
    },
  };
}

export async function updateDaemonPowerAndReadState(input: { keepAwake: boolean }): Promise<DaemonStateSnapshot> {
  const config = loadDaemonConfig();
  if (!(await pingDaemon(config))) {
    throw new Error('Daemon runtime is not responding on the local socket. Start the daemon and try again.');
  }

  await setDaemonPowerKeepAwake(input.keepAwake, config);
  return readDaemonState();
}

