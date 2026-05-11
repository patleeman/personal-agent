import type { DaemonEvent, DaemonQueueStatus } from './types.js';
type EventHandler = (event: DaemonEvent) => Promise<void> | void;
interface EventBusOptions {
    maxDepth: number;
    onHandlerError?: (event: DaemonEvent, error: Error) => void;
}
export declare class EventBus {
    private readonly subscribers;
    private readonly queue;
    private readonly maxDepth;
    private readonly onHandlerError?;
    private processing;
    private droppedEvents;
    private processedEvents;
    private lastEventAt?;
    constructor(options: EventBusOptions);
    subscribe(type: string, handler: EventHandler): void;
    publish(event: DaemonEvent): boolean;
    getStatus(): DaemonQueueStatus;
    waitForIdle(): Promise<void>;
    private processQueue;
}
export {};
