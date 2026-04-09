import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_PROTECTED_UPDATE_BASE_URL = 'https://personal-agent-download-gate.patricklee.workers.dev/updates/stable';
export const PACKAGED_UPDATE_CONFIG_FILE = 'auto-update-config.json';

export interface ProtectedUpdateFeedConfig {
  url: string;
  token: string;
}

function trimNonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeProtectedUpdateFeedConfig(value: unknown): ProtectedUpdateFeedConfig | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const input = value as { url?: unknown; token?: unknown };
  const url = trimNonEmpty(input.url);
  const token = trimNonEmpty(input.token);
  if (!url || !token) {
    return null;
  }

  return { url, token };
}

function readPackagedUpdateFeedConfig(resourcesPath: string): ProtectedUpdateFeedConfig | null {
  const configPath = join(resourcesPath, PACKAGED_UPDATE_CONFIG_FILE);
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
    return normalizeProtectedUpdateFeedConfig(parsed);
  } catch {
    return null;
  }
}

export function loadProtectedUpdateFeedConfig(options: {
  env?: NodeJS.ProcessEnv;
  resourcesPath?: string;
} = {}): ProtectedUpdateFeedConfig | null {
  const env = options.env ?? process.env;
  const fileConfig = readPackagedUpdateFeedConfig(options.resourcesPath ?? process.resourcesPath);

  return normalizeProtectedUpdateFeedConfig({
    url: trimNonEmpty(env.PERSONAL_AGENT_UPDATE_BASE_URL) ?? fileConfig?.url ?? null,
    token: trimNonEmpty(env.PERSONAL_AGENT_DOWNLOAD_TOKEN) ?? fileConfig?.token ?? null,
  });
}

export function createProtectedUpdateFeedOptions(config: ProtectedUpdateFeedConfig) {
  return {
    provider: 'generic' as const,
    url: config.url,
    useMultipleRangeRequest: false,
  };
}

export function createProtectedUpdateAuthHeader(config: ProtectedUpdateFeedConfig): string {
  return `Bearer ${config.token}`;
}
