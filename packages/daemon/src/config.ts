import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

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

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_DAEMON_CONFIG_FILE = join(homedir(), '.config', 'personal-agent', 'daemon.json');
const DEFAULT_PERSONAL_AGENT_CONFIG_FILE = join(homedir(), '.config', 'personal-agent', 'config.json');
const DEFAULT_PROFILE_NAME = 'shared';

function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

function normalizeProfileName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/.test(trimmed) ? trimmed : undefined;
}

function getPersonalAgentConfigFilePath(): string {
  const explicit = process.env.PERSONAL_AGENT_CONFIG_FILE;
  if (explicit && explicit.trim().length > 0) {
    return resolve(expandHome(explicit));
  }

  return DEFAULT_PERSONAL_AGENT_CONFIG_FILE;
}

function getActiveProfileName(): string {
  const envProfile = normalizeProfileName(process.env.PERSONAL_AGENT_PROFILE);
  if (envProfile) {
    return envProfile;
  }

  const configPath = getPersonalAgentConfigFilePath();
  if (!existsSync(configPath)) {
    return DEFAULT_PROFILE_NAME;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
    if (!isRecord(parsed)) {
      return DEFAULT_PROFILE_NAME;
    }

    return normalizeProfileName(parsed.defaultProfile) ?? DEFAULT_PROFILE_NAME;
  } catch {
    return DEFAULT_PROFILE_NAME;
  }
}

function getDefaultTasksDir(): string {
  const repoRoot = process.env.PERSONAL_AGENT_REPO_ROOT
    ? resolve(expandHome(process.env.PERSONAL_AGENT_REPO_ROOT))
    : PACKAGE_ROOT;

  return join(repoRoot, 'profiles', getActiveProfileName(), 'agent', 'tasks');
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
        taskDir: getDefaultTasksDir(),
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
