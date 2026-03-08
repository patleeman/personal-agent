import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { GatewayNotificationProvider } from '../types.js';

export type DeferredFollowUpStatus = 'scheduled' | 'queued';
export type DeferredFollowUpTelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface DeferredFollowUpRecord {
  id: string;
  gateway: GatewayNotificationProvider;
  conversationId: string;
  sessionFile: string;
  prompt: string;
  dueAt: string;
  createdAt: string;
  status: DeferredFollowUpStatus;
  queuedAt?: string;
  attempts: number;
  initiatedByUserId?: string;
  telegramChatType?: DeferredFollowUpTelegramChatType;
}

export interface DeferredFollowUpStateFile {
  version: 1;
  followUps: Record<string, DeferredFollowUpRecord>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toGatewayProvider(value: unknown): GatewayNotificationProvider | undefined {
  if (value === 'telegram' || value === 'discord') {
    return value;
  }

  return undefined;
}

function toStatus(value: unknown): DeferredFollowUpStatus | undefined {
  if (value === 'scheduled' || value === 'queued') {
    return value;
  }

  return undefined;
}

function toTelegramChatType(value: unknown): DeferredFollowUpTelegramChatType | undefined {
  if (value === 'private' || value === 'group' || value === 'supergroup' || value === 'channel') {
    return value;
  }

  return undefined;
}

function toAttempts(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  return 0;
}

function normalizeTimestamp(value: string): string | undefined {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return undefined;
  }

  return new Date(parsedMs).toISOString();
}

function parseRecord(value: unknown): DeferredFollowUpRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = toString(value.id);
  const gateway = toGatewayProvider(value.gateway);
  const conversationId = toString(value.conversationId);
  const sessionFile = toString(value.sessionFile);
  const prompt = toString(value.prompt);
  const dueAtRaw = toString(value.dueAt);

  if (!id || !gateway || !conversationId || !sessionFile || !prompt || !dueAtRaw) {
    return undefined;
  }

  const dueAt = normalizeTimestamp(dueAtRaw);
  if (!dueAt) {
    return undefined;
  }

  const createdAt = normalizeTimestamp(toString(value.createdAt) ?? dueAt) ?? dueAt;
  const status = toStatus(value.status) ?? 'scheduled';

  return {
    id,
    gateway,
    conversationId,
    sessionFile,
    prompt,
    dueAt,
    createdAt,
    status: status === 'queued' ? 'scheduled' : status,
    queuedAt: undefined,
    attempts: toAttempts(value.attempts),
    initiatedByUserId: toString(value.initiatedByUserId),
    telegramChatType: toTelegramChatType(value.telegramChatType),
  };
}

export function createEmptyDeferredFollowUpState(): DeferredFollowUpStateFile {
  return {
    version: 1,
    followUps: {},
  };
}

export function loadDeferredFollowUpState(
  path: string,
  logger?: { warn: (message: string) => void },
): DeferredFollowUpStateFile {
  if (!existsSync(path)) {
    return createEmptyDeferredFollowUpState();
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed) || !isRecord(parsed.followUps)) {
      return createEmptyDeferredFollowUpState();
    }

    const followUps: Record<string, DeferredFollowUpRecord> = {};

    for (const value of Object.values(parsed.followUps)) {
      const record = parseRecord(value);
      if (!record) {
        continue;
      }

      followUps[record.id] = record;
    }

    return {
      version: 1,
      followUps,
    };
  } catch (error) {
    logger?.warn(`deferred follow-up state load failed at ${path}: ${(error as Error).message}`);
    return createEmptyDeferredFollowUpState();
  }
}

export function saveDeferredFollowUpState(path: string, state: DeferredFollowUpStateFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(state, null, 2));
}
