import { ipcMain, type WebContents } from 'electron';
import type { HostManager } from './hosts/host-manager.js';
import type { DesktopWindowController } from './window.js';

const CHANNEL_PREFIX = 'personal-agent-desktop';
const API_STREAM_CHANNEL = `${CHANNEL_PREFIX}:api-stream`;
const APP_EVENTS_CHANNEL = `${CHANNEL_PREFIX}:app-events`;

export function registerDesktopIpc(options: {
  hostManager: HostManager;
  windowController: DesktopWindowController;
  onHostStateChanged?: () => void;
}): void {
  const streamSubscriptions = new Map<string, () => void>();
  const appEventSubscriptions = new Map<string, () => void>();

  const sendBufferedSubscriptionEvent = <T>(input: {
    sender: WebContents;
    channel: string;
    subscriptionId: string;
    subscribe: (emit: (event: T) => void) => Promise<() => void>;
    store: Map<string, () => void>;
  }): Promise<void> => (async () => {
    const pendingEvents: T[] = [];
    let deliveryEnabled = false;
    let active = true;

    const deliver = (nextEvent: T) => {
      if (!active || input.sender.isDestroyed()) {
        return;
      }

      if (!deliveryEnabled) {
        pendingEvents.push(nextEvent);
        return;
      }

      input.sender.send(input.channel, {
        subscriptionId: input.subscriptionId,
        event: nextEvent,
      });
    };

    const unsubscribe = await input.subscribe(deliver);
    const cleanup = () => {
      if (!active) {
        return;
      }

      active = false;
      unsubscribe();
      input.store.delete(input.subscriptionId);
      pendingEvents.length = 0;
    };

    input.store.set(input.subscriptionId, cleanup);
    input.sender.once('destroyed', cleanup);
    deliveryEnabled = true;
    setImmediate(() => {
      if (!active || input.sender.isDestroyed()) {
        return;
      }

      for (const pendingEvent of pendingEvents) {
        input.sender.send(input.channel, {
          subscriptionId: input.subscriptionId,
          event: pendingEvent,
        });
      }
      pendingEvents.length = 0;
    });
  })();

  ipcMain.handle(`${CHANNEL_PREFIX}:get-environment`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    return options.hostManager.getDesktopEnvironmentForHost(hostId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:get-connections`, async () => {
    return options.hostManager.getConnectionsState();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:get-navigation-state`, async (event) => {
    return options.windowController.getNavigationStateForWebContents(event.sender.id);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:switch-host`, async (_event, hostId: string) => {
    await options.hostManager.switchHost(hostId);
    options.onHostStateChanged?.();
    await options.windowController.openMainWindow('/');
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:save-host`, async (_event, host) => {
    await options.hostManager.saveHost(host);
    options.onHostStateChanged?.();
    return options.hostManager.getConnectionsState();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:delete-host`, async (_event, hostId: string) => {
    await options.hostManager.deleteHost(hostId);
    options.onHostStateChanged?.();
    await options.windowController.openMainWindow('/settings');
    return options.hostManager.getConnectionsState();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:open-new-conversation`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const url = await options.hostManager.openNewConversationForHost(hostId);
    await options.windowController.openAbsoluteUrlInWindow(event.sender.id, url);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:invoke-local-api`, async (event, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    return options.hostManager.getHostController(hostId).invokeLocalApi(method, path, body);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:subscribe-api-stream`, async (event, path: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const subscriptionId = `${event.sender.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    await sendBufferedSubscriptionEvent({
      sender: event.sender,
      channel: API_STREAM_CHANNEL,
      subscriptionId,
      store: streamSubscriptions,
      subscribe: (emit) => options.hostManager.getHostController(hostId).subscribeApiStream(path, emit),
    });
    return { subscriptionId };
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:unsubscribe-api-stream`, async (_event, subscriptionId: string) => {
    streamSubscriptions.get(subscriptionId)?.();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:subscribe-app-events`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.subscribeDesktopAppEvents) {
      throw new Error('Desktop app events are only available for the local host.');
    }

    const subscriptionId = `${event.sender.id}:app:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    await sendBufferedSubscriptionEvent({
      sender: event.sender,
      channel: APP_EVENTS_CHANNEL,
      subscriptionId,
      store: appEventSubscriptions,
      subscribe: (emit) => controller.subscribeDesktopAppEvents!(emit),
    });
    return { subscriptionId };
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:unsubscribe-app-events`, async (_event, subscriptionId: string) => {
    appEventSubscriptions.get(subscriptionId)?.();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:show-connections`, async () => {
    await options.windowController.openMainWindow('/settings#desktop-connections');
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:open-host-window`, async (_event, hostId: string) => {
    await options.windowController.openHostWindow(hostId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:go-back`, async (event) => {
    return options.windowController.goBackForWebContents(event.sender.id);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:go-forward`, async (event) => {
    return options.windowController.goForwardForWebContents(event.sender.id);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:restart-active-host`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    await options.hostManager.restartHost(hostId);
    options.onHostStateChanged?.();
  });
}
