import { contextBridge, ipcRenderer } from 'electron';

const CHANNEL_PREFIX = 'personal-agent-desktop';
const SHORTCUT_CHANNEL = `${CHANNEL_PREFIX}:shortcut`;
const SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';

const domGlobals = globalThis as typeof globalThis & {
  document?: {
    documentElement?: {
      dataset: Record<string, string>;
    };
    body?: {
      setAttribute(name: string, value: string): void;
    };
  };
  dispatchEvent?: (event: { type: string }) => boolean;
  CustomEvent?: new <T>(type: string, init?: { detail?: T }) => { type: string; detail?: T };
};

const desktopBridge = {
  getEnvironment: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:get-environment`),
  getConnections: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:get-connections`),
  getNavigationState: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:get-navigation-state`),
  switchHost: (hostId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:switch-host`, hostId),
  saveHost: (host: unknown) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:save-host`, host),
  deleteHost: (hostId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:delete-host`, hostId),
  openNewConversation: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:open-new-conversation`),
  openHostWindow: (hostId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:open-host-window`, hostId),
  showConnectionsWindow: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:show-connections`),
  goBack: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:go-back`),
  goForward: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:go-forward`),
  restartActiveHost: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:restart-active-host`),
};

if (domGlobals.document?.documentElement) {
  domGlobals.document.documentElement.dataset.personalAgentDesktop = '1';
}

if (domGlobals.document?.body) {
  domGlobals.document.body.setAttribute('data-personal-agent-desktop', '1');
}

ipcRenderer.on(SHORTCUT_CHANNEL, (_event, action: unknown) => {
  if (!domGlobals.dispatchEvent || typeof domGlobals.CustomEvent !== 'function') {
    return;
  }

  domGlobals.dispatchEvent(new domGlobals.CustomEvent(SHORTCUT_EVENT, {
    detail: { action },
  }));
});

contextBridge.exposeInMainWorld('personalAgentDesktop', desktopBridge);
