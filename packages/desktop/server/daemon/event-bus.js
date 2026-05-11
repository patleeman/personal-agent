export class EventBus {
    subscribers = new Map();
    queue = [];
    maxDepth;
    onHandlerError;
    processing = false;
    droppedEvents = 0;
    processedEvents = 0;
    lastEventAt;
    constructor(options) {
        this.maxDepth = options.maxDepth;
        this.onHandlerError = options.onHandlerError;
    }
    subscribe(type, handler) {
        const handlers = this.subscribers.get(type) ?? [];
        handlers.push(handler);
        this.subscribers.set(type, handlers);
    }
    publish(event) {
        if (this.queue.length >= this.maxDepth) {
            this.droppedEvents += 1;
            return false;
        }
        this.queue.push(event);
        this.processQueue();
        return true;
    }
    getStatus() {
        return {
            maxDepth: this.maxDepth,
            currentDepth: this.queue.length,
            droppedEvents: this.droppedEvents,
            processedEvents: this.processedEvents,
            lastEventAt: this.lastEventAt,
        };
    }
    async waitForIdle() {
        while (this.processing || this.queue.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
    processQueue() {
        if (this.processing) {
            return;
        }
        this.processing = true;
        void (async () => {
            try {
                while (this.queue.length > 0) {
                    const event = this.queue.shift();
                    const handlers = [...(this.subscribers.get(event.type) ?? []), ...(this.subscribers.get('*') ?? [])];
                    for (const handler of handlers) {
                        try {
                            await handler(event);
                        }
                        catch (error) {
                            this.onHandlerError?.(event, error);
                        }
                    }
                    this.processedEvents += 1;
                    this.lastEventAt = new Date().toISOString();
                }
            }
            finally {
                this.processing = false;
                if (this.queue.length > 0) {
                    this.processQueue();
                }
            }
        })();
    }
}
