import {
  getGatewayConfigFilePath,
  type GatewayStoredConfig,
  type TelegramStoredConfig,
} from '@personal-agent/gateway';

export type GatewayTokenSource = 'missing' | 'plain' | 'one-password';

export interface GatewayTokenSummary {
  configured: boolean;
  source: GatewayTokenSource;
  preview?: string;
}

export interface GatewayConfigUpdateInput {
  profile: string;
  defaultModel?: string;
  token?: string;
  clearToken?: boolean;
  allowlistChatIds: string[];
  allowedUserIds: string[];
  blockedUserIds: string[];
  workingDirectory?: string;
  maxPendingPerChat?: number;
  toolActivityStream: boolean;
  clearRecentMessagesOnNew: boolean;
}

const GATEWAY_ENV_OVERRIDE_KEYS = [
  'PERSONAL_AGENT_PROFILE',
  'PERSONAL_AGENT_GATEWAY_DEFAULT_MODEL',
  'TELEGRAM_BOT_TOKEN',
  'PERSONAL_AGENT_TELEGRAM_ALLOWLIST',
  'PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS',
  'PERSONAL_AGENT_TELEGRAM_BLOCKED_USER_IDS',
  'PERSONAL_AGENT_TELEGRAM_CWD',
  'PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT',
  'PERSONAL_AGENT_TELEGRAM_TOOL_ACTIVITY_STREAM',
  'PERSONAL_AGENT_TELEGRAM_CLEAR_RECENT_MESSAGES_ON_NEW',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalModelReference(value: unknown, fieldName: string): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  const separatorIndex = normalized.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
    throw new Error(`${fieldName} must use format provider/model`);
  }

  return normalized;
}

function parseRequiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return value;
}

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  const parsed = Math.floor(value);
  if (parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

function parseRequiredStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }

  const normalized: string[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== 'string') {
      throw new Error(`${fieldName}[${index}] must be a string`);
    }

    const trimmed = entry.trim();
    if (trimmed.length === 0 || normalized.includes(trimmed)) {
      continue;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

function hasTelegramStoredConfig(config: TelegramStoredConfig): boolean {
  return Boolean(
    config.token
    || config.allowlist?.length
    || config.allowedUserIds?.length
    || config.blockedUserIds?.length
    || config.workingDirectory
    || config.maxPendingPerChat
    || config.toolActivityStream !== undefined
    || config.clearRecentMessagesOnNew !== undefined,
  );
}

export function summarizeGatewayToken(value: string | undefined): GatewayTokenSummary {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return {
      configured: false,
      source: 'missing',
    };
  }

  if (normalized.startsWith('op://')) {
    return {
      configured: true,
      source: 'one-password',
      preview: normalized,
    };
  }

  return {
    configured: true,
    source: 'plain',
    preview: normalized.length > 4 ? `••••${normalized.slice(-4)}` : '••••',
  };
}

export function listGatewayEnvOverrideKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return GATEWAY_ENV_OVERRIDE_KEYS.filter((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

export function parseGatewayConfigUpdateInput(value: unknown): GatewayConfigUpdateInput {
  if (!isRecord(value)) {
    throw new Error('gateway config body must be an object');
  }

  const profile = normalizeOptionalString(value.profile);
  if (!profile) {
    throw new Error('profile is required');
  }

  return {
    profile,
    defaultModel: parseOptionalModelReference(value.defaultModel, 'defaultModel'),
    token: normalizeOptionalString(value.token),
    clearToken: value.clearToken === true,
    allowlistChatIds: parseRequiredStringArray(value.allowlistChatIds, 'allowlistChatIds'),
    allowedUserIds: parseRequiredStringArray(value.allowedUserIds, 'allowedUserIds'),
    blockedUserIds: parseRequiredStringArray(value.blockedUserIds, 'blockedUserIds'),
    workingDirectory: normalizeOptionalString(value.workingDirectory),
    maxPendingPerChat: parseOptionalPositiveInteger(value.maxPendingPerChat, 'maxPendingPerChat'),
    toolActivityStream: parseRequiredBoolean(value.toolActivityStream, 'toolActivityStream'),
    clearRecentMessagesOnNew: parseRequiredBoolean(
      value.clearRecentMessagesOnNew,
      'clearRecentMessagesOnNew',
    ),
  };
}

export function buildGatewayStoredConfig(
  current: GatewayStoredConfig,
  input: GatewayConfigUpdateInput,
): GatewayStoredConfig {
  const currentTelegram = current.telegram ?? {};
  const token = input.clearToken
    ? undefined
    : input.token ?? currentTelegram.token;

  const telegram: TelegramStoredConfig = {
    token,
    allowlist: input.allowlistChatIds.length > 0 ? input.allowlistChatIds : undefined,
    allowedUserIds: input.allowedUserIds.length > 0 ? input.allowedUserIds : undefined,
    blockedUserIds: input.blockedUserIds.length > 0 ? input.blockedUserIds : undefined,
    workingDirectory: input.workingDirectory,
    maxPendingPerChat: input.maxPendingPerChat,
    toolActivityStream: input.toolActivityStream,
    clearRecentMessagesOnNew: input.clearRecentMessagesOnNew,
  };

  return {
    ...current,
    profile: input.profile,
    defaultModel: input.defaultModel,
    telegram: hasTelegramStoredConfig(telegram) ? telegram : undefined,
  };
}

export function readGatewayConfigFilePath(): string {
  return getGatewayConfigFilePath();
}
