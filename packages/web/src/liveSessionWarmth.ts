import { useSyncExternalStore } from 'react';
import type { StreamState } from './hooks/useSessionStream';

const MAX_WARM_LIVE_SESSION_STATES = 24;

const warmLiveSessionStates = new Map<string, StreamState>();
const warmLiveSessionListeners = new Map<string, Set<() => void>>();

function normalizeSessionId(sessionId: string | null | undefined): string {
  return typeof sessionId === 'string' ? sessionId.trim() : '';
}

function emitWarmLiveSessionStateChanged(sessionId: string): void {
  const listeners = warmLiveSessionListeners.get(sessionId);
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener();
  }
}

function trimWarmLiveSessionStates(): void {
  while (warmLiveSessionStates.size > MAX_WARM_LIVE_SESSION_STATES) {
    const oldestSessionId = warmLiveSessionStates.keys().next().value;
    if (!oldestSessionId) {
      break;
    }

    warmLiveSessionStates.delete(oldestSessionId);
    emitWarmLiveSessionStateChanged(oldestSessionId);
  }
}

export function listWarmLiveSessionStateIds(): string[] {
  return [...warmLiveSessionStates.keys()];
}

export function readWarmLiveSessionState(sessionId: string | null | undefined): StreamState | null {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  return warmLiveSessionStates.get(normalizedSessionId) ?? null;
}

export function writeWarmLiveSessionState(sessionId: string | null | undefined, state: StreamState): void {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return;
  }

  warmLiveSessionStates.delete(normalizedSessionId);
  warmLiveSessionStates.set(normalizedSessionId, state);
  trimWarmLiveSessionStates();
  emitWarmLiveSessionStateChanged(normalizedSessionId);
}

export function clearWarmLiveSessionState(sessionId: string | null | undefined): void {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return;
  }

  if (!warmLiveSessionStates.delete(normalizedSessionId)) {
    return;
  }

  emitWarmLiveSessionStateChanged(normalizedSessionId);
}

export function subscribeWarmLiveSessionState(
  sessionId: string | null | undefined,
  listener: () => void,
): () => void {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return () => {};
  }

  const listeners = warmLiveSessionListeners.get(normalizedSessionId) ?? new Set<() => void>();
  listeners.add(listener);
  warmLiveSessionListeners.set(normalizedSessionId, listeners);

  return () => {
    const currentListeners = warmLiveSessionListeners.get(normalizedSessionId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      warmLiveSessionListeners.delete(normalizedSessionId);
    }
  };
}

export function useWarmLiveSessionState(sessionId: string | null | undefined): StreamState | null {
  return useSyncExternalStore(
    (onStoreChange) => subscribeWarmLiveSessionState(sessionId, onStoreChange),
    () => readWarmLiveSessionState(sessionId),
    () => null,
  );
}
