import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DESKTOP_REMOTE_OPERATION_EVENT } from './desktopBridge';
import { subscribeDesktopRemoteOperations } from './desktopRemoteOperations';

describe('subscribeDesktopRemoteOperations', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('subscribes through the desktop bridge and forwards matching events', async () => {
    const subscribeRemoteOperations = vi.fn().mockResolvedValue({ subscriptionId: 'sub-1' });
    const unsubscribeRemoteOperations = vi.fn().mockResolvedValue(undefined);
    const eventTarget = new EventTarget();
    const fakeWindow = {
      personalAgentDesktop: {
        subscribeRemoteOperations,
        unsubscribeRemoteOperations,
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
    const onclose = vi.fn();

    const unsubscribe = await subscribeDesktopRemoteOperations({ onopen, onevent, onclose });

    fakeWindow.dispatchEvent(
      new CustomEvent(DESKTOP_REMOTE_OPERATION_EVENT, {
        detail: { subscriptionId: 'other', event: { type: 'open' } },
      }),
    );
    fakeWindow.dispatchEvent(
      new CustomEvent(DESKTOP_REMOTE_OPERATION_EVENT, {
        detail: { subscriptionId: 'sub-1', event: { type: 'open' } },
      }),
    );
    fakeWindow.dispatchEvent(
      new CustomEvent(DESKTOP_REMOTE_OPERATION_EVENT, {
        detail: {
          subscriptionId: 'sub-1',
          event: {
            type: 'event',
            event: {
              hostId: 'bender',
              hostLabel: 'Bender',
              scope: 'runtime',
              stage: 'launch',
              status: 'running',
              message: 'Starting remote Pi runtime…',
              at: new Date().toISOString(),
            },
          },
        },
      }),
    );
    fakeWindow.dispatchEvent(
      new CustomEvent(DESKTOP_REMOTE_OPERATION_EVENT, {
        detail: { subscriptionId: 'sub-1', event: { type: 'close' } },
      }),
    );

    expect(subscribeRemoteOperations).toHaveBeenCalledTimes(1);
    expect(onopen).toHaveBeenCalledTimes(1);
    expect(onevent).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: 'bender',
        stage: 'launch',
      }),
    );
    expect(onclose).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(unsubscribeRemoteOperations).toHaveBeenCalledWith('sub-1');
  });
});
