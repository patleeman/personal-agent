import type { DaemonConfig } from '../config.js';

export const COMPANION_PROTOCOL_VERSION = 'v1';
export const COMPANION_API_ROOT = '/companion/v1';
export const COMPANION_SOCKET_PATH = `${COMPANION_API_ROOT}/socket`;

export type CompanionSurfaceType = 'desktop_ui' | 'ios_native';

export interface CompanionHostHello {
  hostInstanceId: string;
  hostLabel: string;
  daemonVersion: string;
  protocolVersion: string;
  transport: {
    websocket: true;
    singleSocket: true;
    httpAvailable: true;
  };
  auth: {
    pairingRequired: true;
    bearerTokens: true;
  };
  capabilities: {
    fullConversationLifecycle: boolean;
    executionTargets: boolean;
    executionTargetSwitching: boolean;
    attachments: boolean;
    attachmentWrite: boolean;
    deviceAdmin: boolean;
  };
}

export interface CompanionPairedDeviceSummary {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface CompanionPairingCode {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string;
}

export interface CompanionSetupLink {
  id: string;
  label: string;
  baseUrl: string;
  setupUrl: string;
}

export interface CompanionSetupState {
  pairing: CompanionPairingCode;
  links: CompanionSetupLink[];
  warnings: string[];
}

export interface CompanionDeviceTokenResult {
  bearerToken: string;
  device: CompanionPairedDeviceSummary;
}

export interface CompanionBinaryAsset {
  data: Uint8Array;
  mimeType: string;
  fileName?: string;
  disposition?: 'inline' | 'attachment';
}

export interface CompanionConversationBootstrapInput {
  conversationId: string;
  tailBlocks?: number;
  knownSessionSignature?: string;
  knownBlockOffset?: number;
  knownTotalBlocks?: number;
  knownLastBlockId?: string;
}

export interface CompanionConversationCreateInput {
  cwd?: string;
  model?: string | null;
  thinkingLevel?: string | null;
  serviceTier?: string | null;
  executionTargetId?: string | null;
  prompt?: {
    text?: string;
    behavior?: 'steer' | 'followUp';
    images?: Array<{ data: string; mimeType: string; name?: string }>;
    attachmentRefs?: Array<{ attachmentId: string; revision?: number }>;
    contextMessages?: Array<{ customType: string; content: string }>;
    surfaceId?: string;
  };
}

export interface CompanionConversationResumeInput {
  sessionFile: string;
  cwd?: string;
  executionTargetId?: string | null;
}

export interface CompanionConversationPromptInput {
  conversationId: string;
  text?: string;
  behavior?: 'steer' | 'followUp';
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  attachmentRefs?: Array<{ attachmentId: string; revision?: number }>;
  contextMessages?: Array<{ customType: string; content: string }>;
  surfaceId?: string;
}

export interface CompanionConversationAbortInput {
  conversationId: string;
}

export interface CompanionConversationTakeoverInput {
  conversationId: string;
  surfaceId: string;
}

export interface CompanionConversationRenameInput {
  conversationId: string;
  name: string;
  surfaceId?: string;
}

export interface CompanionConversationExecutionTargetChangeInput {
  conversationId: string;
  executionTargetId: string;
  cwd?: string | null;
}

export interface CompanionConversationSubscriptionInput {
  conversationId: string;
  surfaceId?: string;
  surfaceType?: CompanionSurfaceType;
  tailBlocks?: number;
}

export interface CompanionAttachmentCreateInput {
  conversationId: string;
  kind?: 'excalidraw';
  title?: string;
  sourceData?: string;
  sourceName?: string;
  sourceMimeType?: string;
  previewData?: string;
  previewName?: string;
  previewMimeType?: string;
  note?: string;
}

export interface CompanionAttachmentUpdateInput extends CompanionAttachmentCreateInput {
  attachmentId: string;
}

export interface CompanionAttachmentAssetInput {
  conversationId: string;
  attachmentId: string;
  asset: 'source' | 'preview';
  revision?: number;
}

export interface CompanionRuntime {
  listConversations(): Promise<unknown>;
  listExecutionTargets(): Promise<unknown>;
  readConversationBootstrap(input: CompanionConversationBootstrapInput): Promise<unknown>;
  createConversation(input: CompanionConversationCreateInput): Promise<unknown>;
  resumeConversation(input: CompanionConversationResumeInput): Promise<unknown>;
  promptConversation(input: CompanionConversationPromptInput): Promise<unknown>;
  abortConversation(input: CompanionConversationAbortInput): Promise<unknown>;
  takeOverConversation(input: CompanionConversationTakeoverInput): Promise<unknown>;
  renameConversation(input: CompanionConversationRenameInput): Promise<unknown>;
  changeConversationExecutionTarget(input: CompanionConversationExecutionTargetChangeInput): Promise<unknown>;
  listConversationAttachments(conversationId: string): Promise<unknown>;
  readConversationAttachment(input: { conversationId: string; attachmentId: string }): Promise<unknown>;
  createConversationAttachment(input: CompanionAttachmentCreateInput): Promise<unknown>;
  updateConversationAttachment(input: CompanionAttachmentUpdateInput): Promise<unknown>;
  readConversationAttachmentAsset(input: CompanionAttachmentAssetInput): Promise<CompanionBinaryAsset>;
  subscribeApp(onEvent: (event: unknown) => void): Promise<() => void>;
  subscribeConversation(input: CompanionConversationSubscriptionInput, onEvent: (event: unknown) => void): Promise<() => void>;
}

export type CompanionRuntimeProvider = (config: DaemonConfig) => CompanionRuntime | Promise<CompanionRuntime>;

export interface CompanionReadyEvent {
  type: 'ready';
  hello: CompanionHostHello;
  device: CompanionPairedDeviceSummary;
}

export interface CompanionCommandMessage {
  id: string;
  type: 'command';
  name: string;
  payload?: unknown;
}

export interface CompanionSubscribeMessage {
  id: string;
  type: 'subscribe';
  topic: 'app' | 'conversation';
  key?: string;
  payload?: unknown;
}

export interface CompanionUnsubscribeMessage {
  id: string;
  type: 'unsubscribe';
  topic: 'app' | 'conversation';
  key?: string;
}

export type CompanionClientSocketMessage =
  | CompanionCommandMessage
  | CompanionSubscribeMessage
  | CompanionUnsubscribeMessage;

export interface CompanionSocketSuccessResponse {
  id: string;
  type: 'response';
  ok: true;
  result: unknown;
}

export interface CompanionSocketErrorResponse {
  id: string;
  type: 'response';
  ok: false;
  error: string;
}

export interface CompanionSocketEventEnvelope {
  type: 'event';
  topic: 'app' | 'conversation';
  key: string;
  event: unknown;
}

export type CompanionServerSocketMessage =
  | CompanionReadyEvent
  | CompanionSocketSuccessResponse
  | CompanionSocketErrorResponse
  | CompanionSocketEventEnvelope;
