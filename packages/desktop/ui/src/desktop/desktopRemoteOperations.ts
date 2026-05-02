import type { DesktopRemoteOperationStatus } from '../shared/types';
import { DESKTOP_REMOTE_OPERATION_EVENT, type DesktopRemoteOperationEnvelope, getDesktopBridge } from './desktopBridge';

interface DesktopRemoteOperationsListener {
  onopen?: () => void;
  onevent?: (event: DesktopRemoteOperationStatus) => void;
  onclose?: () => void;
}

export async function subscribeDesktopRemoteOperations(listener: DesktopRemoteOperationsListener): Promise<() => void> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error('Desktop remote operation events require the desktop bridge.');
  }

  let subscriptionId: string | null = null;
  let closed = false;
  const pendingEvents: DesktopRemoteOperationEnvelope[] = [];

  const forwardEvent = (detail: DesktopRemoteOperationEnvelope) => {
    switch (detail.event.type) {
      case 'open':
        listener.onopen?.();
        return;
      case 'event':
        if (detail.event.event) {
          listener.onevent?.(detail.event.event);
        }
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
    const customEvent = event as CustomEvent<DesktopRemoteOperationEnvelope>;
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

  window.addEventListener(DESKTOP_REMOTE_OPERATION_EVENT, handleEvent as EventListener);

  try {
    const result = await bridge.subscribeRemoteOperations();
    if (closed) {
      void bridge.unsubscribeRemoteOperations(result.subscriptionId).catch(() => {
        // Ignore best-effort teardown failures after early close.
      });
      return () => {};
    }

    subscriptionId = result.subscriptionId;
    replayPendingEvents();
  } catch (error) {
    window.removeEventListener(DESKTOP_REMOTE_OPERATION_EVENT, handleEvent as EventListener);
    pendingEvents.length = 0;
    throw error;
  }

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    pendingEvents.length = 0;
    window.removeEventListener(DESKTOP_REMOTE_OPERATION_EVENT, handleEvent as EventListener);
    if (subscriptionId) {
      void bridge.unsubscribeRemoteOperations(subscriptionId).catch(() => {
        // Ignore best-effort teardown failures.
      });
    }
  };
}
