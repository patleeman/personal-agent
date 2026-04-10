import { DESKTOP_APP_EVENTS_EVENT, getDesktopBridge } from './desktopBridge';
import type { DesktopAppEvent } from './types';

interface DesktopAppEventsEnvelope {
  subscriptionId: string;
  event:
    | { type: 'open' }
    | { type: 'event'; event: DesktopAppEvent }
    | { type: 'error'; message: string }
    | { type: 'close' };
}

export interface DesktopAppEventsListener {
  onopen?: () => void;
  onevent?: (event: DesktopAppEvent) => void;
  onerror?: () => void;
  onclose?: () => void;
}

export async function subscribeDesktopAppEvents(listener: DesktopAppEventsListener): Promise<() => void> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error('Desktop app events require the desktop bridge.');
  }

  let subscriptionId: string | null = null;
  let closed = false;

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<DesktopAppEventsEnvelope>;
    const detail = customEvent.detail;
    if (!detail || detail.subscriptionId !== subscriptionId) {
      return;
    }

    switch (detail.event.type) {
      case 'open':
        listener.onopen?.();
        return;
      case 'event':
        listener.onevent?.(detail.event.event);
        return;
      case 'error':
        listener.onerror?.();
        return;
      case 'close':
        listener.onclose?.();
        return;
    }
  };

  window.addEventListener(DESKTOP_APP_EVENTS_EVENT, handleEvent as EventListener);

  try {
    const result = await bridge.subscribeAppEvents();
    if (closed) {
      void bridge.unsubscribeAppEvents(result.subscriptionId).catch(() => {
        // Ignore best-effort teardown failures after early close.
      });
      return () => {};
    }

    subscriptionId = result.subscriptionId;
  } catch (error) {
    window.removeEventListener(DESKTOP_APP_EVENTS_EVENT, handleEvent as EventListener);
    throw error;
  }

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    window.removeEventListener(DESKTOP_APP_EVENTS_EVENT, handleEvent as EventListener);
    if (subscriptionId) {
      void bridge.unsubscribeAppEvents(subscriptionId).catch(() => {
        // Ignore best-effort teardown failures.
      });
    }
  };
}
