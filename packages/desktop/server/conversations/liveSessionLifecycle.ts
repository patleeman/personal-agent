export interface LiveSessionLifecycleEvent {
  conversationId: string;
  sessionFile?: string;
  title: string;
  cwd: string;
  trigger: 'turn_end' | 'auto_compaction_end';
}

export type LiveSessionLifecycleHandler = (event: LiveSessionLifecycleEvent) => void | Promise<void>;

let defaultHandlers: Array<LiveSessionLifecycleHandler> | undefined;

/** Set the default lifecycle handlers used for all new sessions. */
/** Register a handler that fires for every new session's lifecycle events.
 *  Handlers are propagated to each LiveEntry at creation time. */
export function registerLiveSessionLifecycleHandler(handler: LiveSessionLifecycleHandler): () => void {
  if (!defaultHandlers) {
    defaultHandlers = [];
  }
  defaultHandlers.push(handler);
  return () => {
    if (!defaultHandlers) return;
    const idx = defaultHandlers.indexOf(handler);
    if (idx >= 0) defaultHandlers.splice(idx, 1);
  };
}

export function setDefaultLifecycleHandlers(handlers: Array<LiveSessionLifecycleHandler>): void {
  defaultHandlers = handlers;
}

export function getDefaultLifecycleHandlers(): Array<LiveSessionLifecycleHandler> {
  return defaultHandlers ?? [];
}

export function notifyLiveSessionLifecycleHandlers(
  event: LiveSessionLifecycleEvent,
  handlers: Array<LiveSessionLifecycleHandler> = [],
): void {
  for (const handler of handlers) {
    Promise.resolve(handler(event)).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[${new Date().toISOString()}] [web] [error] live session lifecycle handler failed conversationId=${event.conversationId} trigger=${event.trigger} message=${message}`,
      );
    });
  }
}
