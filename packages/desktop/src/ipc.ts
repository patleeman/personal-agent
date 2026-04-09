import { ipcMain } from 'electron';
import type { HostManager } from './hosts/host-manager.js';
import type { DesktopWindowController } from './window.js';

const CHANNEL_PREFIX = 'personal-agent-desktop';

export function registerDesktopIpc(options: {
  hostManager: HostManager;
  windowController: DesktopWindowController;
  onHostStateChanged?: () => void;
}): void {
  ipcMain.handle(`${CHANNEL_PREFIX}:get-environment`, async () => {
    return options.hostManager.getDesktopEnvironment();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:get-connections`, async () => {
    return options.hostManager.getConnectionsState();
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

  ipcMain.handle(`${CHANNEL_PREFIX}:open-new-conversation`, async () => {
    const url = await options.hostManager.openNewConversation();
    await options.windowController.openAbsoluteUrl(url);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:show-connections`, async () => {
    await options.windowController.openMainWindow('/settings');
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:restart-active-host`, async () => {
    await options.hostManager.restartActiveHost();
    options.onHostStateChanged?.();
  });
}
