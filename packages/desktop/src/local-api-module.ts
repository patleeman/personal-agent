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
  readDesktopConversationModelPreferences(conversationId: string): Promise<unknown>;
  updateDesktopConversationModelPreferences(input: {
    conversationId: string;
    model?: string | null;
    thinkingLevel?: string | null;
    surfaceId?: string;
  }): Promise<unknown>;
  readDesktopLiveSession(conversationId: string): Promise<unknown>;
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
  }): Promise<{ id: string; sessionFile: string }>;
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
