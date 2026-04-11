import { beforeEach, describe, expect, it, vi } from 'vitest';

const DESKTOP_API_STREAM_EVENT = 'personal-agent-desktop-api-stream';

describe('DesktopApiEventSource', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('replays matching desktop API stream events that arrive before the subscription id is available', async () => {
    const eventTarget = new EventTarget();
    const fakeWindow = {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({ activeHostKind: 'local' }),
        subscribeApiStream: vi.fn().mockImplementation(() => new Promise(() => {})),
        unsubscribeApiStream: vi.fn().mockResolvedValue(undefined),
      },
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    } as unknown as Window & typeof globalThis;

    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('CustomEvent', class CustomEvent<T = unknown> extends Event {
      readonly detail: T;

      constructor(type: string, init?: { detail?: T }) {
        super(type);
        this.detail = init?.detail as T;
      }
    });

    const { DesktopApiEventSource } = await import('./desktopEventSource');
    const source = new DesktopApiEventSource('/api/live-sessions/live-1/events');
    const onopen = vi.fn();
    const onmessage = vi.fn();
    source.onopen = onopen;
    source.onmessage = onmessage;

    (source as unknown as { handleDesktopStreamEvent: (event: Event) => void }).handleDesktopStreamEvent(new CustomEvent(DESKTOP_API_STREAM_EVENT, {
      detail: { subscriptionId: 'stream-early', event: { type: 'open' } },
    }));
    (source as unknown as { handleDesktopStreamEvent: (event: Event) => void }).handleDesktopStreamEvent(new CustomEvent(DESKTOP_API_STREAM_EVENT, {
      detail: { subscriptionId: 'stream-early', event: { type: 'message', data: JSON.stringify({ type: 'snapshot', ok: true }) } },
    }));

    expect(onopen).not.toHaveBeenCalled();
    expect(onmessage).not.toHaveBeenCalled();

    (source as unknown as { subscriptionId: string | null }).subscriptionId = 'stream-early';
    (source as unknown as { replayPendingDesktopEvents: () => void }).replayPendingDesktopEvents();

    expect(onopen).toHaveBeenCalledTimes(1);
    expect(onmessage).toHaveBeenCalledTimes(1);
    expect(onmessage.mock.calls[0]?.[0]?.data).toBe(JSON.stringify({ type: 'snapshot', ok: true }));

    source.close();
  });
});
