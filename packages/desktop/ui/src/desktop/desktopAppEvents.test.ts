import { beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeDesktopAppEvents } from './desktopAppEvents';
import { DESKTOP_APP_EVENTS_EVENT } from './desktopBridge';

describe('subscribeDesktopAppEvents', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('subscribes through the desktop bridge and forwards matching events', async () => {
    const subscribeAppEvents = vi.fn().mockResolvedValue({ subscriptionId: 'sub-1' });
    const unsubscribeAppEvents = vi.fn().mockResolvedValue(undefined);
    const eventTarget = new EventTarget();
    const fakeWindow = {
      personalAgentDesktop: {
        subscribeAppEvents,
        unsubscribeAppEvents,
      },
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    } as unknown as Window & typeof globalThis;

    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal(
      'CustomEvent',
      class CustomEvent<T = unknown> extends Event {
        readonly detail: T;

        constructor(type: string, init?: { detail?: T }) {
          super(type);
          this.detail = init?.detail as T;
        }
      },
    );

    const onopen = vi.fn();
    const onevent = vi.fn();
    const onerror = vi.fn();
    const onclose = vi.fn();

    const unsubscribe = await subscribeDesktopAppEvents({ onopen, onevent, onerror, onclose });

    fakeWindow.dispatchEvent(
      new CustomEvent(DESKTOP_APP_EVENTS_EVENT, {
        detail: { subscriptionId: 'other', event: { type: 'open' } },
      }),
    );
    fakeWindow.dispatchEvent(
      new CustomEvent(DESKTOP_APP_EVENTS_EVENT, {
        detail: { subscriptionId: 'sub-1', event: { type: 'open' } },
      }),
    );
    fakeWindow.dispatchEvent(
      new CustomEvent(DESKTOP_APP_EVENTS_EVENT, {
        detail: { subscriptionId: 'sub-1', event: { type: 'event', event: { type: 'sessions', sessions: [] } } },
      }),
    );
    fakeWindow.dispatchEvent(
      new CustomEvent(DESKTOP_APP_EVENTS_EVENT, {
        detail: { subscriptionId: 'sub-1', event: { type: 'error', message: 'boom' } },
      }),
    );
    fakeWindow.dispatchEvent(
      new CustomEvent(DESKTOP_APP_EVENTS_EVENT, {
        detail: { subscriptionId: 'sub-1', event: { type: 'close' } },
      }),
    );

    expect(subscribeAppEvents).toHaveBeenCalledTimes(1);
    expect(onopen).toHaveBeenCalledTimes(1);
    expect(onevent).toHaveBeenCalledWith({ type: 'sessions', sessions: [] });
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(unsubscribeAppEvents).toHaveBeenCalledWith('sub-1');
  });

  it('replays matching desktop app events that arrive before subscribeAppEvents resolves', async () => {
    const eventTarget = new EventTarget();
    const unsubscribeAppEvents = vi.fn().mockResolvedValue(undefined);
    const fakeWindow = {
      personalAgentDesktop: {
        subscribeAppEvents: vi.fn().mockImplementation(async () => {
          fakeWindow.dispatchEvent(
            new CustomEvent(DESKTOP_APP_EVENTS_EVENT, {
              detail: { subscriptionId: 'sub-early', event: { type: 'open' } },
            }),
          );
          fakeWindow.dispatchEvent(
            new CustomEvent(DESKTOP_APP_EVENTS_EVENT, {
              detail: { subscriptionId: 'sub-early', event: { type: 'event', event: { type: 'sessions', sessions: [] } } },
            }),
          );
          return { subscriptionId: 'sub-early' };
        }),
        unsubscribeAppEvents,
      },
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    } as unknown as Window & typeof globalThis;

    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal(
      'CustomEvent',
      class CustomEvent<T = unknown> extends Event {
        readonly detail: T;

        constructor(type: string, init?: { detail?: T }) {
          super(type);
          this.detail = init?.detail as T;
        }
      },
    );

    const onopen = vi.fn();
    const onevent = vi.fn();

    const unsubscribe = await subscribeDesktopAppEvents({ onopen, onevent });

    expect(onopen).toHaveBeenCalledTimes(1);
    expect(onevent).toHaveBeenCalledWith({ type: 'sessions', sessions: [] });

    unsubscribe();
    expect(unsubscribeAppEvents).toHaveBeenCalledWith('sub-early');
  });
});
