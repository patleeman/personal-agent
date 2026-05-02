export interface LiveSessionLifecycleEvent {
  conversationId: string;
  sessionFile?: string;
  title: string;
  cwd: string;
  trigger: 'turn_end' | 'auto_compaction_end';
}

export type LiveSessionLifecycleHandler = (event: LiveSessionLifecycleEvent) => void | Promise<void>;

const lifecycleHandlers = new Set<LiveSessionLifecycleHandler>();

export function registerLiveSessionLifecycleHandler(handler: LiveSessionLifecycleHandler): () => void {
  lifecycleHandlers.add(handler);
  return () => lifecycleHandlers.delete(handler);
}

export function notifyLiveSessionLifecycleHandlers(event: LiveSessionLifecycleEvent): void {
  for (const handler of lifecycleHandlers) {
    Promise.resolve(handler(event)).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[${new Date().toISOString()}] [web] [error] live session lifecycle handler failed conversationId=${event.conversationId} trigger=${event.trigger} message=${message}`,
      );
    });
  }
}
