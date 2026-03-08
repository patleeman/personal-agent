import { randomUUID } from 'crypto';
import { join } from 'path';
import type { DeferredFollowUpsModuleConfig } from '../config.js';
import type { DaemonModule } from './types.js';
import {
  createEmptyDeferredFollowUpState,
  loadDeferredFollowUpState,
  saveDeferredFollowUpState,
  type DeferredFollowUpRecord,
  type DeferredFollowUpStateFile,
} from './deferred-followups-store.js';

const DEFAULT_TICK_INTERVAL_SECONDS = 5;
const DEFAULT_REQUEUE_DELAY_SECONDS = 30;

type GatewayProvider = 'telegram' | 'discord';

interface DeferredFollowUpsModuleState {
  scheduledCount: number;
  queuedCount: number;
  publishedDueCount: number;
  deliveredCount: number;
  requeuedCount: number;
  lastTickAt?: string;
  lastError?: string;
}

export interface DeferredFollowUpsModuleDependencies {
  now?: () => Date;
  createId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toGatewayProvider(value: unknown): GatewayProvider | undefined {
  if (value === 'telegram' || value === 'discord') {
    return value;
  }

  return undefined;
}

function toTelegramChatType(value: unknown): DeferredFollowUpRecord['telegramChatType'] | undefined {
  if (value === 'private' || value === 'group' || value === 'supergroup' || value === 'channel') {
    return value;
  }

  return undefined;
}

function toOptionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      return undefined;
    }

    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function normalizeIsoTimestamp(value: string): string | undefined {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return undefined;
  }

  return new Date(parsedMs).toISOString();
}

function parseScheduleEventPayload(
  payload: Record<string, unknown>,
  createId: () => string,
  nowIso: string,
): DeferredFollowUpRecord | undefined {
  const gateway = toGatewayProvider(payload.gateway);
  const conversationId = toString(payload.conversationId);
  const sessionFile = toString(payload.sessionFile);
  const prompt = toString(payload.prompt);
  const dueAtRaw = toString(payload.dueAt);

  if (!gateway || !conversationId || !sessionFile || !prompt || !dueAtRaw) {
    return undefined;
  }

  const dueAt = normalizeIsoTimestamp(dueAtRaw);
  if (!dueAt) {
    return undefined;
  }

  const id = toString(payload.id) ?? createId();
  const createdAt = normalizeIsoTimestamp(toString(payload.createdAt) ?? nowIso) ?? nowIso;

  return {
    id,
    gateway,
    conversationId,
    sessionFile,
    prompt,
    dueAt,
    createdAt,
    status: 'scheduled',
    attempts: 0,
    initiatedByUserId: toString(payload.initiatedByUserId),
    telegramChatType: toTelegramChatType(payload.telegramChatType),
  };
}

export function createDeferredFollowUpsModule(
  config: DeferredFollowUpsModuleConfig = {
    enabled: true,
    tickIntervalSeconds: DEFAULT_TICK_INTERVAL_SECONDS,
    requeueDelaySeconds: DEFAULT_REQUEUE_DELAY_SECONDS,
  },
  dependencies: DeferredFollowUpsModuleDependencies = {},
): DaemonModule {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? (() => `deferred_${randomUUID()}`);

  const tickIntervalSeconds = Math.max(1, Math.floor(config.tickIntervalSeconds));
  const requeueDelaySeconds = Math.max(1, Math.floor(config.requeueDelaySeconds));

  const state: DeferredFollowUpsModuleState = {
    scheduledCount: 0,
    queuedCount: 0,
    publishedDueCount: 0,
    deliveredCount: 0,
    requeuedCount: 0,
  };

  let stateFile = '';
  let store: DeferredFollowUpStateFile = createEmptyDeferredFollowUpState();
  let stopping = false;
  let tickInProgress = false;

  const persistState = (logger: { warn: (message: string) => void }): void => {
    if (!stateFile) {
      return;
    }

    try {
      saveDeferredFollowUpState(stateFile, store);
    } catch (error) {
      const message = (error as Error).message;
      state.lastError = message;
      logger.warn(`deferred follow-up state save failed: ${message}`);
    }
  };

  const syncCounts = (): void => {
    let scheduledCount = 0;
    let queuedCount = 0;

    for (const record of Object.values(store.followUps)) {
      if (record.status === 'queued') {
        queuedCount += 1;
      } else {
        scheduledCount += 1;
      }
    }

    state.scheduledCount = scheduledCount;
    state.queuedCount = queuedCount;
  };

  const runTick = async (
    context: {
      logger: { warn: (message: string) => void };
      publish: (type: string, payload?: Record<string, unknown>) => boolean;
    },
  ): Promise<void> => {
    if (stopping || tickInProgress) {
      return;
    }

    tickInProgress = true;

    try {
      const tickTime = now();
      const tickMs = tickTime.getTime();
      const tickIso = tickTime.toISOString();

      state.lastTickAt = tickIso;
      state.lastError = undefined;

      const dueRecords = Object.values(store.followUps)
        .filter((record) => record.status === 'scheduled' && Date.parse(record.dueAt) <= tickMs)
        .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));

      let changed = false;

      for (const record of dueRecords) {
        const accepted = context.publish('gateway.deferred-followup.ready', {
          id: record.id,
          gateway: record.gateway,
          conversationId: record.conversationId,
          sessionFile: record.sessionFile,
          prompt: record.prompt,
          dueAt: record.dueAt,
          createdAt: record.createdAt,
          initiatedByUserId: record.initiatedByUserId,
          telegramChatType: record.telegramChatType,
        });

        if (!accepted) {
          state.lastError = 'event queue is full';
          context.logger.warn(`failed to enqueue deferred follow-up id=${record.id}: event queue is full`);
          break;
        }

        record.status = 'queued';
        record.queuedAt = tickIso;
        record.attempts += 1;
        state.publishedDueCount += 1;
        changed = true;
      }

      if (changed) {
        syncCounts();
        persistState(context.logger);
      }
    } catch (error) {
      const message = (error as Error).message;
      state.lastError = message;
      context.logger.warn(`deferred follow-up tick failed: ${message}`);
    } finally {
      tickInProgress = false;
    }
  };

  return {
    name: 'deferred-followups',
    enabled: config.enabled,
    subscriptions: [
      'timer.deferred-followups.tick',
      'gateway.deferred-followup.schedule',
      'gateway.deferred-followup.delivered',
      'gateway.deferred-followup.requeue',
    ],
    timers: [
      {
        name: 'deferred-followups-tick',
        eventType: 'timer.deferred-followups.tick',
        intervalMs: tickIntervalSeconds * 1000,
      },
    ],

    async start(context): Promise<void> {
      stopping = false;
      stateFile = join(context.paths.root, 'deferred-followups-state.json');
      store = loadDeferredFollowUpState(stateFile, context.logger);
      syncCounts();
      persistState(context.logger);
      await runTick(context);
    },

    async handleEvent(event, context): Promise<void> {
      if (event.type === 'timer.deferred-followups.tick') {
        await runTick(context);
        return;
      }

      if (!isRecord(event.payload)) {
        return;
      }

      if (event.type === 'gateway.deferred-followup.schedule') {
        const record = parseScheduleEventPayload(event.payload, createId, now().toISOString());
        if (!record) {
          context.logger.warn('ignored invalid gateway.deferred-followup.schedule payload');
          return;
        }

        store.followUps[record.id] = record;
        syncCounts();
        persistState(context.logger);
        return;
      }

      if (event.type === 'gateway.deferred-followup.delivered') {
        const id = toString(event.payload.id);
        if (!id) {
          context.logger.warn('ignored gateway.deferred-followup.delivered with missing id');
          return;
        }

        if (!(id in store.followUps)) {
          return;
        }

        delete store.followUps[id];
        state.deliveredCount += 1;
        syncCounts();
        persistState(context.logger);
        return;
      }

      if (event.type === 'gateway.deferred-followup.requeue') {
        const id = toString(event.payload.id);
        if (!id) {
          context.logger.warn('ignored gateway.deferred-followup.requeue with missing id');
          return;
        }

        const record = store.followUps[id];
        if (!record) {
          return;
        }

        const explicitDueAtRaw = toString(event.payload.dueAt);
        const explicitDueAt = explicitDueAtRaw ? normalizeIsoTimestamp(explicitDueAtRaw) : undefined;
        const delaySeconds = toOptionalPositiveInteger(event.payload.delaySeconds) ?? requeueDelaySeconds;

        record.status = 'scheduled';
        record.queuedAt = undefined;
        record.dueAt = explicitDueAt ?? new Date(now().getTime() + delaySeconds * 1000).toISOString();
        state.requeuedCount += 1;

        syncCounts();
        persistState(context.logger);
      }
    },

    async stop(context): Promise<void> {
      stopping = true;
      persistState(context.logger);
    },

    getStatus(): Record<string, unknown> {
      return {
        stateFile,
        tickIntervalSeconds,
        requeueDelaySeconds,
        scheduledCount: state.scheduledCount,
        queuedCount: state.queuedCount,
        publishedDueCount: state.publishedDueCount,
        deliveredCount: state.deliveredCount,
        requeuedCount: state.requeuedCount,
        lastTickAt: state.lastTickAt,
        lastError: state.lastError,
      };
    },
  };
}
