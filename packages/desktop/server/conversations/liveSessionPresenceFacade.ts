import type { SseEvent } from './liveSessionEvents.js';
import {
  assertLiveSessionSurfaceCanControl,
  buildLiveSessionPresenceState,
  type LiveSessionPresenceHost,
  type LiveSessionPresenceState,
  takeOverLiveSessionSurface,
} from './liveSessionPresence.js';

export interface LiveSessionPresenceFacadeHost extends LiveSessionPresenceHost {
  sessionId: string;
}

export function broadcastLiveSessionPresenceState<TEntry extends LiveSessionPresenceFacadeHost, TListener>(
  entry: TEntry,
  callbacks: {
    broadcast: (entry: TEntry, event: SseEvent, options?: { exclude?: TListener }) => void;
  },
  options?: { exclude?: TListener },
): void {
  callbacks.broadcast(entry, { type: 'presence_state', state: buildLiveSessionPresenceState(entry) }, options);
}

export function ensureLiveSessionSurfaceCanControl(entry: LiveSessionPresenceFacadeHost, surfaceId?: string): void {
  assertLiveSessionSurfaceCanControl(entry, surfaceId);
}

export function takeOverLiveSessionControl<TEntry extends LiveSessionPresenceFacadeHost>(
  entry: TEntry,
  surfaceId: string,
  callbacks: {
    broadcastPresenceState: (entry: TEntry) => void;
  },
): LiveSessionPresenceState {
  const takeover = takeOverLiveSessionSurface(entry, surfaceId);
  if (takeover.changed) {
    callbacks.broadcastPresenceState(entry);
  }

  return takeover.state;
}
