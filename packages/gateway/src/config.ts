import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getConfigRoot } from '@personal-agent/core';

export interface TelegramStoredConfig {
  token?: string;
  allowlist?: string[];
  allowedUserIds?: string[];
  blockedUserIds?: string[];
  workingDirectory?: string;
  maxPendingPerChat?: number;
  toolActivityStream?: boolean;
  clearRecentMessagesOnNew?: boolean;
}

export interface GatewayStoredConfig {
  profile?: string;
  defaultModel?: string;
  telegram?: TelegramStoredConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toOptionalModelRef(value: unknown): string | undefined {
  const normalized = toOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  const separatorIndex = normalized.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
    return undefined;
  }

  return normalized;
}

function toOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);

  return values.length > 0 ? values : undefined;
}

function toOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value !== 'boolean') {
    return undefined;
  }

  return value;
}

function sanitizeTelegram(value: unknown): TelegramStoredConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const token = toOptionalString(value.token);
  const allowlist = toOptionalStringArray(value.allowlist);
  const allowedUserIds = toOptionalStringArray(value.allowedUserIds);
  const blockedUserIds = toOptionalStringArray(value.blockedUserIds);
  const workingDirectory = toOptionalString(value.workingDirectory);
  const maxPendingPerChat = toOptionalPositiveInt(value.maxPendingPerChat);
  const toolActivityStream = toOptionalBoolean(value.toolActivityStream);
  const clearRecentMessagesOnNew = toOptionalBoolean(value.clearRecentMessagesOnNew);

  if (
    !token
    && !allowlist
    && !allowedUserIds
    && !blockedUserIds
    && !workingDirectory
    && !maxPendingPerChat
    && toolActivityStream === undefined
    && clearRecentMessagesOnNew === undefined
  ) {
    return undefined;
  }

  return {
    token,
    allowlist,
    allowedUserIds,
    blockedUserIds,
    workingDirectory,
    maxPendingPerChat,
    toolActivityStream,
    clearRecentMessagesOnNew,
  };
}

export function getGatewayConfigFilePath(): string {
  const explicit = process.env.PERSONAL_AGENT_GATEWAY_CONFIG_FILE;
  if (explicit && explicit.trim().length > 0) {
    return resolve(explicit);
  }

  return join(getConfigRoot(), 'gateway.json');
}

export function readGatewayConfig(): GatewayStoredConfig {
  const filePath = getGatewayConfigFilePath();

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;

    if (!isRecord(parsed)) {
      return {};
    }

    return {
      profile: toOptionalString(parsed.profile),
      defaultModel: toOptionalModelRef(parsed.defaultModel),
      telegram: sanitizeTelegram(parsed.telegram),
    };
  } catch {
    return {};
  }
}

export function writeGatewayConfig(config: GatewayStoredConfig): void {
  const filePath = getGatewayConfigFilePath();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);

  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod failures on unsupported filesystems.
  }
}
