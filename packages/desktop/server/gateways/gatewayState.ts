import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type GatewayProviderId = 'telegram' | 'slack_mcp';
export type GatewayStatus = 'needs_config' | 'connected' | 'active' | 'paused' | 'needs_attention';

export interface GatewayConnection {
  id: string;
  provider: GatewayProviderId;
  label: string;
  status: GatewayStatus;
  enabled: boolean;
  statusMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayThreadBinding {
  id: string;
  provider: GatewayProviderId;
  connectionId: string;
  conversationId: string;
  conversationTitle?: string;
  externalChatId?: string;
  externalChatLabel?: string;
  repliesEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayChatTarget {
  id: string;
  provider: GatewayProviderId;
  connectionId: string;
  externalChatId: string;
  externalChatLabel?: string;
  conversationId: string;
  conversationTitle?: string;
  lastExternalMessageId?: string;
  repliesEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayEvent {
  id: string;
  provider: GatewayProviderId;
  conversationId?: string;
  kind: 'inbound' | 'outbound' | 'routing' | 'status' | 'error';
  message: string;
  createdAt: string;
}

export interface GatewayState {
  providers: Array<{ id: GatewayProviderId; label: string; implemented: boolean; configurationLocation: 'settings' }>;
  connections: GatewayConnection[];
  bindings: GatewayThreadBinding[];
  chatTargets: GatewayChatTarget[];
  events: GatewayEvent[];
}

const GATEWAY_STATE_VERSION = 1;
const MAX_GATEWAY_EVENTS = 100;

interface PersistedGatewayState {
  version: number;
  connections: GatewayConnection[];
  bindings: GatewayThreadBinding[];
  chatTargets: GatewayChatTarget[];
  events: GatewayEvent[];
}

const TELEGRAM_PROVIDER: GatewayProviderId = 'telegram';
const SLACK_MCP_PROVIDER: GatewayProviderId = 'slack_mcp';

export function resolveGatewayStateFile(stateRoot: string, profile: string): string {
  return join(stateRoot, 'gateways', `${sanitizeProfileName(profile)}.json`);
}

export function readGatewayState(input: { stateRoot: string; profile: string }): GatewayState {
  const state = readPersistedGatewayState(resolveGatewayStateFile(input.stateRoot, input.profile));
  return toPublicGatewayState(state);
}

export function ensureGatewayConnection(input: { stateRoot: string; profile: string; provider: GatewayProviderId }): GatewayConnection {
  return updateGatewayState(input, (state) => {
    const existing = state.connections.find((connection) => connection.provider === input.provider);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const connection: GatewayConnection = {
      id: `${input.provider}-default`,
      provider: input.provider,
      label: providerLabel(input.provider),
      status: 'needs_config',
      enabled: false,
      createdAt: now,
      updatedAt: now,
    };
    state.connections.push(connection);
    appendGatewayEvent(state, {
      provider: input.provider,
      kind: 'status',
      message: `${connection.label} gateway created`,
    });
    return connection;
  });
}

export function attachGatewayConversation(input: {
  stateRoot: string;
  profile: string;
  provider: GatewayProviderId;
  conversationId: string;
  conversationTitle?: string;
  externalChatId?: string;
  externalChatLabel?: string;
}): GatewayState {
  updateGatewayState(input, (state) => {
    const connection = ensureConnectionInState(state, input.provider);
    const now = new Date().toISOString();
    connection.status = connection.status === 'needs_config' ? 'needs_config' : 'connected';
    connection.updatedAt = now;

    state.bindings = state.bindings.filter((binding) => !(binding.provider === input.provider && binding.connectionId === connection.id));
    state.bindings.push({
      id: `${connection.id}:${input.conversationId}`,
      provider: input.provider,
      connectionId: connection.id,
      conversationId: input.conversationId,
      conversationTitle: input.conversationTitle,
      externalChatId: input.externalChatId,
      externalChatLabel: input.externalChatLabel,
      repliesEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
    if (input.externalChatId) {
      const existingTarget = state.chatTargets.find(
        (target) =>
          target.provider === input.provider && target.connectionId === connection.id && target.externalChatId === input.externalChatId,
      );
      if (existingTarget) {
        existingTarget.externalChatLabel = input.externalChatLabel ?? existingTarget.externalChatLabel;
        existingTarget.conversationId = input.conversationId;
        existingTarget.conversationTitle = input.conversationTitle ?? existingTarget.conversationTitle;
        existingTarget.repliesEnabled = true;
        existingTarget.updatedAt = now;
      } else {
        state.chatTargets.push({
          id: `${connection.id}:chat:${input.externalChatId}`,
          provider: input.provider,
          connectionId: connection.id,
          externalChatId: input.externalChatId,
          externalChatLabel: input.externalChatLabel,
          conversationId: input.conversationId,
          conversationTitle: input.conversationTitle,
          repliesEnabled: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    appendGatewayEvent(state, {
      provider: input.provider,
      conversationId: input.conversationId,
      kind: 'routing',
      message: `${providerLabel(input.provider)} attached to ${input.conversationTitle || input.conversationId}`,
    });
    return connection;
  });
  return readGatewayState(input);
}

export function upsertGatewayChatTarget(input: {
  stateRoot: string;
  profile: string;
  provider: GatewayProviderId;
  externalChatId: string;
  externalChatLabel?: string;
  conversationId: string;
  conversationTitle?: string;
  lastExternalMessageId?: string;
  repliesEnabled?: boolean;
}): GatewayChatTarget {
  return updateGatewayState(input, (state) => {
    const connection = ensureConnectionInState(state, input.provider);
    const now = new Date().toISOString();
    const existing = state.chatTargets.find(
      (target) =>
        target.provider === input.provider && target.connectionId === connection.id && target.externalChatId === input.externalChatId,
    );
    if (existing) {
      existing.externalChatLabel = input.externalChatLabel ?? existing.externalChatLabel;
      existing.conversationId = input.conversationId;
      existing.conversationTitle = input.conversationTitle ?? existing.conversationTitle;
      existing.lastExternalMessageId = input.lastExternalMessageId ?? existing.lastExternalMessageId;
      existing.repliesEnabled = input.repliesEnabled ?? existing.repliesEnabled;
      existing.updatedAt = now;
      return existing;
    }

    const target: GatewayChatTarget = {
      id: `${connection.id}:chat:${input.externalChatId}`,
      provider: input.provider,
      connectionId: connection.id,
      externalChatId: input.externalChatId,
      externalChatLabel: input.externalChatLabel,
      conversationId: input.conversationId,
      conversationTitle: input.conversationTitle,
      lastExternalMessageId: input.lastExternalMessageId,
      repliesEnabled: input.repliesEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    state.chatTargets.push(target);
    return target;
  });
}

export function findGatewayChatTarget(input: {
  stateRoot: string;
  profile: string;
  provider: GatewayProviderId;
  externalChatId: string;
}): GatewayChatTarget | null {
  const state = readPersistedGatewayState(resolveGatewayStateFile(input.stateRoot, input.profile));
  const connection = state.connections.find((candidate) => candidate.provider === input.provider);
  if (!connection) {
    return null;
  }
  return (
    state.chatTargets.find(
      (target) =>
        target.provider === input.provider && target.connectionId === connection.id && target.externalChatId === input.externalChatId,
    ) ?? null
  );
}

export function findGatewayChatTargetByConversation(input: {
  stateRoot: string;
  profile: string;
  provider: GatewayProviderId;
  conversationId: string;
}): GatewayChatTarget | null {
  const state = readPersistedGatewayState(resolveGatewayStateFile(input.stateRoot, input.profile));
  const connection = state.connections.find((candidate) => candidate.provider === input.provider && candidate.enabled);
  if (!connection) {
    return null;
  }

  const attached = state.bindings.some(
    (binding) =>
      binding.provider === input.provider && binding.connectionId === connection.id && binding.conversationId === input.conversationId,
  );
  if (!attached) {
    return null;
  }

  return (
    state.chatTargets.find(
      (target) =>
        target.provider === input.provider &&
        target.connectionId === connection.id &&
        target.conversationId === input.conversationId &&
        target.repliesEnabled,
    ) ?? null
  );
}

export function recordGatewayEvent(input: {
  stateRoot: string;
  profile: string;
  provider: GatewayProviderId;
  conversationId?: string;
  kind: GatewayEvent['kind'];
  message: string;
}): GatewayState {
  updateGatewayState(input, (state) => {
    appendGatewayEvent(state, {
      provider: input.provider,
      conversationId: input.conversationId,
      kind: input.kind,
      message: input.message,
    });
    return null;
  });
  return readGatewayState(input);
}

export function hasGatewayBinding(input: { stateRoot: string; profile: string; provider: GatewayProviderId }): boolean {
  const state = readPersistedGatewayState(resolveGatewayStateFile(input.stateRoot, input.profile));
  const connection = state.connections.find((candidate) => candidate.provider === input.provider);
  return Boolean(
    connection && state.bindings.some((binding) => binding.provider === input.provider && binding.connectionId === connection.id),
  );
}

export function detachGatewayConversation(input: {
  stateRoot: string;
  profile: string;
  provider?: GatewayProviderId;
  conversationId: string;
}): GatewayState {
  updateGatewayState(input, (state) => {
    const removed = state.bindings.filter(
      (binding) => binding.conversationId === input.conversationId && (!input.provider || binding.provider === input.provider),
    );
    if (removed.length === 0) {
      return null;
    }

    state.bindings = state.bindings.filter(
      (binding) => !(binding.conversationId === input.conversationId && (!input.provider || binding.provider === input.provider)),
    );
    state.chatTargets = state.chatTargets.map((target) =>
      target.conversationId === input.conversationId && (!input.provider || target.provider === input.provider)
        ? { ...target, repliesEnabled: false, updatedAt: new Date().toISOString() }
        : target,
    );
    for (const binding of removed) {
      appendGatewayEvent(state, {
        provider: binding.provider,
        conversationId: binding.conversationId,
        kind: 'routing',
        message: `${providerLabel(binding.provider)} detached from ${binding.conversationTitle || binding.conversationId}`,
      });
    }
    return null;
  });
  return readGatewayState({ stateRoot: input.stateRoot, profile: input.profile });
}

export function detachArchivedGatewayConversations(input: { stateRoot: string; profile: string; conversationIds: string[] }): GatewayState {
  const ids = new Set(input.conversationIds.map((id) => id.trim()).filter(Boolean));
  if (ids.size === 0) {
    return readGatewayState(input);
  }

  updateGatewayState(input, (state) => {
    const removed = state.bindings.filter((binding) => ids.has(binding.conversationId));
    if (removed.length === 0) {
      return null;
    }

    state.bindings = state.bindings.filter((binding) => !ids.has(binding.conversationId));
    state.chatTargets = state.chatTargets.map((target) =>
      ids.has(target.conversationId) ? { ...target, repliesEnabled: false, updatedAt: new Date().toISOString() } : target,
    );
    for (const binding of removed) {
      appendGatewayEvent(state, {
        provider: binding.provider,
        conversationId: binding.conversationId,
        kind: 'routing',
        message: `${providerLabel(binding.provider)} detached because the thread was archived`,
      });
    }
    return null;
  });
  return readGatewayState(input);
}

export function updateGatewayConnectionStatus(input: {
  stateRoot: string;
  profile: string;
  provider: GatewayProviderId;
  status: GatewayStatus;
  enabled?: boolean;
  statusMessage?: string;
}): GatewayState {
  updateGatewayState(input, (state) => {
    const connection = ensureConnectionInState(state, input.provider);
    connection.status = input.status;
    connection.enabled = input.enabled ?? connection.enabled;
    connection.statusMessage = input.statusMessage;
    connection.updatedAt = new Date().toISOString();
    appendGatewayEvent(state, {
      provider: input.provider,
      kind: input.status === 'needs_attention' ? 'error' : 'status',
      message: input.statusMessage || `${connection.label} is ${input.status.replace(/_/g, ' ')}`,
    });
    return connection;
  });
  return readGatewayState(input);
}

function readPersistedGatewayState(file: string): PersistedGatewayState {
  if (!existsSync(file)) {
    return createDefaultGatewayState();
  }

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<PersistedGatewayState>;
    return {
      version: GATEWAY_STATE_VERSION,
      connections: Array.isArray(parsed.connections) ? parsed.connections.filter(isGatewayConnection) : [],
      bindings: Array.isArray(parsed.bindings) ? parsed.bindings.filter(isGatewayThreadBinding) : [],
      chatTargets: Array.isArray(parsed.chatTargets) ? parsed.chatTargets.filter(isGatewayChatTarget) : [],
      events: Array.isArray(parsed.events) ? parsed.events.filter(isGatewayEvent).slice(-MAX_GATEWAY_EVENTS) : [],
    };
  } catch {
    return createDefaultGatewayState();
  }
}

function writePersistedGatewayState(file: string, state: PersistedGatewayState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...state, events: state.events.slice(-MAX_GATEWAY_EVENTS) }, null, 2)}\n`, 'utf-8');
}

function updateGatewayState<T>(input: { stateRoot: string; profile: string }, update: (state: PersistedGatewayState) => T): T {
  const file = resolveGatewayStateFile(input.stateRoot, input.profile);
  const state = readPersistedGatewayState(file);
  const result = update(state);
  writePersistedGatewayState(file, state);
  return result;
}

function createDefaultGatewayState(): PersistedGatewayState {
  return { version: GATEWAY_STATE_VERSION, connections: [], bindings: [], chatTargets: [], events: [] };
}

function toPublicGatewayState(state: PersistedGatewayState): GatewayState {
  return {
    providers: [
      {
        id: TELEGRAM_PROVIDER,
        label: 'Telegram',
        implemented: true,
        configurationLocation: 'settings',
      },
      {
        id: SLACK_MCP_PROVIDER,
        label: 'Slack MCP',
        implemented: true,
        configurationLocation: 'settings',
      },
    ],
    connections: state.connections,
    bindings: state.bindings,
    chatTargets: state.chatTargets,
    events: state.events.slice(-MAX_GATEWAY_EVENTS).reverse(),
  };
}

function ensureConnectionInState(state: PersistedGatewayState, provider: GatewayProviderId): GatewayConnection {
  const existing = state.connections.find((connection) => connection.provider === provider);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const connection: GatewayConnection = {
    id: `${provider}-default`,
    provider,
    label: providerLabel(provider),
    status: 'needs_config',
    enabled: false,
    createdAt: now,
    updatedAt: now,
  };
  state.connections.push(connection);
  return connection;
}

function appendGatewayEvent(state: PersistedGatewayState, event: Omit<GatewayEvent, 'id' | 'createdAt'>): void {
  const createdAt = new Date().toISOString();
  state.events.push({
    id: `gateway-event-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    ...event,
  });
  state.events = state.events.slice(-MAX_GATEWAY_EVENTS);
}

function providerLabel(provider: GatewayProviderId): string {
  return provider === 'telegram' ? 'Telegram' : provider === 'slack_mcp' ? 'Slack MCP' : provider;
}

function isGatewayProviderId(value: unknown): value is GatewayProviderId {
  return value === 'telegram' || value === 'slack_mcp';
}

function sanitizeProfileName(profile: string): string {
  return profile.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'default';
}

function isGatewayConnection(value: unknown): value is GatewayConnection {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as GatewayConnection;
  return typeof candidate.id === 'string' && isGatewayProviderId(candidate.provider) && isGatewayStatus(candidate.status);
}

function isGatewayThreadBinding(value: unknown): value is GatewayThreadBinding {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as GatewayThreadBinding;
  return (
    typeof candidate.id === 'string' &&
    isGatewayProviderId(candidate.provider) &&
    typeof candidate.connectionId === 'string' &&
    typeof candidate.conversationId === 'string'
  );
}

function isGatewayChatTarget(value: unknown): value is GatewayChatTarget {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as GatewayChatTarget;
  return (
    typeof candidate.id === 'string' &&
    isGatewayProviderId(candidate.provider) &&
    typeof candidate.connectionId === 'string' &&
    typeof candidate.externalChatId === 'string' &&
    typeof candidate.conversationId === 'string'
  );
}

function isGatewayEvent(value: unknown): value is GatewayEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as GatewayEvent;
  return typeof candidate.id === 'string' && isGatewayProviderId(candidate.provider) && typeof candidate.message === 'string';
}

function isGatewayStatus(value: unknown): value is GatewayStatus {
  return value === 'needs_config' || value === 'connected' || value === 'active' || value === 'paused' || value === 'needs_attention';
}
