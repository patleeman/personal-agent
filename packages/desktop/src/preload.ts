import { contextBridge, ipcRenderer } from 'electron';

const CHANNEL_PREFIX = 'personal-agent-desktop';
const SHORTCUT_CHANNEL = `${CHANNEL_PREFIX}:shortcut`;
const SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';
const NAVIGATE_CHANNEL = `${CHANNEL_PREFIX}:navigate`;
const NAVIGATE_EVENT = 'personal-agent-desktop-navigate';
const API_STREAM_CHANNEL = `${CHANNEL_PREFIX}:api-stream`;
const API_STREAM_EVENT = 'personal-agent-desktop-api-stream';
const APP_EVENTS_CHANNEL = `${CHANNEL_PREFIX}:app-events`;
const APP_EVENTS_EVENT = 'personal-agent-desktop-app-events';

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
  readConversationBootstrap: (input: {
    conversationId: string;
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-bootstrap`, input),
  createLiveSession: (input: { cwd?: string; model?: string | null; thinkingLevel?: string | null }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:create-live-session`, input),
  resumeLiveSession: (sessionFile: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:resume-live-session`, sessionFile),
  takeOverLiveSession: (input: { conversationId: string; surfaceId: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:take-over-live-session`, input),
  submitLiveSessionPrompt: (input: {
    conversationId: string;
    text?: string;
    behavior?: 'steer' | 'followUp';
    images?: Array<{ data: string; mimeType: string; name?: string }>;
    attachmentRefs?: Array<{ attachmentId: string; revision?: number }>;
    surfaceId?: string;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:submit-live-session-prompt`, input),
  abortLiveSession: (conversationId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:abort-live-session`, conversationId),
  invokeLocalApi: (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:invoke-local-api`, method, path, body),
  subscribeApiStream: (path: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:subscribe-api-stream`, path),
  unsubscribeApiStream: (subscriptionId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:unsubscribe-api-stream`, subscriptionId),
  subscribeAppEvents: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:subscribe-app-events`),
  unsubscribeAppEvents: (subscriptionId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:unsubscribe-app-events`, subscriptionId),
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

function dispatchDesktopEvent<T>(type: string, detail: T): void {
  if (!domGlobals.dispatchEvent || typeof domGlobals.CustomEvent !== 'function') {
    return;
  }

  domGlobals.dispatchEvent(new domGlobals.CustomEvent(type, { detail }));
}

ipcRenderer.on(SHORTCUT_CHANNEL, (_event, action: unknown) => {
  dispatchDesktopEvent(SHORTCUT_EVENT, { action });
});

ipcRenderer.on(NAVIGATE_CHANNEL, (_event, payload: unknown) => {
  dispatchDesktopEvent(NAVIGATE_EVENT, payload);
});

ipcRenderer.on(API_STREAM_CHANNEL, (_event, payload: unknown) => {
  dispatchDesktopEvent(API_STREAM_EVENT, payload);
});

ipcRenderer.on(APP_EVENTS_CHANNEL, (_event, payload: unknown) => {
  dispatchDesktopEvent(APP_EVENTS_EVENT, payload);
});

contextBridge.exposeInMainWorld('personalAgentDesktop', desktopBridge);
