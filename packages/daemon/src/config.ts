import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { resolveStatePaths } from '@personal-agent/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface MemoryCollectionConfig {
  name: string;
  path: string;
  mask?: string;
}

export interface MemorySummarizationConfig {
  provider?: 'pi-sdk';
  maxTurns?: number;
  maxCharsPerTurn?: number;
  maxTranscriptChars?: number;
  minTranscriptTokens?: number;
}

export interface MemoryModuleConfig {
  enabled: boolean;
  sessionSource: string;
  summaryDir: string;
  cardsDir?: string;
  cardsCollectionName?: string;
  scanIntervalMinutes?: number;
  inactiveAfterMinutes?: number;
  retentionDays?: number;
  collections: MemoryCollectionConfig[];
  summarization?: MemorySummarizationConfig;
  qmd: {
    index: string;
    updateDebounceSeconds: number;
    embedDebounceSeconds: number;
    reconcileIntervalMinutes?: number;
  };
}

export interface MaintenanceModuleConfig {
  enabled: boolean;
  cleanupIntervalMinutes: number;
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
    memory: MemoryModuleConfig;
    maintenance: MaintenanceModuleConfig;
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
      memory: {
        ...config.modules.memory,
        sessionSource: resolve(expandHome(config.modules.memory.sessionSource)),
        summaryDir: resolve(expandHome(config.modules.memory.summaryDir)),
        cardsDir: config.modules.memory.cardsDir
          ? resolve(expandHome(config.modules.memory.cardsDir))
          : undefined,
        collections: config.modules.memory.collections.map((collection) => ({
          ...collection,
          path: resolve(expandHome(collection.path)),
        })),
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
  const statePaths = resolveStatePaths();
  const summaryDir = join(statePaths.root, 'memory', 'conversations');
  const cardsDir = join(statePaths.root, 'memory', 'cards');

  return {
    logLevel: 'info',
    queue: {
      maxDepth: 1000,
    },
    ipc: {
      socketPath: process.env.PERSONAL_AGENT_DAEMON_SOCKET_PATH,
    },
    modules: {
      memory: {
        enabled: true,
        sessionSource: join(statePaths.root, 'pi-agent', 'sessions'),
        summaryDir,
        cardsDir,
        cardsCollectionName: 'memory_cards',
        scanIntervalMinutes: 5,
        inactiveAfterMinutes: 30,
        retentionDays: 90,
        collections: [
          {
            name: 'conversations',
            path: summaryDir,
            mask: '**/*.md',
          },
        ],
        summarization: {
          provider: 'pi-sdk',
          maxTurns: 250,
          maxCharsPerTurn: 600,
          maxTranscriptChars: 18_000,
          minTranscriptTokens: 30,
        },
        qmd: {
          index: 'default',
          updateDebounceSeconds: 45,
          embedDebounceSeconds: 600,
          reconcileIntervalMinutes: 60,
        },
      },
      maintenance: {
        enabled: true,
        cleanupIntervalMinutes: 60,
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
