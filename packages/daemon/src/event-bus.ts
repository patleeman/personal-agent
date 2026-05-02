import type { DaemonEvent, DaemonQueueStatus } from './types.js';

export type EventHandler = (event: DaemonEvent) => Promise<void> | void;

interface EventBusOptions {
  maxDepth: number;
  onHandlerError?: (event: DaemonEvent, error: Error) => void;
}

export class EventBus {
  private readonly subscribers = new Map<string, EventHandler[]>();
  private readonly queue: DaemonEvent[] = [];
  private readonly maxDepth: number;
  private readonly onHandlerError?: (event: DaemonEvent, error: Error) => void;

  private processing = false;
  private droppedEvents = 0;
  private processedEvents = 0;
  private lastEventAt?: string;

  constructor(options: EventBusOptions) {
    this.maxDepth = options.maxDepth;
    this.onHandlerError = options.onHandlerError;
  }

  subscribe(type: string, handler: EventHandler): void {
    const handlers = this.subscribers.get(type) ?? [];
    handlers.push(handler);
    this.subscribers.set(type, handlers);
  }

  publish(event: DaemonEvent): boolean {
    if (this.queue.length >= this.maxDepth) {
      this.droppedEvents += 1;
      return false;
    }

    this.queue.push(event);
    this.processQueue();
    return true;
  }

  getStatus(): DaemonQueueStatus {
    return {
      maxDepth: this.maxDepth,
      currentDepth: this.queue.length,
      droppedEvents: this.droppedEvents,
      processedEvents: this.processedEvents,
      lastEventAt: this.lastEventAt,
    };
  }

  async waitForIdle(): Promise<void> {
    while (this.processing || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private processQueue(): void {
    if (this.processing) {
      return;
    }

    this.processing = true;

    void (async () => {
      try {
        while (this.queue.length > 0) {
          const event = this.queue.shift() as DaemonEvent;
          const handlers = [...(this.subscribers.get(event.type) ?? []), ...(this.subscribers.get('*') ?? [])];

          for (const handler of handlers) {
            try {
              await handler(event);
            } catch (error) {
              this.onHandlerError?.(event, error as Error);
            }
          }

          this.processedEvents += 1;
          this.lastEventAt = new Date().toISOString();
        }
      } finally {
        this.processing = false;

        if (this.queue.length > 0) {
          this.processQueue();
        }
      }
    })();
  }
}
