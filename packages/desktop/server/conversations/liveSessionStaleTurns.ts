import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export interface LiveSessionStaleTurnState {
  pendingHiddenTurnCustomTypes: string[];
  activeHiddenTurnCustomType: string | null;
}

export function createLiveSessionStaleTurnState(): LiveSessionStaleTurnState {
  return {
    pendingHiddenTurnCustomTypes: [],
    activeHiddenTurnCustomType: null,
  };
}

export function ensureStaleTurnState(entry: Partial<LiveSessionStaleTurnState>): asserts entry is LiveSessionStaleTurnState {
  if (!Array.isArray(entry.pendingHiddenTurnCustomTypes)) {
    entry.pendingHiddenTurnCustomTypes = [];
  }
  if (typeof entry.activeHiddenTurnCustomType === 'undefined') {
    entry.activeHiddenTurnCustomType = null;
  }
}

export function hasQueuedOrActiveStaleTurn(entry: Partial<LiveSessionStaleTurnState>): boolean {
  ensureStaleTurnState(entry);
  return false;
}

export function clearQueuedStaleTurn(entry: Partial<LiveSessionStaleTurnState>, _event: Pick<AgentSessionEvent, 'type'>): string | null {
  ensureStaleTurnState(entry);
  entry.pendingHiddenTurnCustomTypes = [];
  entry.activeHiddenTurnCustomType = null;
  return null;
}

export function shouldSuppressLiveEventForStaleTurn(entry: Partial<LiveSessionStaleTurnState>, _event: AgentSessionEvent): boolean {
  ensureStaleTurnState(entry);
  return false;
}

export function clearStaleTurnStateAfterTerminalEvent(entry: Partial<LiveSessionStaleTurnState>, _event: AgentSessionEvent): boolean {
  ensureStaleTurnState(entry);
  if (entry.activeHiddenTurnCustomType || entry.pendingHiddenTurnCustomTypes.length > 0) {
    entry.activeHiddenTurnCustomType = null;
    entry.pendingHiddenTurnCustomTypes = [];
    return true;
  }

  return false;
}
