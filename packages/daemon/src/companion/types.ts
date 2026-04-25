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

export interface CompanionRemoteDirectoryInput {
  executionTargetId: string;
  path?: string | null;
}

export interface CompanionScheduledTaskInput {
  title?: string;
  enabled?: boolean;
  cron?: string | null;
  at?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number | null;
  prompt?: string;
  targetType?: string | null;
  conversationBehavior?: string | null;
  callbackConversationId?: string | null;
  deliverOnSuccess?: boolean | null;
  deliverOnFailure?: boolean | null;
  notifyOnSuccess?: string | null;
  notifyOnFailure?: string | null;
  requireAck?: boolean | null;
  autoResumeIfOpen?: boolean | null;
  threadMode?: string | null;
  threadConversationId?: string | null;
}

export interface CompanionScheduledTaskUpdateInput extends CompanionScheduledTaskInput {
  taskId: string;
}

export interface CompanionDurableRunLogInput {
  runId: string;
  tail?: number;
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

export interface CompanionKnowledgeImportInput {
  kind: 'text' | 'url' | 'image';
  directoryId?: string | null;
  title?: string | null;
  text?: string | null;
  url?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  dataBase64?: string | null;
  sourceApp?: string | null;
  createdAt?: string | null;
}

export interface CompanionKnowledgeRenameInput {
  id: string;
  newName: string;
  parentId?: string | null;
}

export interface CompanionKnowledgeSearchInput {
  query?: string | null;
  limit?: number | null;
}

export interface CompanionKnowledgeImageAssetInput {
  fileName?: string | null;
  mimeType?: string | null;
  dataBase64: string;
}

export interface CompanionRuntime {
  listConversations(): Promise<unknown>;
  updateConversationTabs(input: CompanionConversationTabsUpdateInput): Promise<unknown>;
  duplicateConversation(input: CompanionConversationDuplicateInput): Promise<unknown>;
  listExecutionTargets(): Promise<unknown>;
  readModels(): Promise<unknown>;
  listSshTargets(): Promise<unknown>;
  saveSshTarget(input: CompanionSshTargetSaveInput): Promise<unknown>;
  deleteSshTarget(targetId: string): Promise<unknown>;
  testSshTarget(input: CompanionSshTargetTestInput): Promise<unknown>;
  readRemoteDirectory(input: CompanionRemoteDirectoryInput): Promise<unknown>;
  readConversationBootstrap(input: CompanionConversationBootstrapInput): Promise<unknown>;
  readConversationBlockImage(input: CompanionConversationBlockImageInput): Promise<CompanionBinaryAsset>;
  createConversation(input: CompanionConversationCreateInput): Promise<unknown>;
  resumeConversation(input: CompanionConversationResumeInput): Promise<unknown>;
  promptConversation(input: CompanionConversationPromptInput): Promise<unknown>;
  parallelPromptConversation(input: CompanionConversationPromptInput): Promise<unknown>;
  restoreConversationQueuePrompt(input: CompanionConversationQueueRestoreInput): Promise<unknown>;
  manageConversationParallelJob(input: CompanionConversationParallelJobInput): Promise<unknown>;
  cancelConversationDeferredResume(input: { conversationId: string; resumeId: string }): Promise<unknown>;
  fireConversationDeferredResume(input: { conversationId: string; resumeId: string }): Promise<unknown>;
  abortConversation(input: CompanionConversationAbortInput): Promise<unknown>;
  takeOverConversation(input: CompanionConversationTakeoverInput): Promise<unknown>;
  renameConversation(input: CompanionConversationRenameInput): Promise<unknown>;
  changeConversationCwd(input: CompanionConversationCwdChangeInput): Promise<unknown>;
  readConversationAutoMode(conversationId: string): Promise<unknown>;
  updateConversationAutoMode(input: { conversationId: string; enabled: boolean; surfaceId?: string }): Promise<unknown>;
  readConversationModelPreferences(conversationId: string): Promise<unknown>;
  updateConversationModelPreferences(input: CompanionConversationModelPreferencesUpdateInput): Promise<unknown>;
  createConversationCheckpoint(input: CompanionConversationCheckpointCreateInput): Promise<unknown>;
  listConversationArtifacts(conversationId: string): Promise<unknown>;
  readConversationArtifact(input: { conversationId: string; artifactId: string }): Promise<unknown>;
  listConversationCheckpoints(conversationId: string): Promise<unknown>;
  readConversationCheckpoint(input: { conversationId: string; checkpointId: string }): Promise<unknown>;
  changeConversationExecutionTarget(input: CompanionConversationExecutionTargetChangeInput): Promise<unknown>;
  listConversationAttachments(conversationId: string): Promise<unknown>;
  readConversationAttachment(input: { conversationId: string; attachmentId: string }): Promise<unknown>;
  createConversationAttachment(input: CompanionAttachmentCreateInput): Promise<unknown>;
  updateConversationAttachment(input: CompanionAttachmentUpdateInput): Promise<unknown>;
  readConversationAttachmentAsset(input: CompanionAttachmentAssetInput): Promise<CompanionBinaryAsset>;
  listKnowledgeEntries(directoryId?: string | null): Promise<unknown>;
  searchKnowledge(input: CompanionKnowledgeSearchInput): Promise<unknown>;
  readKnowledgeFile(fileId: string): Promise<unknown>;
  writeKnowledgeFile(input: { fileId: string; content: string }): Promise<unknown>;
  createKnowledgeFolder(folderId: string): Promise<unknown>;
  renameKnowledgeEntry(input: CompanionKnowledgeRenameInput): Promise<unknown>;
  deleteKnowledgeEntry(id: string): Promise<unknown>;
  createKnowledgeImageAsset(input: CompanionKnowledgeImageAssetInput): Promise<unknown>;
  importKnowledge(input: CompanionKnowledgeImportInput): Promise<unknown>;
  listScheduledTasks(): Promise<unknown>;
  readScheduledTask(taskId: string): Promise<unknown>;
  readScheduledTaskLog(taskId: string): Promise<unknown>;
  createScheduledTask(input: CompanionScheduledTaskInput): Promise<unknown>;
  updateScheduledTask(input: CompanionScheduledTaskUpdateInput): Promise<unknown>;
  deleteScheduledTask(taskId: string): Promise<unknown>;
  runScheduledTask(taskId: string): Promise<unknown>;
  listDurableRuns(): Promise<unknown>;
  readDurableRun(runId: string): Promise<unknown>;
  readDurableRunLog(input: CompanionDurableRunLogInput): Promise<unknown>;
  cancelDurableRun(runId: string): Promise<unknown>;
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
