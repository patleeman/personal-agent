interface SessionMetaRefreshScheduler {
  schedule(sessionId: string | null | undefined): void;
  dispose(): void;
}

export function createSessionMetaRefreshScheduler(
  refreshSessionMeta: (sessionId: string) => void | Promise<void>,
  options?: {
    delayMs?: number;
    setTimeoutFn?: typeof globalThis.setTimeout;
    clearTimeoutFn?: typeof globalThis.clearTimeout;
  },
): SessionMetaRefreshScheduler {
  const delayMs = options?.delayMs ?? 180;
  const setTimeoutFn = options?.setTimeoutFn ?? globalThis.setTimeout.bind(globalThis);
  const clearTimeoutFn = options?.clearTimeoutFn ?? globalThis.clearTimeout.bind(globalThis);
  const timers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();

  return {
    schedule(sessionId) {
      const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
      if (!normalizedSessionId) {
        return;
      }

      const existing = timers.get(normalizedSessionId);
      if (existing !== undefined) {
        clearTimeoutFn(existing);
      }

      const timeoutId = setTimeoutFn(() => {
        timers.delete(normalizedSessionId);
        void refreshSessionMeta(normalizedSessionId);
      }, delayMs);
      timers.set(normalizedSessionId, timeoutId);
    },
    dispose() {
      for (const timeoutId of timers.values()) {
        clearTimeoutFn(timeoutId);
      }
      timers.clear();
    },
  };
}
