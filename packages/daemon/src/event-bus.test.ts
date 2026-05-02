import { describe, expect, it, vi } from 'vitest';

import { EventBus } from './event-bus.js';
import { createDaemonEvent } from './events.js';

describe('EventBus', () => {
  it('dispatches events to typed and wildcard subscribers', async () => {
    const bus = new EventBus({ maxDepth: 10 });
    const typed = vi.fn(async () => undefined);
    const wildcard = vi.fn(async () => undefined);

    bus.subscribe('session.updated', typed);
    bus.subscribe('*', wildcard);

    const accepted = bus.publish(
      createDaemonEvent({
        type: 'session.updated',
        source: 'test',
        payload: {},
      }),
    );

    expect(accepted).toBe(true);

    await bus.waitForIdle();

    expect(typed).toHaveBeenCalledTimes(1);
    expect(wildcard).toHaveBeenCalledTimes(1);
  });

  it('drops events when queue is full', () => {
    const bus = new EventBus({ maxDepth: 0 });

    const accepted = bus.publish(
      createDaemonEvent({
        type: 'session.updated',
        source: 'test',
        payload: {},
      }),
    );

    expect(accepted).toBe(false);
    expect(bus.getStatus().droppedEvents).toBe(1);
  });
});
