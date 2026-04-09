import { contextBridge, ipcRenderer } from 'electron';

const CHANNEL_PREFIX = 'personal-agent-desktop';

const desktopBridge = {
  getEnvironment: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:get-environment`),
  getConnections: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:get-connections`),
  switchHost: (hostId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:switch-host`, hostId),
  saveHost: (host: unknown) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:save-host`, host),
  deleteHost: (hostId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:delete-host`, hostId),
  openNewConversation: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:open-new-conversation`),
  showConnectionsWindow: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:show-connections`),
  restartActiveHost: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:restart-active-host`),
};

contextBridge.exposeInMainWorld('personalAgentDesktop', desktopBridge);
