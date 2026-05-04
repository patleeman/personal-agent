import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type {
  DesktopApiStreamEvent,
  DesktopConversationStateBridgeEvent,
  DesktopConversationStateSubscriptionRequest,
} from './hosts/types.js';

export type DesktopAppBridgeEvent =
  | { type: 'open' }
  | { type: 'event'; event: unknown }
  | { type: 'error'; message: string }
  | { type: 'close' };

export interface DesktopLocalApiDispatchResult {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface LocalApiModule {
  invokeDesktopLocalApi<T = unknown>(input: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<T>;
  dispatchDesktopLocalApiRequest(input: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<DesktopLocalApiDispatchResult>;
  readDesktopAppStatus(): Promise<unknown>;
  readDesktopDaemonState(): Promise<unknown>;
  readDesktopSessions(): Promise<unknown>;
  readDesktopSessionMeta(sessionId: string): Promise<unknown>;
  readDesktopSessionSearchIndex(sessionIds: string[]): Promise<unknown>;
  readDesktopModels(): Promise<unknown>;
  updateDesktopModelPreferences(input: {
    model?: string | null;
    visionModel?: string | null;
    thinkingLevel?: string | null;
    serviceTier?: string | null;
  }): Promise<{ ok: true }>;
  readDesktopDefaultCwd(): Promise<unknown>;
  updateDesktopDefaultCwd(cwd: string | null): Promise<unknown>;
  readDesktopVaultFiles(): Promise<unknown>;
  pickDesktopFolder(input?: { cwd?: string | null; prompt?: string | null }): Promise<unknown>;
  readDesktopConversationTitleSettings(): Promise<unknown>;
  updateDesktopConversationTitleSettings(input: { enabled?: boolean; model?: string | null }): Promise<unknown>;
  readDesktopConversationPlansWorkspace(): Promise<unknown>;
  readDesktopOpenConversationTabs(): Promise<unknown>;
  updateDesktopOpenConversationTabs(input: {
    sessionIds?: string[];
    pinnedSessionIds?: string[];
    archivedSessionIds?: string[];
    workspacePaths?: string[];
  }): Promise<unknown>;
  readDesktopModelProviders(): Promise<unknown>;
  saveDesktopModelProvider(input: {
    provider: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    authHeader?: boolean;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
    modelOverrides?: Record<string, unknown>;
  }): Promise<unknown>;
  deleteDesktopModelProvider(provider: string): Promise<unknown>;
  saveDesktopModelProviderModel(input: {
    provider: string;
    modelId: string;
    name?: string;
    api?: string;
    baseUrl?: string;
    reasoning?: boolean;
    input?: Array<'text' | 'image'>;
    contextWindow?: number;
    maxTokens?: number;
    headers?: Record<string, string>;
    cost?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
    compat?: Record<string, unknown>;
  }): Promise<unknown>;
  deleteDesktopModelProviderModel(input: { provider: string; modelId: string }): Promise<unknown>;
  readDesktopProviderAuth(): Promise<unknown>;
  setDesktopProviderApiKey(input: { provider: string; apiKey: string }): Promise<unknown>;
  removeDesktopProviderCredential(provider: string): Promise<unknown>;
  startDesktopProviderOAuthLogin(provider: string): Promise<unknown>;
  readDesktopProviderOAuthLogin(loginId: string): Promise<unknown>;
  submitDesktopProviderOAuthLoginInput(input: { loginId: string; value: string }): Promise<unknown>;
  cancelDesktopProviderOAuthLogin(loginId: string): Promise<unknown>;
  subscribeDesktopProviderOAuthLogin(loginId: string, onState: (state: unknown) => void): Promise<() => void>;
  markDesktopConversationAttention(input: { conversationId: string; read?: boolean }): Promise<{ ok: true }>;
  readDesktopScheduledTasks(): Promise<unknown>;
  readDesktopScheduledTaskDetail(taskId: string): Promise<unknown>;
  readDesktopScheduledTaskLog(taskId: string): Promise<{ path: string; log: string }>;
  deleteDesktopScheduledTask(taskId: string): Promise<unknown>;
  createDesktopScheduledTask(input: {
    title?: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    prompt?: string;
  }): Promise<unknown>;
  updateDesktopScheduledTask(input: {
    taskId: string;
    title?: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    prompt?: string;
  }): Promise<unknown>;
  runDesktopScheduledTask(taskId: string): Promise<unknown>;
  readDesktopDurableRuns(): Promise<unknown>;
  readDesktopDurableRun(runId: string): Promise<unknown>;
  readDesktopDurableRunLog(input: { runId: string; tail?: number }): Promise<{ path: string; log: string }>;
  cancelDesktopDurableRun(runId: string): Promise<{ cancelled: boolean; runId: string; reason?: string }>;
  markDesktopDurableRunAttention(input: { runId: string; read?: boolean }): Promise<{ ok: true }>;
  readDesktopConversationBootstrap(input: {
    conversationId: string;
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }): Promise<unknown>;
  renameDesktopConversation(input: { conversationId: string; name: string; surfaceId?: string }): Promise<{ ok: true; title: string }>;
  changeDesktopConversationCwd(input: { conversationId: string; cwd: string; surfaceId?: string }): Promise<unknown>;
  readDesktopConversationDeferredResumes(conversationId: string): Promise<unknown>;
  scheduleDesktopConversationDeferredResume(input: {
    conversationId: string;
    delay?: string;
    prompt?: string;
    behavior?: 'steer' | 'followUp';
  }): Promise<unknown>;
  cancelDesktopConversationDeferredResume(input: { conversationId: string; resumeId: string }): Promise<unknown>;
  fireDesktopConversationDeferredResume(input: { conversationId: string; resumeId: string }): Promise<unknown>;
  recoverDesktopConversation(conversationId: string): Promise<unknown>;
  readDesktopConversationModelPreferences(conversationId: string): Promise<unknown>;
  updateDesktopConversationModelPreferences(input: {
    conversationId: string;
    model?: string | null;
    thinkingLevel?: string | null;
    serviceTier?: string | null;
    surfaceId?: string;
  }): Promise<unknown>;
  readDesktopConversationArtifacts(conversationId: string): Promise<unknown>;
  readDesktopConversationArtifact(input: { conversationId: string; artifactId: string }): Promise<unknown>;
  readDesktopConversationCheckpoints(conversationId: string): Promise<unknown>;
  readDesktopConversationCheckpoint(input: { conversationId: string; checkpointId: string }): Promise<unknown>;
  createDesktopConversationCheckpoint(input: { conversationId: string; message: string; paths: string[] }): Promise<unknown>;
  readDesktopConversationAttachments(conversationId: string): Promise<unknown>;
  readDesktopConversationAttachment(input: { conversationId: string; attachmentId: string }): Promise<unknown>;
  createDesktopConversationAttachment(input: {
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
  }): Promise<unknown>;
  updateDesktopConversationAttachment(input: {
    conversationId: string;
    attachmentId: string;
    title?: string;
    sourceData?: string;
    sourceName?: string;
    sourceMimeType?: string;
    previewData?: string;
    previewName?: string;
    previewMimeType?: string;
    note?: string;
  }): Promise<unknown>;
  readDesktopConversationAttachmentAsset(input: {
    conversationId: string;
    attachmentId: string;
    asset: 'source' | 'preview';
    revision?: number;
  }): Promise<unknown>;
  readDesktopLiveSession(conversationId: string): Promise<unknown>;
  readDesktopLiveSessionForkEntries(conversationId: string): Promise<Array<{ entryId: string; text: string }>>;
  readDesktopLiveSessionContext(conversationId: string): Promise<unknown>;
  readDesktopSessionDetail(input: {
    sessionId: string;
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }): Promise<unknown>;
  readDesktopSessionBlock(input: { sessionId: string; blockId: string }): Promise<unknown>;
  createDesktopLiveSession(input: {
    cwd?: string;
    workspaceCwd?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
    serviceTier?: string | null;
  }): Promise<{ id: string; sessionFile: string; bootstrap?: unknown }>;
  resumeDesktopLiveSession(input: { sessionFile: string; cwd?: string }): Promise<{ id: string }>;
  submitDesktopLiveSessionPrompt(input: {
    conversationId: string;
    text?: string;
    behavior?: 'steer' | 'followUp';
    images?: Array<{ data: string; mimeType: string; name?: string }>;
    attachmentRefs?: unknown;
    contextMessages?: Array<{ customType: string; content: string }>;
    relatedConversationIds?: string[];
    surfaceId?: string;
  }): Promise<{
    ok: true;
    accepted: true;
    delivery: 'started' | 'queued';
    referencedTaskIds: string[];
    referencedMemoryDocIds: string[];
    referencedVaultFileIds: string[];
    referencedAttachmentIds: string[];
    relatedConversationPointerWarnings?: string[];
  }>;
  submitDesktopLiveSessionParallelPrompt(input: {
    conversationId: string;
    text?: string;
    images?: Array<{ data: string; mimeType: string; name?: string }>;
    attachmentRefs?: unknown;
    contextMessages?: Array<{ customType: string; content: string }>;
    relatedConversationIds?: string[];
    surfaceId?: string;
  }): Promise<{
    ok: true;
    accepted: true;
    jobId: string;
    childConversationId: string;
    referencedTaskIds: string[];
    referencedMemoryDocIds: string[];
    referencedVaultFileIds: string[];
    referencedAttachmentIds: string[];
    relatedConversationPointerWarnings?: string[];
  }>;
  manageDesktopLiveSessionParallelJob(input: {
    conversationId: string;
    jobId: string;
    action: 'importNow' | 'skip' | 'cancel';
    surfaceId?: string;
  }): Promise<{
    ok: true;
    status: 'imported' | 'queued' | 'skipped' | 'cancelled';
  }>;
  takeOverDesktopLiveSession(input: { conversationId: string; surfaceId: string }): Promise<unknown>;
  restoreDesktopQueuedLiveSessionMessage(input: {
    conversationId: string;
    behavior: 'steer' | 'followUp';
    index: number;
    previewId?: string;
  }): Promise<{ ok: true; text: string; images: Array<{ type: 'image'; data: string; mimeType: string; name?: string }> }>;
  compactDesktopLiveSession(input: { conversationId: string; customInstructions?: string }): Promise<{ ok: true; result: unknown }>;
  exportDesktopLiveSession(input: { conversationId: string; outputPath?: string }): Promise<{ ok: true; path: string }>;
  reloadDesktopLiveSession(input: { conversationId: string }): Promise<{ ok: true }>;
  destroyDesktopLiveSession(conversationId: string): Promise<{ ok: true }>;
  branchDesktopLiveSession(input: { conversationId: string; entryId: string }): Promise<{ newSessionId: string; sessionFile: string }>;
  forkDesktopLiveSession(input: {
    conversationId: string;
    entryId: string;
    preserveSource?: boolean;
    beforeEntry?: boolean;
  }): Promise<{ newSessionId: string; sessionFile: string }>;
  summarizeAndForkDesktopLiveSession(input: { conversationId: string }): Promise<{ newSessionId: string; sessionFile: string }>;
  abortDesktopLiveSession(conversationId: string): Promise<{ ok: true }>;
  subscribeDesktopConversationState(
    input: DesktopConversationStateSubscriptionRequest,
    onEvent: (event: DesktopConversationStateBridgeEvent) => void,
  ): Promise<() => void>;
  subscribeDesktopLocalApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void>;
  subscribeDesktopAppEvents(onEvent: (event: DesktopAppBridgeEvent) => void): Promise<() => void>;
  setDesktopWorkbenchBrowserToolHost?(
    host: {
      isActive(conversationId: string): Promise<boolean>;
      snapshot(conversationId: string): Promise<unknown>;
      screenshot(conversationId: string): Promise<unknown>;
      cdp(input: { conversationId: string; command: unknown; continueOnError?: boolean }): Promise<unknown>;
    } | null,
  ): void;
}

export type LocalApiModuleLoader = () => Promise<LocalApiModule>;

let localApiModulePromise: Promise<LocalApiModule> | null = null;

function resolveDevLocalApiModuleFilePath(currentDir: string): string {
  return resolve(currentDir, '..', 'server', 'dist', 'app', 'localApi.js');
}

function resolvePackagedLocalApiModuleFilePath(currentDir: string, appPath?: string | null): string {
  const resolvedAppPath = appPath?.trim();
  if (resolvedAppPath) {
    return resolve(resolvedAppPath, 'server', 'dist', 'app', 'localApi.js');
  }

  return resolve(currentDir, '..', 'server', 'dist', 'app', 'localApi.js');
}

function resolveRepoLocalApiModuleFilePath(repoRoot?: string | null): string | null {
  const resolvedRepoRoot = repoRoot?.trim();
  if (!resolvedRepoRoot) {
    return null;
  }

  return resolve(resolvedRepoRoot, 'packages', 'desktop', 'server', 'dist', 'app', 'localApi.js');
}

export function resolveLocalApiModuleUrl(
  input: {
    currentDir?: string;
    isPackaged?: boolean;
    appPath?: string;
    repoRoot?: string;
  } = {},
): string {
  const currentDir = input.currentDir ?? dirname(fileURLToPath(import.meta.url));
  const envRepoRoot = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  const envAppPath = process.env.PERSONAL_AGENT_DESKTOP_APP_PATH?.trim();
  const devPath = resolveDevLocalApiModuleFilePath(currentDir);
  const packagedPath = resolvePackagedLocalApiModuleFilePath(currentDir, input.appPath ?? envAppPath ?? null);
  const repoPath = resolveRepoLocalApiModuleFilePath(input.repoRoot ?? envRepoRoot ?? null);

  if (input.isPackaged === true) {
    return pathToFileURL(packagedPath).href;
  }

  if (input.isPackaged === false) {
    return pathToFileURL(devPath).href;
  }

  const existingPath = [packagedPath, devPath, repoPath]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .find((filePath) => existsSync(filePath));
  const fallbackPath = (input.appPath ?? envAppPath) ? packagedPath : devPath;

  return pathToFileURL(existingPath ?? fallbackPath).href;
}

function resolveFallbackLocalApiModuleUrl(): string | null {
  const repoPath = resolveRepoLocalApiModuleFilePath(process.env.PERSONAL_AGENT_REPO_ROOT?.trim());
  if (!repoPath || !existsSync(repoPath)) {
    return null;
  }

  return pathToFileURL(repoPath).href;
}

export async function importLocalApiModuleWithFallback(input: {
  primaryUrl: string;
  fallbackUrl?: string | null;
  loadModule: (moduleUrl: string) => Promise<LocalApiModule>;
}): Promise<LocalApiModule> {
  try {
    return await input.loadModule(input.primaryUrl);
  } catch (error) {
    if (!input.fallbackUrl || input.fallbackUrl === input.primaryUrl) {
      throw error;
    }

    return input.loadModule(input.fallbackUrl);
  }
}

export function loadRawLocalApiModule(): Promise<LocalApiModule> {
  if (!localApiModulePromise) {
    localApiModulePromise = importLocalApiModuleWithFallback({
      primaryUrl: resolveLocalApiModuleUrl(),
      fallbackUrl: resolveFallbackLocalApiModuleUrl(),
      loadModule: (moduleUrl) => import(moduleUrl) as Promise<LocalApiModule>,
    });
  }

  return localApiModulePromise;
}

export function loadLocalApiModule(): Promise<LocalApiModule> {
  return loadRawLocalApiModule();
}
