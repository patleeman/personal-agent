import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export interface LiveSessionHiddenTurnState {
  pendingHiddenTurnCustomTypes: string[];
  activeHiddenTurnCustomType: string | null;
}

export function createLiveSessionHiddenTurnState(): LiveSessionHiddenTurnState {
  return {
    pendingHiddenTurnCustomTypes: [],
    activeHiddenTurnCustomType: null,
  };
}

export function ensureHiddenTurnState(entry: Partial<LiveSessionHiddenTurnState>): asserts entry is LiveSessionHiddenTurnState {
  if (!Array.isArray(entry.pendingHiddenTurnCustomTypes)) {
    entry.pendingHiddenTurnCustomTypes = [];
  }
  if (typeof entry.activeHiddenTurnCustomType === 'undefined') {
    entry.activeHiddenTurnCustomType = null;
  }
}

export function hasQueuedOrActiveHiddenTurn(entry: Partial<LiveSessionHiddenTurnState>): boolean {
  const pendingHiddenTurnCustomTypes = Array.isArray(entry.pendingHiddenTurnCustomTypes) ? entry.pendingHiddenTurnCustomTypes : [];
  return Boolean(entry.activeHiddenTurnCustomType) || pendingHiddenTurnCustomTypes.length > 0;
}

export function activateNextHiddenTurn(entry: Partial<LiveSessionHiddenTurnState>, event: Pick<AgentSessionEvent, 'type'>): string | null {
  ensureHiddenTurnState(entry);
  if (event.type === 'agent_start' && !entry.activeHiddenTurnCustomType && entry.pendingHiddenTurnCustomTypes.length > 0) {
    entry.activeHiddenTurnCustomType = entry.pendingHiddenTurnCustomTypes.shift() ?? null;
  }
  return entry.activeHiddenTurnCustomType;
}

export function shouldSuppressLiveEventForHiddenTurn(entry: Partial<LiveSessionHiddenTurnState>, event: AgentSessionEvent): boolean {
  ensureHiddenTurnState(entry);
  if (!entry.activeHiddenTurnCustomType) {
    return false;
  }

  return (
    event.type === 'agent_start' ||
    event.type === 'agent_end' ||
    event.type === 'turn_end' ||
    event.type === 'message_update' ||
    event.type === 'message_end' ||
    event.type === 'tool_execution_start' ||
    event.type === 'tool_execution_update' ||
    event.type === 'tool_execution_end'
  );
}

function readHiddenCustomMessageType(event: AgentSessionEvent): string | null {
  if (event.type !== 'message_start' && event.type !== 'message_end') {
    return null;
  }
  const message = event.message as unknown;
  if (!message || typeof message !== 'object') {
    return null;
  }
  const record = message as Record<string, unknown>;
  return record.role === 'custom' && record.display === false && typeof record.customType === 'string' ? record.customType : null;
}

export function clearActiveHiddenTurnAfterTerminalEvent(entry: Partial<LiveSessionHiddenTurnState>, event: AgentSessionEvent): boolean {
  ensureHiddenTurnState(entry);
  if ((event.type === 'turn_end' || event.type === 'agent_end') && entry.activeHiddenTurnCustomType) {
    entry.activeHiddenTurnCustomType = null;
    return true;
  }

  const endedHiddenCustomType = readHiddenCustomMessageType(event);
  if (event.type === 'message_end' && endedHiddenCustomType && endedHiddenCustomType === entry.activeHiddenTurnCustomType) {
    entry.activeHiddenTurnCustomType = null;
    return true;
  }

  return false;
}
