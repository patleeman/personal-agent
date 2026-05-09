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
    attachments: boolean;
    attachmentWrite: boolean;
    knowledge: boolean;
    knowledgeWrite: boolean;
    knowledgeImport: boolean;
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

export interface CompanionConversationBlockImageInput {
  conversationId: string;
  blockId: string;
  imageIndex?: number;
}

export interface CompanionConversationCreateInput {
  cwd?: string;
  workspaceCwd?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  serviceTier?: string | null;
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

export interface CompanionConversationTabsUpdateInput {
  sessionIds?: string[];
  pinnedSessionIds?: string[];
  archivedSessionIds?: string[];
  workspacePaths?: string[];
}

export interface CompanionConversationDuplicateInput {
  conversationId: string;
}

export interface CompanionConversationCwdChangeInput {
  conversationId: string;
  cwd: string;
  surfaceId?: string;
}

export interface CompanionConversationModelPreferencesUpdateInput {
  conversationId: string;
  model?: string | null;
  thinkingLevel?: string | null;
  serviceTier?: string | null;
  surfaceId?: string;
}

export interface CompanionConversationCheckpointCreateInput {
  conversationId: string;
  message: string;
  paths: string[];
}

export interface CompanionConversationSubscriptionInput {
  conversationId: string;
  surfaceId?: string;
  surfaceType?: CompanionSurfaceType;
  tailBlocks?: number;
}

export interface CompanionConversationQueueRestoreInput {
  conversationId: string;
  behavior: 'steer' | 'followUp';
  index: number;
  previewId?: string;
  surfaceId?: string;
}

export interface CompanionConversationParallelJobInput {
  conversationId: string;
  jobId: string;
  action: 'importNow' | 'skip' | 'cancel';
  surfaceId?: string;
}

export interface CompanionSshTargetSaveInput {
  id?: string;
  label: string;
  sshTarget: string;
}

export interface CompanionSshTargetTestInput {
  sshTarget: string;
}
