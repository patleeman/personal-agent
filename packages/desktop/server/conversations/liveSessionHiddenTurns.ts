import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';

import {
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
  CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE,
} from './conversationAutoMode.js';

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

export function shouldExposeHiddenTurnInTranscript(customType: string | null | undefined): boolean {
  return (
    customType === CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE || customType === CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE
  );
}

export function shouldSuppressLiveEventForHiddenTurn(entry: Partial<LiveSessionHiddenTurnState>, event: AgentSessionEvent): boolean {
  ensureHiddenTurnState(entry);
  if (!entry.activeHiddenTurnCustomType) {
    return false;
  }

  if (shouldExposeHiddenTurnInTranscript(entry.activeHiddenTurnCustomType)) {
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

export function clearActiveHiddenTurnAfterTerminalEvent(
  entry: Partial<LiveSessionHiddenTurnState>,
  event: Pick<AgentSessionEvent, 'type'>,
): boolean {
  ensureHiddenTurnState(entry);
  if ((event.type === 'turn_end' || event.type === 'agent_end') && entry.activeHiddenTurnCustomType) {
    entry.activeHiddenTurnCustomType = null;
    return true;
  }

  return false;
}
