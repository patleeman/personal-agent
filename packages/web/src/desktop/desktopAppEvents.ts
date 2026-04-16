import { DESKTOP_APP_EVENTS_EVENT, getDesktopBridge } from './desktopBridge';
import type { DesktopAppEvent } from '../types';

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
  const pendingEvents: DesktopAppEventsEnvelope[] = [];

  const forwardEvent = (detail: DesktopAppEventsEnvelope) => {
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

  const replayPendingEvents = () => {
    if (!subscriptionId || pendingEvents.length === 0) {
      pendingEvents.length = 0;
      return;
    }

    const queuedEvents = pendingEvents.splice(0, pendingEvents.length);
    for (const detail of queuedEvents) {
      if (detail.subscriptionId === subscriptionId) {
        forwardEvent(detail);
      }
    }
  };

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<DesktopAppEventsEnvelope>;
    const detail = customEvent.detail;
    if (!detail || closed) {
      return;
    }

    if (!subscriptionId) {
      pendingEvents.push(detail);
      return;
    }

    if (detail.subscriptionId !== subscriptionId) {
      return;
    }

    forwardEvent(detail);
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
    replayPendingEvents();
  } catch (error) {
    window.removeEventListener(DESKTOP_APP_EVENTS_EVENT, handleEvent as EventListener);
    pendingEvents.length = 0;
    throw error;
  }

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    pendingEvents.length = 0;
    window.removeEventListener(DESKTOP_APP_EVENTS_EVENT, handleEvent as EventListener);
    if (subscriptionId) {
      void bridge.unsubscribeAppEvents(subscriptionId).catch(() => {
        // Ignore best-effort teardown failures.
      });
    }
  };
}
