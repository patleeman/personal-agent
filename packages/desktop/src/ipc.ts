import { ipcMain } from 'electron';
import type { HostManager } from './hosts/host-manager.js';
import type { DesktopWindowController } from './window.js';

const CHANNEL_PREFIX = 'personal-agent-desktop';
const API_STREAM_CHANNEL = `${CHANNEL_PREFIX}:api-stream`;

export function registerDesktopIpc(options: {
  hostManager: HostManager;
  windowController: DesktopWindowController;
  onHostStateChanged?: () => void;
}): void {
  const streamSubscriptions = new Map<string, () => void>();

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
    const unsubscribe = await options.hostManager.getHostController(hostId).subscribeApiStream(path, (streamEvent) => {
      if (event.sender.isDestroyed()) {
        return;
      }

      event.sender.send(API_STREAM_CHANNEL, {
        subscriptionId,
        event: streamEvent,
      });
    });
    const cleanup = () => {
      unsubscribe();
      streamSubscriptions.delete(subscriptionId);
    };
    streamSubscriptions.set(subscriptionId, cleanup);
    event.sender.once('destroyed', cleanup);
    return { subscriptionId };
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:unsubscribe-api-stream`, async (_event, subscriptionId: string) => {
    streamSubscriptions.get(subscriptionId)?.();
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
