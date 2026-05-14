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
  ensureHiddenTurnState(entry);
  return false;
}

export function activateNextHiddenTurn(entry: Partial<LiveSessionHiddenTurnState>, _event: Pick<AgentSessionEvent, 'type'>): string | null {
  ensureHiddenTurnState(entry);
  entry.pendingHiddenTurnCustomTypes = [];
  entry.activeHiddenTurnCustomType = null;
  return null;
}

export function shouldSuppressLiveEventForHiddenTurn(entry: Partial<LiveSessionHiddenTurnState>, _event: AgentSessionEvent): boolean {
  ensureHiddenTurnState(entry);
  return false;
}

export function clearActiveHiddenTurnAfterTerminalEvent(entry: Partial<LiveSessionHiddenTurnState>, _event: AgentSessionEvent): boolean {
  ensureHiddenTurnState(entry);
  if (entry.activeHiddenTurnCustomType || entry.pendingHiddenTurnCustomTypes.length > 0) {
    entry.activeHiddenTurnCustomType = null;
    entry.pendingHiddenTurnCustomTypes = [];
    return true;
  }

  return false;
}
