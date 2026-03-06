import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface MaintenanceModuleConfig {
  enabled: boolean;
  cleanupIntervalMinutes: number;
}

export interface TasksModuleConfig {
  enabled: boolean;
  taskDir: string;
  tickIntervalSeconds: number;
  maxRetries: number;
  reapAfterDays: number;
  defaultTimeoutSeconds: number;
  runTasksInTmux?: boolean;
}

export interface DaemonConfig {
  logLevel: LogLevel;
  queue: {
    maxDepth: number;
  };
  ipc: {
    socketPath?: string;
  };
  modules: {
    maintenance: MaintenanceModuleConfig;
    tasks: TasksModuleConfig;
  };
}

const DEFAULT_DAEMON_CONFIG_FILE = join(homedir(), '.config', 'personal-agent', 'daemon.json');

function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

function expandConfigPaths(config: DaemonConfig): DaemonConfig {
  return {
    ...config,
    ipc: {
      ...config.ipc,
      socketPath: config.ipc.socketPath ? resolve(expandHome(config.ipc.socketPath)) : undefined,
    },
    modules: {
      ...config.modules,
      tasks: {
        ...config.modules.tasks,
        taskDir: resolve(expandHome(config.modules.tasks.taskDir)),
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    if (Array.isArray(value)) {
      output[key] = [...value];
      continue;
    }

    if (isRecord(value)) {
      const current = output[key];
      if (isRecord(current)) {
        output[key] = deepMerge(current, value);
      } else {
        output[key] = deepMerge({}, value);
      }
      continue;
    }

    output[key] = value;
  }

  return output;
}

function readConfigFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }

  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Invalid daemon config at ${path}: root must be an object`);
  }

  return parsed;
}

export function getDaemonConfigFilePath(): string {
  const explicit = process.env.PERSONAL_AGENT_DAEMON_CONFIG;

  if (explicit && explicit.trim().length > 0) {
    return resolve(expandHome(explicit));
  }

  return DEFAULT_DAEMON_CONFIG_FILE;
}

export function getDefaultDaemonConfig(): DaemonConfig {
  return {
    logLevel: 'info',
    queue: {
      maxDepth: 1000,
    },
    ipc: {
      socketPath: process.env.PERSONAL_AGENT_DAEMON_SOCKET_PATH,
    },
    modules: {
      maintenance: {
        enabled: true,
        cleanupIntervalMinutes: 60,
      },
      tasks: {
        enabled: true,
        taskDir: join(homedir(), '.config', 'personal-agent', 'tasks'),
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
        runTasksInTmux: true,
      },
    },
  };
}

export function loadDaemonConfig(): DaemonConfig {
  const defaults = getDefaultDaemonConfig();
  const filePath = getDaemonConfigFilePath();
  const fromDisk = readConfigFile(filePath);
  const merged = deepMerge(defaults as unknown as Record<string, unknown>, fromDisk);

  return expandConfigPaths(merged as unknown as DaemonConfig);
}
