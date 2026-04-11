import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { app } from 'electron';
import type { DesktopApiStreamEvent } from './hosts/types.js';

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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<T>;
  dispatchDesktopLocalApiRequest(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<DesktopLocalApiDispatchResult>;
  readDesktopAppStatus(): Promise<unknown>;
  readDesktopDaemonState(): Promise<unknown>;
  readDesktopWebUiState(): Promise<unknown>;
  updateDesktopWebUiConfig(input: {
    useTailscaleServe?: boolean;
    resumeFallbackPrompt?: string;
  }): Promise<unknown>;
  readDesktopRemoteAccessState(): Promise<unknown>;
  createDesktopRemoteAccessPairingCode(): Promise<unknown>;
  revokeDesktopRemoteAccessSession(sessionId: string): Promise<{ ok: boolean; state: unknown }>;
  readDesktopSessions(): Promise<unknown>;
  readDesktopSessionMeta(sessionId: string): Promise<unknown>;
  readDesktopSessionSearchIndex(sessionIds: string[]): Promise<unknown>;
  readDesktopProfiles(): Promise<unknown>;
  setDesktopCurrentProfile(profile: string): Promise<{ ok: true; currentProfile: string }>;
  readDesktopModels(): Promise<unknown>;
  updateDesktopModelPreferences(input: {
    model?: string | null;
    thinkingLevel?: string | null;
  }): Promise<{ ok: true }>;
  readDesktopDefaultCwd(): Promise<unknown>;
  updateDesktopDefaultCwd(cwd: string | null): Promise<unknown>;
  readDesktopVaultRoot(): Promise<unknown>;
  readDesktopVaultFiles(): Promise<unknown>;
  updateDesktopVaultRoot(root: string | null): Promise<unknown>;
  pickDesktopFolder(input?: { cwd?: string | null; prompt?: string | null }): Promise<unknown>;
  readDesktopConversationTitleSettings(): Promise<unknown>;
  updateDesktopConversationTitleSettings(input: { enabled?: boolean; model?: string | null }): Promise<unknown>;
  readDesktopConversationPlansWorkspace(): Promise<unknown>;
  readDesktopOpenConversationTabs(): Promise<unknown>;
  updateDesktopOpenConversationTabs(input: {
    sessionIds?: string[];
    pinnedSessionIds?: string[];
    archivedSessionIds?: string[];
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
  readDesktopCodexPlanUsage(): Promise<unknown>;
  setDesktopProviderApiKey(input: { provider: string; apiKey: string }): Promise<unknown>;
  removeDesktopProviderCredential(provider: string): Promise<unknown>;
  startDesktopProviderOAuthLogin(provider: string): Promise<unknown>;
  readDesktopProviderOAuthLogin(loginId: string): Promise<unknown>;
  submitDesktopProviderOAuthLoginInput(input: { loginId: string; value: string }): Promise<unknown>;
  cancelDesktopProviderOAuthLogin(loginId: string): Promise<unknown>;
  subscribeDesktopProviderOAuthLogin(
    loginId: string,
    onState: (state: unknown) => void,
  ): Promise<() => void>;
  markDesktopConversationAttention(input: { conversationId: string; read?: boolean }): Promise<{ ok: true }>;
  readDesktopScheduledTasks(): Promise<unknown>;
  readDesktopScheduledTaskDetail(taskId: string): Promise<unknown>;
  readDesktopScheduledTaskLog(taskId: string): Promise<{ path: string; log: string }>;
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
  renameDesktopConversation(input: {
    conversationId: string;
    name: string;
    surfaceId?: string;
  }): Promise<{ ok: true; title: string }>;
  changeDesktopConversationCwd(input: {
    conversationId: string;
    cwd: string;
    surfaceId?: string;
  }): Promise<unknown>;
  readDesktopConversationDeferredResumes(conversationId: string): Promise<unknown>;
  scheduleDesktopConversationDeferredResume(input: {
    conversationId: string;
    delay?: string;
    prompt?: string;
    behavior?: 'steer' | 'followUp';
  }): Promise<unknown>;
  cancelDesktopConversationDeferredResume(input: {
    conversationId: string;
    resumeId: string;
  }): Promise<unknown>;
  fireDesktopConversationDeferredResume(input: {
    conversationId: string;
    resumeId: string;
  }): Promise<unknown>;
  recoverDesktopConversation(conversationId: string): Promise<unknown>;
  readDesktopConversationModelPreferences(conversationId: string): Promise<unknown>;
  updateDesktopConversationModelPreferences(input: {
    conversationId: string;
    model?: string | null;
    thinkingLevel?: string | null;
    surfaceId?: string;
  }): Promise<unknown>;
  readDesktopConversationArtifacts(conversationId: string): Promise<unknown>;
  readDesktopConversationArtifact(input: { conversationId: string; artifactId: string }): Promise<unknown>;
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
  readDesktopSessionBlock(input: {
    sessionId: string;
    blockId: string;
  }): Promise<unknown>;
  createDesktopLiveSession(input: {
    cwd?: string;
    model?: string | null;
    thinkingLevel?: string | null;
  }): Promise<{ id: string; sessionFile: string; bootstrap?: unknown }>;
  resumeDesktopLiveSession(sessionFile: string): Promise<{ id: string }>;
  submitDesktopLiveSessionPrompt(input: {
    conversationId: string;
    text?: string;
    behavior?: 'steer' | 'followUp';
    images?: Array<{ data: string; mimeType: string; name?: string }>;
    attachmentRefs?: unknown;
    surfaceId?: string;
  }): Promise<{
    ok: true;
    accepted: true;
    delivery: 'started' | 'queued';
    referencedTaskIds: string[];
    referencedMemoryDocIds: string[];
    referencedVaultFileIds: string[];
    referencedAttachmentIds: string[];
  }>;
  takeOverDesktopLiveSession(input: {
    conversationId: string;
    surfaceId: string;
  }): Promise<unknown>;
  restoreDesktopQueuedLiveSessionMessage(input: {
    conversationId: string;
    behavior: 'steer' | 'followUp';
    index: number;
    previewId?: string;
  }): Promise<{ ok: true; text: string; images: Array<{ type: 'image'; data: string; mimeType: string; name?: string }> }>;
  compactDesktopLiveSession(input: {
    conversationId: string;
    customInstructions?: string;
  }): Promise<{ ok: true; result: unknown }>;
  exportDesktopLiveSession(input: {
    conversationId: string;
    outputPath?: string;
  }): Promise<{ ok: true; path: string }>;
  reloadDesktopLiveSession(input: {
    conversationId: string;
  }): Promise<{ ok: true }>;
  destroyDesktopLiveSession(conversationId: string): Promise<{ ok: true }>;
  branchDesktopLiveSession(input: {
    conversationId: string;
    entryId: string;
  }): Promise<{ newSessionId: string; sessionFile: string }>;
  forkDesktopLiveSession(input: {
    conversationId: string;
    entryId: string;
    preserveSource?: boolean;
  }): Promise<{ newSessionId: string; sessionFile: string }>;
  summarizeAndForkDesktopLiveSession(input: {
    conversationId: string;
  }): Promise<{ newSessionId: string; sessionFile: string }>;
  abortDesktopLiveSession(conversationId: string): Promise<{ ok: true }>;
  subscribeDesktopLocalApiStream(
    path: string,
    onEvent: (event: DesktopApiStreamEvent) => void,
  ): Promise<() => void>;
  subscribeDesktopAppEvents(
    onEvent: (event: DesktopAppBridgeEvent) => void,
  ): Promise<() => void>;
}

export type LocalApiModuleLoader = () => Promise<LocalApiModule>;

let localApiModulePromise: Promise<LocalApiModule> | null = null;

export function resolveLocalApiModuleUrl(input: {
  currentDir?: string;
  isPackaged?: boolean;
  appPath?: string;
} = {}): string {
  const isPackaged = input.isPackaged ?? app.isPackaged;
  if (isPackaged) {
    const appPath = input.appPath ?? app.getAppPath();
    return pathToFileURL(resolve(appPath, 'node_modules', '@personal-agent', 'web', 'dist-server', 'app', 'localApi.js')).href;
  }

  const currentDir = input.currentDir ?? dirname(fileURLToPath(import.meta.url));
  return pathToFileURL(resolve(currentDir, '..', '..', 'web', 'dist-server', 'app', 'localApi.js')).href;
}

function resolveFallbackLocalApiModuleUrl(): string | null {
  const repoRoot = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  if (!repoRoot) {
    return null;
  }

  const filePath = resolve(repoRoot, 'packages', 'web', 'dist-server', 'app', 'localApi.js');
  if (!existsSync(filePath)) {
    return null;
  }

  return pathToFileURL(filePath).href;
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

export function loadLocalApiModule(): Promise<LocalApiModule> {
  if (!localApiModulePromise) {
    localApiModulePromise = importLocalApiModuleWithFallback({
      primaryUrl: resolveLocalApiModuleUrl(),
      fallbackUrl: resolveFallbackLocalApiModuleUrl(),
      loadModule: (moduleUrl) => import(moduleUrl) as Promise<LocalApiModule>,
    });
  }

  return localApiModulePromise;
}
