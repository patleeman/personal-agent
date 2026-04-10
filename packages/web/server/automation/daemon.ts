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
} from '@personal-agent/daemon';
import { filterSystemLogTailLines } from '../shared/systemLogTail.js';
import { getStateRoot } from '@personal-agent/core';
import {
  getManagedDaemonServiceStatus,
  installManagedDaemonService,
  restartManagedDaemonServiceIfInstalled,
  startManagedDaemonService,
  stopManagedDaemonService,
  uninstallManagedDaemonService,
} from '@personal-agent/services';

interface LogTail {
  path?: string;
  lines: string[];
}

const DESKTOP_DAEMON_SERVICE_MESSAGE = 'Managed daemon service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local daemon runtime.';

function isDesktopRuntime(): boolean {
  return process.env.PERSONAL_AGENT_DESKTOP_RUNTIME === '1';
}

function assertManagedDaemonServiceLifecycleAvailable(): void {
  if (isDesktopRuntime()) {
    throw new Error(DESKTOP_DAEMON_SERVICE_MESSAGE);
  }
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

function resolveDaemonServicePlatform(): string {
  if (process.platform === 'darwin') {
    return 'launchd';
  }

  if (process.platform === 'linux') {
    return 'systemd';
  }

  return process.platform;
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
  if (isDesktopRuntime()) {
    return {
      platform: 'desktop',
      identifier: 'desktop-local-daemon',
      manifestPath: 'desktop menubar runtime',
      installed: true,
      running: true,
      logFile: getDesktopDaemonLogFile() ?? join(getStateRoot(), 'desktop', 'logs', 'daemon.log'),
    };
  }

  try {
    const status = getManagedDaemonServiceStatus();
    return {
      platform: resolveDaemonServicePlatform(),
      identifier: status.identifier,
      manifestPath: status.manifestPath,
      installed: status.installed,
      running: status.running,
      logFile: status.logFile ?? defaultLogFile,
    };
  } catch (error) {
    return {
      platform: resolveDaemonServicePlatform(),
      identifier: 'personal-agent-daemon',
      manifestPath: '',
      installed: false,
      running: false,
      logFile: defaultLogFile,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

  if (service.error) {
    warnings.push(`Could not inspect daemon service status: ${service.error}`);
  } else if (!isDesktopRuntime() && service.installed && !service.running) {
    warnings.push('Daemon service is installed but not running.');
  } else if (!isDesktopRuntime() && !service.installed && !runtime.running) {
    warnings.push('Daemon service is not installed. Install it from this page or run `pa daemon service install`.');
  }

  if (runtimeInspectionError) {
    warnings.push(`Could not inspect daemon runtime: ${runtimeInspectionError}`);
  } else if (service.installed && !runtime.running) {
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

export async function installDaemonServiceAndReadState(): Promise<DaemonStateSnapshot> {
  assertManagedDaemonServiceLifecycleAvailable();
  installManagedDaemonService();
  return readDaemonState();
}

export async function startDaemonServiceAndReadState(): Promise<DaemonStateSnapshot> {
  assertManagedDaemonServiceLifecycleAvailable();
  startManagedDaemonService();
  return readDaemonState();
}

export async function restartDaemonServiceAndReadState(): Promise<DaemonStateSnapshot> {
  assertManagedDaemonServiceLifecycleAvailable();
  const restarted = restartManagedDaemonServiceIfInstalled();
  if (!restarted) {
    throw new Error('Daemon service is not installed. Install it from this page or run `pa daemon service install`.');
  }

  return readDaemonState();
}

export async function stopDaemonServiceAndReadState(): Promise<DaemonStateSnapshot> {
  assertManagedDaemonServiceLifecycleAvailable();
  stopManagedDaemonService();
  return readDaemonState();
}

export async function uninstallDaemonServiceAndReadState(): Promise<DaemonStateSnapshot> {
  assertManagedDaemonServiceLifecycleAvailable();
  uninstallManagedDaemonService();
  return readDaemonState();
}
