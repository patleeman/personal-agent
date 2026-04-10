export type DesktopHostRecord =
  | {
      id: string;
      label: string;
      kind: 'local';
    }
  | {
      id: string;
      label: string;
      kind: 'ssh';
      sshTarget: string;
      remoteRepoRoot?: string;
      remotePort?: number;
      autoConnect?: boolean;
    }
  | {
      id: string;
      label: string;
      kind: 'web';
      baseUrl: string;
      autoConnect?: boolean;
    };

export interface DesktopConfig {
  version: 1;
  defaultHostId: string;
  openWindowOnLaunch: boolean;
  windowState?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
  updates?: {
    dismissedVersion?: string;
  };
  hosts: DesktopHostRecord[];
}

export interface HostStatus {
  reachable: boolean;
  mode: 'local-child-process' | 'ssh-tunnel' | 'web-remote';
  summary: string;
  webUrl?: string;
  daemonHealthy?: boolean;
  webHealthy?: boolean;
  lastError?: string;
}

export interface DesktopApiStreamEvent {
  type: 'open' | 'message' | 'error' | 'close';
  data?: string;
  message?: string;
}

export interface DesktopAppBridgeEvent {
  type: 'open' | 'event' | 'error' | 'close';
  event?: unknown;
  message?: string;
}

export interface DesktopConversationBootstrapRequest {
  conversationId: string;
  tailBlocks?: number;
  knownSessionSignature?: string;
  knownBlockOffset?: number;
  knownTotalBlocks?: number;
  knownLastBlockId?: string;
}

export interface DesktopConversationRenameRequest {
  conversationId: string;
  name: string;
  surfaceId?: string;
}

export interface DesktopSessionDetailRequest {
  sessionId: string;
  tailBlocks?: number;
  knownSessionSignature?: string;
  knownBlockOffset?: number;
  knownTotalBlocks?: number;
  knownLastBlockId?: string;
}

export interface DesktopSessionBlockRequest {
  sessionId: string;
  blockId: string;
}

export interface DesktopLiveSessionCreateRequest {
  cwd?: string;
  model?: string | null;
  thinkingLevel?: string | null;
}

export interface DesktopLiveSessionTakeoverRequest {
  conversationId: string;
  surfaceId: string;
}

export interface DesktopLiveSessionPromptRequest {
  conversationId: string;
  text?: string;
  behavior?: 'steer' | 'followUp';
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  attachmentRefs?: Array<{ attachmentId: string; revision?: number }>;
  surfaceId?: string;
}

export interface DesktopLiveSessionPromptResult {
  ok: true;
  accepted: true;
  delivery: 'started' | 'queued';
  referencedTaskIds: string[];
  referencedMemoryDocIds: string[];
  referencedVaultFileIds: string[];
  referencedAttachmentIds: string[];
}

export interface DesktopLiveSessionQueueRestoreRequest {
  conversationId: string;
  behavior: 'steer' | 'followUp';
  index: number;
  previewId?: string;
}

export interface DesktopLiveSessionQueueRestoreResult {
  ok: true;
  text: string;
  images: Array<{ type: 'image'; data: string; mimeType: string; name?: string }>;
}

export interface DesktopLiveSessionCompactRequest {
  conversationId: string;
  customInstructions?: string;
}

export interface DesktopLiveSessionBranchRequest {
  conversationId: string;
  entryId: string;
}

export interface DesktopLiveSessionForkRequest {
  conversationId: string;
  entryId: string;
  preserveSource?: boolean;
}

export interface HostController {
  readonly id: string;
  readonly label: string;
  readonly kind: DesktopHostRecord['kind'];
  ensureRunning(): Promise<void>;
  getBaseUrl(): Promise<string>;
  getStatus(): Promise<HostStatus>;
  openNewConversation(): Promise<string>;
  invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown>;
  readConversationBootstrap?(input: DesktopConversationBootstrapRequest): Promise<unknown>;
  renameConversation?(input: DesktopConversationRenameRequest): Promise<{ ok: true; title: string }>;
  readLiveSession?(conversationId: string): Promise<unknown>;
  readLiveSessionContext?(conversationId: string): Promise<unknown>;
  readSessionDetail?(input: DesktopSessionDetailRequest): Promise<unknown>;
  readSessionBlock?(input: DesktopSessionBlockRequest): Promise<unknown>;
  createLiveSession?(input: DesktopLiveSessionCreateRequest): Promise<{ id: string; sessionFile: string }>;
  resumeLiveSession?(sessionFile: string): Promise<{ id: string }>;
  takeOverLiveSession?(input: DesktopLiveSessionTakeoverRequest): Promise<unknown>;
  restoreQueuedLiveSessionMessage?(input: DesktopLiveSessionQueueRestoreRequest): Promise<DesktopLiveSessionQueueRestoreResult>;
  compactLiveSession?(input: DesktopLiveSessionCompactRequest): Promise<{ ok: true; result: unknown }>;
  reloadLiveSession?(conversationId: string): Promise<{ ok: true }>;
  destroyLiveSession?(conversationId: string): Promise<{ ok: true }>;
  branchLiveSession?(input: DesktopLiveSessionBranchRequest): Promise<{ newSessionId: string; sessionFile: string }>;
  forkLiveSession?(input: DesktopLiveSessionForkRequest): Promise<{ newSessionId: string; sessionFile: string }>;
  summarizeAndForkLiveSession?(conversationId: string): Promise<{ newSessionId: string; sessionFile: string }>;
  submitLiveSessionPrompt?(input: DesktopLiveSessionPromptRequest): Promise<DesktopLiveSessionPromptResult>;
  abortLiveSession?(conversationId: string): Promise<{ ok: true }>;
  subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void>;
  subscribeDesktopAppEvents?(onEvent: (event: DesktopAppBridgeEvent) => void): Promise<() => void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export interface DesktopEnvironmentState {
  isElectron: true;
  activeHostId: string;
  activeHostLabel: string;
  activeHostKind: DesktopHostRecord['kind'];
  activeHostSummary: string;
  canManageConnections: true;
}

export interface DesktopConnectionsState {
  activeHostId: string;
  defaultHostId: string;
  hosts: DesktopHostRecord[];
}
