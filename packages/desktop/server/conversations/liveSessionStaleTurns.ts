import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export interface LiveSessionStaleTurnState {
  queuedStaleTurnCustomTypes: string[];
  activeStaleTurnCustomType: string | null;
}

export function createLiveSessionStaleTurnState(): LiveSessionStaleTurnState {
  return {
    queuedStaleTurnCustomTypes: [],
    activeStaleTurnCustomType: null,
  };
}

export function ensureStaleTurnState(entry: Partial<LiveSessionStaleTurnState>): asserts entry is LiveSessionStaleTurnState {
  if (!Array.isArray(entry.queuedStaleTurnCustomTypes)) {
    entry.queuedStaleTurnCustomTypes = [];
  }
  if (typeof entry.activeStaleTurnCustomType === 'undefined') {
    entry.activeStaleTurnCustomType = null;
  }
}

export function hasQueuedOrActiveStaleTurn(entry: Partial<LiveSessionStaleTurnState>): boolean {
  ensureStaleTurnState(entry);
  return false;
}

export function clearQueuedStaleTurn(entry: Partial<LiveSessionStaleTurnState>, _event: Pick<AgentSessionEvent, 'type'>): string | null {
  ensureStaleTurnState(entry);
  entry.queuedStaleTurnCustomTypes = [];
  entry.activeStaleTurnCustomType = null;
  return null;
}

export function shouldSuppressLiveEventForStaleTurn(entry: Partial<LiveSessionStaleTurnState>, _event: AgentSessionEvent): boolean {
  ensureStaleTurnState(entry);
  return false;
}

export function clearStaleTurnStateAfterTerminalEvent(entry: Partial<LiveSessionStaleTurnState>, _event: AgentSessionEvent): boolean {
  ensureStaleTurnState(entry);
  if (entry.activeStaleTurnCustomType || entry.queuedStaleTurnCustomTypes.length > 0) {
    entry.activeStaleTurnCustomType = null;
    entry.queuedStaleTurnCustomTypes = [];
    return true;
  }

  return false;
}
