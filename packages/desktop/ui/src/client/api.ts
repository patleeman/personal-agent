import { getDesktopBridge, readDesktopEnvironment } from '../desktop/desktopBridge';
import type {
  ExtensionCommandRegistration,
  ExtensionInstallSummary,
  ExtensionKeybindingRegistration,
  ExtensionManifest,
  ExtensionMentionRegistration,
  ExtensionQuickOpenRegistration,
  ExtensionRouteSummary,
  ExtensionSlashCommandRegistration,
  ExtensionSurfaceSummary,
} from '../extensions/types';
import type {
  AppStatus,
  AutoModeSummary,
  AutoModeSummary,
  CacheEfficiencyAggregate,
  CacheEfficiencyPoint,
  ContextPointerUsageResult,
  ConversationArtifactRecord,
  ConversationArtifactSummary,
  ConversationAttachmentAssetData,
  ConversationAttachmentRecord,
  ConversationAttachmentSummary,
  ConversationAutomationWorkspaceState,
  ConversationAutoModeState,
  ConversationBootstrapState,
  ConversationCheckpointReviewContext,
  ConversationCommitCheckpointRecord,
  ConversationCommitCheckpointSummary,
  ConversationContentSearchResult,
  ConversationContextDocRef,
  ConversationCwdChangeResult,
  ConversationRecoveryResult,
  ConversationSummaryRecord,
  DaemonState,
  DefaultCwdState,
  DeferredResumeSummary,
  DesktopEnvironmentState,
  DesktopRemoteDirectoryListing,
  DisplayBlock,
  DurableRunDetailResult,
  DurableRunListResult,
  FilePickerResult,
  FolderPickerResult,
  GatewayProviderId,
  GatewayState,
  GatewayStatus,
  InjectedPromptMessage,
  InstructionFilesState,
  LiveSessionContext,
  LiveSessionCreateResult,
  LiveSessionExportResult,
  LiveSessionForkEntry,
  LiveSessionMeta,
  LiveSessionPresenceState,
  MemoryData,
  ModelProviderState,
  ModelState,
  PromptAttachmentRefInput,
  PromptImageInput,
  ProviderAuthState,
  ProviderOAuthLoginState,
  ScheduledTaskDetail,
  ScheduledTaskSchedulerHealth,
  ScheduledTaskSummary,
  SessionDetailResult,
  SessionMeta,
  SkillFoldersState,
  SystemPromptAggregate,
  SystemPromptPoint,
  ToolFlowResult,
  ToolsState,
  TraceAgentLoop,
  TraceContextResponse,
  TraceCostRow,
  TraceModelUsage,
  TraceSummary,
  TraceThroughput,
  TraceTokenDaily,
  TraceToolHealth,
  TranscriptionInstallResult,
  TranscriptionModelStatus,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionSettingsState,
  UncommittedDiffResult,
  WorkspaceDiffOverlay,
  WorkspaceDirectoryListing,
  WorkspaceFileContent,
} from '../shared/types';
import { buildApiPath } from './apiBase';
import { recordApiTiming } from './perfDiagnostics';

// ── Retry helpers for transient network errors (e.g. server restarts) ────────

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && /failed to fetch|network|ECONNREFUSED|ECONNRESET/i.test(error.message)) {
    return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(input, init);
      if (!res) throw new Error('fetch returned undefined');
      return res;
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= RETRY_DELAYS_MS.length) {
        throw error;
      }

      await sleep(RETRY_DELAYS_MS[attempt] as number);
    }
  }

  throw lastError;
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function requestJson<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const requestPath = buildApiPath(path);
  const res = await fetchWithRetry(requestPath, {
    method,
    ...(method === 'GET'
      ? { cache: 'no-store' as const }
      : {
          headers: { 'Content-Type': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
  });
  recordApiTiming(requestPath, res);
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  return requestJson<T>('GET', path);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>('POST', path, body);
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>('PUT', path, body);
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>('PATCH', path, body);
}

async function del<T>(path: string): Promise<T> {
  return requestJson<T>('DELETE', path);
}

async function readApiError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (typeof data.error === 'string' && data.error.trim().length > 0) {
      return data.error;
    }
  } catch {
    // Ignore non-JSON error bodies.
  }

  return `${res.status} ${res.statusText}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

const pendingMemoryRequests = new Map<string, Promise<MemoryData>>();
let desktopEnvironmentPromise: Promise<DesktopEnvironmentState | null> | null = null;

async function getMemoryData(): Promise<MemoryData> {
  const cacheKey = '__current__';
  const pending = pendingMemoryRequests.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = get<MemoryData>('/memory').finally(() => {
    pendingMemoryRequests.delete(cacheKey);
  });
  pendingMemoryRequests.set(cacheKey, request);
  return request;
}

async function readCachedDesktopEnvironment(): Promise<DesktopEnvironmentState | null> {
  if (!desktopEnvironmentPromise) {
    desktopEnvironmentPromise = readDesktopEnvironment().catch(() => null);
  }

  return desktopEnvironmentPromise;
}

async function shouldUseDesktopLocalCapabilities(): Promise<boolean> {
  if (!getDesktopBridge()) {
    return false;
  }

  const environment = await readCachedDesktopEnvironment();
  return environment?.activeHostKind === 'local';
}

async function shouldUseDesktopLocalConversationCapabilities(conversationId: string): Promise<boolean> {
  if (!getDesktopBridge() || !(await shouldUseDesktopLocalCapabilities())) {
    return false;
  }

  try {
    const meta = await get<SessionMeta>(`/sessions/${encodeURIComponent(conversationId)}/meta`);
    return !(meta.remoteHostId || meta.remoteConversationId);
  } catch {
    return true;
  }
}

function normalizeTailBlocksParam(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(1000, value) : undefined;
}

export function normalizeDurableRunLogTailParam(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(1000, value) : undefined;
}

export function normalizeConversationContentSearchLimit(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(100, value) : 80;
}

export function normalizeVaultSearchLimit(value: unknown): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(50, value) : 20;
}

export const api = {
  // ── Core ──────────────────────────────────────────────────────────────────
  status: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readAppStatus();
    }
    return get<AppStatus>('/status');
  },
  daemon: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readDaemonState();
    }
    return get<DaemonState>('/daemon');
  },
  extensions: async () => get<ExtensionManifest[]>('/extensions'),
  extensionInstallations: async () => get<ExtensionInstallSummary[]>('/extensions/installed'),
  createExtension: async (input: {
    id: string;
    name: string;
    description?: string;
    template?: 'main-page' | 'right-rail' | 'workbench-detail';
  }) => post<{ ok: true; extension?: ExtensionInstallSummary; packageRoot: string }>('/extensions', input),
  importExtension: async (input: { zipPath: string }) =>
    post<{ ok: true; extension?: ExtensionInstallSummary; packageRoot: string }>('/extensions/import', input),
  extensionRoutes: async () => get<ExtensionRouteSummary[]>('/extensions/routes'),
  extensionSurfaces: async () => get<ExtensionSurfaceSummary[]>('/extensions/surfaces'),
  extensionCommands: async () => get<ExtensionCommandRegistration[]>('/extensions/commands'),
  extensionKeybindings: async () => get<ExtensionKeybindingRegistration[]>('/extensions/keybindings'),
  updateExtensionKeybinding: async (
    extensionId: string,
    keybindingId: string,
    input: { keys?: string[]; enabled?: boolean; reset?: boolean },
  ) => patch<{ ok: true }>(`/extensions/keybindings/${encodeURIComponent(extensionId)}/${encodeURIComponent(keybindingId)}`, input),
  extensionSlashCommands: async () => get<ExtensionSlashCommandRegistration[]>('/extensions/slash-commands'),
  extensionMentions: async () => get<ExtensionMentionRegistration[]>('/extensions/mentions'),
  extensionQuickOpen: async () => get<ExtensionQuickOpenRegistration[]>('/extensions/quick-open'),
  extensionManifest: async (extensionId: string) => get<ExtensionManifest>(`/extensions/${encodeURIComponent(extensionId)}/manifest`),
  extensionSurfacesForExtension: async (extensionId: string) =>
    get<ExtensionSurfaceSummary[]>(`/extensions/${encodeURIComponent(extensionId)}/surfaces`),
  extensionStateList: async <T = unknown>(extensionId: string, prefix = '') =>
    get<Array<{ key: string; value: T; version: number; createdAt: number; updatedAt: number }>>(
      `/extensions/${encodeURIComponent(extensionId)}/state${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`,
    ),
  extensionState: async <T = unknown>(extensionId: string, key: string) =>
    get<{ key: string; value: T; version: number; createdAt: number; updatedAt: number }>(
      `/extensions/${encodeURIComponent(extensionId)}/state/${encodeURIComponent(key)}`,
    ),
  putExtensionState: async (extensionId: string, key: string, value: unknown, opts?: { expectedVersion?: number }) =>
    put<{ ok: true; key: string; version: number }>(`/extensions/${encodeURIComponent(extensionId)}/state/${encodeURIComponent(key)}`, {
      value,
      expectedVersion: opts?.expectedVersion,
    }),
  deleteExtensionState: async (extensionId: string, key: string) =>
    del<{ ok: true; deleted: boolean }>(`/extensions/${encodeURIComponent(extensionId)}/state/${encodeURIComponent(key)}`),
  startExtensionRun: async (extensionId: string, input: unknown) =>
    post<unknown>(`/extensions/${encodeURIComponent(extensionId)}/runs`, input),
  invokeExtensionAction: async (extensionId: string, actionId: string, input: unknown) =>
    post<{ ok: true; result: unknown }>(`/extensions/${encodeURIComponent(extensionId)}/actions/${encodeURIComponent(actionId)}`, input),
  listExtensionActions: async () =>
    get<
      Array<{
        extensionId: string;
        extensionName: string;
        actions: Array<{ id: string; title?: string; description?: string }>;
      }>
    >('/extensions/actions'),
  extensionStatus: async (extensionId: string) =>
    get<{ enabled: boolean; healthy: boolean; errors?: string[] }>(`/extensions/${encodeURIComponent(extensionId)}/status`),
  reloadExtensions: async () => post<{ ok: boolean; reloaded: boolean; message: string }>('/extensions/reload'),
  updateExtension: async (extensionId: string, input: { enabled: boolean }) =>
    patch<{ ok: true; extension?: ExtensionInstallSummary }>(`/extensions/${encodeURIComponent(extensionId)}`, input),
  buildExtension: async (extensionId: string) =>
    post<{ ok: true; extensionId: string; outputs: string[] }>(`/extensions/${encodeURIComponent(extensionId)}/build`),
  reloadExtension: async (extensionId: string) =>
    post<{ ok: true; id: string; reloaded: boolean; message: string }>(`/extensions/${encodeURIComponent(extensionId)}/reload`),
  snapshotExtension: async (extensionId: string) =>
    post<{ ok: true; extensionId: string; snapshotPath: string }>(`/extensions/${encodeURIComponent(extensionId)}/snapshot`),
  exportExtension: async (extensionId: string) =>
    post<{ ok: true; extensionId: string; exportPath: string }>(`/extensions/${encodeURIComponent(extensionId)}/export`),
  sessions: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readSessions();
    }
    return get<SessionMeta[]>('/sessions');
  },
  sessionMeta: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readSessionMeta(id);
    }
    return get<SessionMeta>(`/sessions/${encodeURIComponent(id)}/meta`);
  },
  sessionDetail: async (
    id: string,
    options?: {
      tailBlocks?: number;
      knownSessionSignature?: string;
      knownBlockOffset?: number;
      knownTotalBlocks?: number;
      knownLastBlockId?: string;
    },
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readSessionDetail({ sessionId: id, ...options });
    }

    const params = new URLSearchParams();
    const tailBlocks = normalizeTailBlocksParam(options?.tailBlocks);
    if (tailBlocks !== undefined) {
      params.set('tailBlocks', String(tailBlocks));
    }
    if (typeof options?.knownSessionSignature === 'string' && options.knownSessionSignature.trim().length > 0) {
      params.set('knownSessionSignature', options.knownSessionSignature.trim());
    }
    if (typeof options?.knownBlockOffset === 'number' && Number.isSafeInteger(options.knownBlockOffset) && options.knownBlockOffset >= 0) {
      params.set('knownBlockOffset', String(options.knownBlockOffset));
    }
    if (typeof options?.knownTotalBlocks === 'number' && Number.isSafeInteger(options.knownTotalBlocks) && options.knownTotalBlocks >= 0) {
      params.set('knownTotalBlocks', String(options.knownTotalBlocks));
    }
    if (typeof options?.knownLastBlockId === 'string' && options.knownLastBlockId.trim().length > 0) {
      params.set('knownLastBlockId', options.knownLastBlockId.trim());
    }

    const query = params.toString();
    return get<SessionDetailResult>(`/sessions/${encodeURIComponent(id)}${query ? `?${query}` : ''}`);
  },
  sessionBlock: async (id: string, blockId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readSessionBlock({ sessionId: id, blockId });
    }
    return get<DisplayBlock>(`/sessions/${encodeURIComponent(id)}/blocks/${encodeURIComponent(blockId)}`);
  },
  sessionSearchIndex: async (sessionIds: string[]) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readSessionSearchIndex(sessionIds);
    }
    return post<{ index: Record<string, string> }>('/sessions/search-index', { sessionIds });
  },
  conversationContentSearch: async (query: string, limit = 80) =>
    post<ConversationContentSearchResult>('/sessions/search', { query, limit: normalizeConversationContentSearchLimit(limit) }),
  conversationSummaries: async (sessionIds: string[]) =>
    post<{ summaries: Record<string, ConversationSummaryRecord> }>('/conversation-summaries', { sessionIds }),
  warmRelatedConversationPointers: async (input: { prompt: string; currentConversationId?: string; currentCwd?: string | null }) =>
    post<{ ok: boolean; pointerCount: number }>('/related-conversation-pointers/warm', input),
  skillFolders: async () => get<SkillFoldersState>('/skill-folders'),
  updateSkillFolders: async (skillDirs: string[]) => patch<SkillFoldersState>('/skill-folders', { skillDirs }),
  instructions: async () => get<InstructionFilesState>('/instructions'),
  updateInstructions: async (instructionFiles: string[]) => patch<InstructionFilesState>('/instructions', { instructionFiles }),

  // ── Models ────────────────────────────────────────────────────────────────
  models: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      try {
        const result = await desktopBridge.readModels();
        if (result && result.models && result.models.length > 0) {
          return result;
        }
      } catch {
        // Bridge read failed; fall through to HTTP
      }
    }

    return get<ModelState>('/models');
  },
  modelProviders: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readModelProviders();
    }
    return get<ModelProviderState>('/model-providers');
  },
  saveModelProvider: async (
    provider: string,
    input: {
      baseUrl?: string;
      api?: string;
      apiKey?: string;
      authHeader?: boolean;
      headers?: Record<string, string>;
      compat?: Record<string, unknown>;
      modelOverrides?: Record<string, unknown>;
    },
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.saveModelProvider({ provider, ...input });
    }

    return post<ModelProviderState>('/model-providers/providers', { provider, ...input });
  },
  deleteModelProvider: async (provider: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.deleteModelProvider(provider);
    }

    return del<ModelProviderState>(`/model-providers/providers/${encodeURIComponent(provider)}`);
  },
  saveModelProviderModel: async (
    provider: string,
    input: {
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
    },
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.saveModelProviderModel({ provider, ...input });
    }

    return post<ModelProviderState>(`/model-providers/providers/${encodeURIComponent(provider)}/models`, input);
  },
  deleteModelProviderModel: async (provider: string, modelId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.deleteModelProviderModel({ provider, modelId });
    }

    return del<ModelProviderState>(`/model-providers/providers/${encodeURIComponent(provider)}/models/${encodeURIComponent(modelId)}`);
  },
  defaultCwd: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readDefaultCwd();
    }

    return get<DefaultCwdState>('/default-cwd');
  },
  tools: async () => get<ToolsState>('/tools'),
  setModel: async (model: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.updateModelPreferences({ model });
    }

    return patch<{ ok: boolean }>('/models/current', { model });
  },
  updateModelPreferences: async (input: { model?: string; visionModel?: string; thinkingLevel?: string; serviceTier?: string }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.updateModelPreferences(input);
    }

    return patch<{ ok: boolean }>('/models/current', input);
  },
  updateDefaultCwd: async (cwd: string | null) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.updateDefaultCwd(cwd);
    }

    return patch<DefaultCwdState>('/default-cwd', { cwd });
  },
  transcriptionSettings: async () => get<TranscriptionSettingsState>('/transcription/settings'),
  updateTranscriptionSettings: async (input: { provider?: TranscriptionProviderId | null; model?: string }) => {
    return patch<TranscriptionSettingsState>('/transcription/settings', input);
  },
  installTranscriptionModel: async (input: { provider?: TranscriptionProviderId | null; model?: string }) => {
    return post<TranscriptionInstallResult>('/transcription/install-model', input);
  },
  transcriptionModelStatus: async (input: { provider?: TranscriptionProviderId | null; model?: string }) => {
    return post<TranscriptionModelStatus>('/transcription/model-status', input);
  },
  transcribeFile: async (input: { dataBase64: string; mimeType?: string; fileName?: string; language?: string }) => {
    return post<TranscriptionResult>('/transcription/transcribe-file', input);
  },
  providerAuth: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readProviderAuth();
    }
    return get<ProviderAuthState>('/provider-auth');
  },
  setProviderApiKey: async (provider: string, apiKey: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.setProviderApiKey({ provider, apiKey });
    }

    return patch<ProviderAuthState>(`/provider-auth/${encodeURIComponent(provider)}/api-key`, { apiKey });
  },
  removeProviderCredential: async (provider: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.removeProviderCredential(provider);
    }

    return del<ProviderAuthState>(`/provider-auth/${encodeURIComponent(provider)}`);
  },
  startProviderOAuthLogin: async (provider: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.startProviderOAuthLogin(provider);
    }

    return post<ProviderOAuthLoginState>(`/provider-auth/${encodeURIComponent(provider)}/oauth/start`);
  },
  providerOAuthLogin: async (loginId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readProviderOAuthLogin(loginId);
    }
    return get<ProviderOAuthLoginState | null>(`/provider-auth/oauth/${encodeURIComponent(loginId)}`);
  },
  submitProviderOAuthLoginInput: async (loginId: string, value: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.submitProviderOAuthLoginInput({ loginId, value });
    }

    return post<ProviderOAuthLoginState>(`/provider-auth/oauth/${encodeURIComponent(loginId)}/input`, { input: value });
  },
  cancelProviderOAuthLogin: async (loginId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.cancelProviderOAuthLogin(loginId);
    }

    return post<ProviderOAuthLoginState>(`/provider-auth/oauth/${encodeURIComponent(loginId)}/cancel`);
  },
  openConversationTabs: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readOpenConversationTabs();
    }

    return get<{ sessionIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[]; workspacePaths: string[] }>(
      '/ui/open-conversations',
    );
  },
  setOpenConversationTabs: async (
    sessionIds?: string[] | null,
    pinnedSessionIds?: string[] | null,
    archivedSessionIds?: string[] | null,
    workspacePaths?: string[] | null,
  ) => {
    const request = {
      ...(sessionIds !== undefined ? { sessionIds } : {}),
      ...(pinnedSessionIds !== undefined ? { pinnedSessionIds } : {}),
      ...(archivedSessionIds !== undefined ? { archivedSessionIds } : {}),
      ...(workspacePaths !== undefined ? { workspacePaths } : {}),
    };
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.updateOpenConversationTabs(request);
    }

    return patch<{ ok: boolean; sessionIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[]; workspacePaths: string[] }>(
      '/ui/open-conversations',
      request,
    );
  },
  savedWorkspacePaths: async () => {
    const { workspacePaths } = await api.openConversationTabs();
    return workspacePaths;
  },
  setSavedWorkspacePaths: async (workspacePaths: string[]) => {
    const { workspacePaths: savedPaths } = await api.setOpenConversationTabs(undefined, undefined, undefined, workspacePaths);
    return savedPaths;
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────
  tasks: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readScheduledTasks();
    }
    return get<ScheduledTaskSummary[]>('/tasks');
  },
  taskDetail: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readScheduledTaskDetail(id);
    }
    return get<ScheduledTaskDetail>(`/tasks/${encodeURIComponent(id)}`);
  },
  taskSchedulerHealth: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge?.readScheduledTaskSchedulerHealth && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readScheduledTaskSchedulerHealth();
    }
    return get<ScheduledTaskSchedulerHealth>('/tasks/scheduler-health');
  },
  createTask: async (input: {
    title: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    catchUpWindowSeconds?: number | null;
    prompt: string;
    targetType?: 'background-agent' | 'conversation' | null;
    threadMode?: 'dedicated' | 'existing' | 'none' | null;
    threadConversationId?: string | null;
  }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.createScheduledTask(input);
    }

    return post<{ ok: boolean; task: ScheduledTaskDetail }>('/tasks', input);
  },
  setTaskEnabled: async (id: string, enabled: boolean) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.updateScheduledTask({ taskId: id, enabled });
    }

    return patch<{ ok: boolean; task: ScheduledTaskDetail }>(`/tasks/${encodeURIComponent(id)}`, { enabled });
  },
  saveTask: async (
    id: string,
    input: {
      title?: string;
      enabled?: boolean;
      cron?: string | null;
      at?: string | null;
      model?: string | null;
      thinkingLevel?: string | null;
      cwd?: string | null;
      timeoutSeconds?: number | null;
      catchUpWindowSeconds?: number | null;
      prompt?: string;
      targetType?: 'background-agent' | 'conversation' | null;
      threadMode?: 'dedicated' | 'existing' | 'none' | null;
      threadConversationId?: string | null;
    },
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.updateScheduledTask({ taskId: id, ...input });
    }

    return patch<{ ok: boolean; task: ScheduledTaskDetail }>(`/tasks/${encodeURIComponent(id)}`, input);
  },
  taskLog: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readScheduledTaskLog(id);
    }
    return get<{ log: string; path: string }>(`/tasks/${encodeURIComponent(id)}/log`);
  },
  deleteTask: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.deleteScheduledTask(id);
    }

    return del<{ ok: true; deleted: boolean }>(`/tasks/${encodeURIComponent(id)}`);
  },
  runTaskNow: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.runScheduledTask(id);
    }

    return post<{ ok: boolean; accepted: boolean; runId: string }>(`/tasks/${encodeURIComponent(id)}/run`);
  },
  automations: {
    list: () => api.tasks(),
    get: (taskId: string) => api.taskDetail(taskId),
    create: (input: Parameters<typeof api.createTask>[0]) => api.createTask(input),
    update: (taskId: string, input: Parameters<typeof api.saveTask>[1]) => api.saveTask(taskId, input),
    delete: (taskId: string) => api.deleteTask(taskId),
    run: (taskId: string) => api.runTaskNow(taskId),
    readLog: (taskId: string) => api.taskLog(taskId),
    readSchedulerHealth: () => api.taskSchedulerHealth(),
  },
  runs: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readDurableRuns();
    }
    return get<DurableRunListResult>('/runs');
  },
  durableRun: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readDurableRun(id);
    }
    return get<DurableRunDetailResult>(`/runs/${encodeURIComponent(id)}`);
  },
  durableRunLog: async (id: string, tail?: number) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readDurableRunLog({ runId: id, tail });
    }

    const normalizedTail = normalizeDurableRunLogTailParam(tail);
    return get<{ log: string; path: string }>(
      `/runs/${encodeURIComponent(id)}/log${normalizedTail ? `?tail=${encodeURIComponent(String(normalizedTail))}` : ''}`,
    );
  },
  markDurableRunAttentionRead: async (id: string, read = true) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.markDurableRunAttention({ runId: id, read });
    }

    return patch<{ ok: boolean }>(`/runs/${encodeURIComponent(id)}/attention`, { read });
  },
  cancelDurableRun: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.cancelDurableRun(id);
    }

    return post<{ cancelled: boolean; runId: string }>(`/runs/${encodeURIComponent(id)}/cancel`);
  },

  // ── Workspace helpers ────────────────────────────────────────────────────
  pickFolder: async (input?: string | { cwd?: string | null; prompt?: string | null }) => {
    const request =
      typeof input === 'string'
        ? { cwd: input }
        : {
            ...(input?.cwd !== undefined ? { cwd: input.cwd } : {}),
            ...(typeof input?.prompt === 'string' && input.prompt.trim().length > 0 ? { prompt: input.prompt.trim() } : {}),
          };
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.pickFolder(request);
    }

    return post<FolderPickerResult>('/folder-picker', request);
  },
  remoteDirectory: async (hostId: string, path?: string | null) => {
    const desktopBridge = getDesktopBridge();
    if (!desktopBridge || !(await shouldUseDesktopLocalCapabilities())) {
      throw new Error('Remote directory browsing is only available in the desktop app.');
    }

    return desktopBridge.readRemoteDirectory({ hostId, ...(path !== undefined ? { path } : {}) }) as Promise<DesktopRemoteDirectoryListing>;
  },
  pickFiles: async (cwd?: string) => post<FilePickerResult>('/file-picker', cwd !== undefined ? { cwd } : {}),

  // ── Memory browser ────────────────────────────────────────────────────────
  memory: () => getMemoryData(),

  markConversationAttentionRead: async (id: string, read = true) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.markConversationAttention({ conversationId: id, read });
    }

    return patch<{ ok: boolean }>(`/conversations/${encodeURIComponent(id)}/attention`, { read });
  },

  // ── Live sessions ─────────────────────────────────────────────────────────
  liveSession: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readLiveSession(id);
    }
    return get<LiveSessionMeta & { live: boolean }>(`/live-sessions/${id}`);
  },
  liveSessionContext: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readLiveSessionContext(id);
    }
    return get<LiveSessionContext>(`/live-sessions/${id}/context`);
  },
  workspaceTree: async (cwd: string, path = '') => {
    const params = new URLSearchParams({ cwd });
    if (path) params.set('path', path);
    return get<WorkspaceDirectoryListing>(`/workspace/tree?${params.toString()}`);
  },
  workspaceFile: async (cwd: string, path: string, options?: { force?: boolean }) => {
    const params = new URLSearchParams({ cwd, path });
    if (options?.force) params.set('force', '1');
    return get<WorkspaceFileContent>(`/workspace/file?${params.toString()}`);
  },
  workspaceDiff: async (cwd: string, path: string) => {
    const params = new URLSearchParams({ cwd, path });
    return get<WorkspaceDiffOverlay>(`/workspace/diff?${params.toString()}`);
  },
  workspaceUncommittedDiff: async (cwd: string) => {
    return get<UncommittedDiffResult>(`/workspace/uncommitted-diff?cwd=${encodeURIComponent(cwd)}`);
  },
  writeWorkspaceFile: async (cwd: string, path: string, content: string) =>
    put<WorkspaceFileContent>('/workspace/file', { cwd, path, content }),
  createWorkspaceFile: async (cwd: string, path: string, content = '') =>
    put<WorkspaceFileContent>('/workspace/file', { cwd, path, content }),
  createWorkspaceFolder: async (cwd: string, path: string) => post<WorkspaceEntry>('/workspace/folder', { cwd, path }),
  deleteWorkspacePath: async (cwd: string, path: string) => {
    const params = new URLSearchParams({ cwd, path });
    return del<{ ok: boolean }>(`/workspace/path?${params.toString()}`);
  },
  renameWorkspacePath: async (cwd: string, path: string, newName: string) =>
    post<WorkspaceEntry>('/workspace/rename', { cwd, path, newName }),
  moveWorkspacePath: async (cwd: string, path: string, targetDir: string) =>
    post<WorkspaceEntry>('/workspace/move', { cwd, path, targetDir }),
  conversationBootstrap: async (
    id: string,
    options?: {
      tailBlocks?: number;
      knownSessionSignature?: string;
      knownBlockOffset?: number;
      knownTotalBlocks?: number;
      knownLastBlockId?: string;
    },
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readConversationBootstrap({ conversationId: id, ...options });
    }

    const params = new URLSearchParams();
    const tailBlocks = normalizeTailBlocksParam(options?.tailBlocks);
    if (tailBlocks !== undefined) {
      params.set('tailBlocks', String(tailBlocks));
    }
    if (typeof options?.knownSessionSignature === 'string' && options.knownSessionSignature.trim().length > 0) {
      params.set('knownSessionSignature', options.knownSessionSignature.trim());
    }
    if (typeof options?.knownBlockOffset === 'number' && Number.isSafeInteger(options.knownBlockOffset) && options.knownBlockOffset >= 0) {
      params.set('knownBlockOffset', String(options.knownBlockOffset));
    }
    if (typeof options?.knownTotalBlocks === 'number' && Number.isSafeInteger(options.knownTotalBlocks) && options.knownTotalBlocks >= 0) {
      params.set('knownTotalBlocks', String(options.knownTotalBlocks));
    }
    if (typeof options?.knownLastBlockId === 'string' && options.knownLastBlockId.trim().length > 0) {
      params.set('knownLastBlockId', options.knownLastBlockId.trim());
    }

    const query = params.toString();
    return get<ConversationBootstrapState>(`/conversations/${encodeURIComponent(id)}/bootstrap${query ? `?${query}` : ''}`);
  },
  conversationPlansWorkspace: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readConversationPlansWorkspace();
    }

    return get<ConversationAutomationWorkspaceState>('/conversation-plans/workspace');
  },
  conversationArtifacts: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readConversationArtifacts(id);
    }

    return get<{ conversationId: string; artifacts: ConversationArtifactSummary[] }>(`/conversations/${encodeURIComponent(id)}/artifacts`);
  },
  conversationArtifact: async (id: string, artifactId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readConversationArtifact({ conversationId: id, artifactId });
    }

    return get<{ conversationId: string; artifact: ConversationArtifactRecord }>(
      `/conversations/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}`,
    );
  },
  conversationCheckpoints: async (id: string) =>
    get<{ conversationId: string; checkpoints: ConversationCommitCheckpointSummary[] }>(
      `/conversations/${encodeURIComponent(id)}/checkpoints`,
    ),
  conversationCheckpoint: async (id: string, checkpointId: string) =>
    get<{ conversationId: string; checkpoint: ConversationCommitCheckpointRecord }>(
      `/conversations/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}`,
    ),
  conversationCheckpointReviewContext: async (id: string, checkpointId: string) => {
    return get<ConversationCheckpointReviewContext>(
      `/conversations/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/review-context`,
    );
  },
  createConversationCheckpointComment: async (id: string, checkpointId: string, input: { body: string; filePath?: string }) => {
    return post<{ conversationId: string; checkpoint: ConversationCommitCheckpointRecord }>(
      `/conversations/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/comments`,
      input,
    );
  },
  conversationContextDocs: async (id: string) => {
    return get<{ conversationId: string; attachedContextDocs: ConversationContextDocRef[] }>(
      `/conversations/${encodeURIComponent(id)}/context-docs`,
    );
  },
  updateConversationContextDocs: async (id: string, docs: ConversationContextDocRef[]) => {
    return patch<{ conversationId: string; attachedContextDocs: ConversationContextDocRef[] }>(
      `/conversations/${encodeURIComponent(id)}/context-docs`,
      { docs },
    );
  },
  conversationAttachments: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readConversationAttachments(id);
    }

    return get<{ conversationId: string; attachments: ConversationAttachmentSummary[] }>(
      `/conversations/${encodeURIComponent(id)}/attachments`,
    );
  },
  conversationAttachment: async (id: string, attachmentId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readConversationAttachment({ conversationId: id, attachmentId });
    }

    return get<{ conversationId: string; attachment: ConversationAttachmentRecord }>(
      `/conversations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  },
  conversationAttachmentAsset: async (
    id: string,
    attachmentId: string,
    asset: 'source' | 'preview',
    revision?: number,
  ): Promise<ConversationAttachmentAssetData> => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readConversationAttachmentAsset({ conversationId: id, attachmentId, asset, revision });
    }

    const params = new URLSearchParams();
    if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0) {
      params.set('revision', String(revision));
    }
    const requestPath = buildApiPath(
      `/conversations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}/download/${asset}${
        params.toString() ? `?${params.toString()}` : ''
      }`,
    );
    const response = await fetchWithRetry(requestPath, { method: 'GET', cache: 'no-store' });
    recordApiTiming(requestPath, response);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition') ?? '';
    const fileName = contentDisposition.match(/filename="([^"]+)"/)?.[1] ?? `${asset}`;
    return {
      dataUrl: await blobToDataUrl(blob),
      mimeType: blob.type || 'application/octet-stream',
      fileName,
    };
  },
  createConversationAttachment: async (
    id: string,
    input: {
      kind?: 'excalidraw';
      title?: string;
      sourceData: string;
      sourceName?: string;
      sourceMimeType?: string;
      previewData: string;
      previewName?: string;
      previewMimeType?: string;
      note?: string;
    },
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.createConversationAttachment({ conversationId: id, ...input });
    }

    return post<{
      conversationId: string;
      attachment: ConversationAttachmentRecord;
      attachments: ConversationAttachmentSummary[];
    }>(`/conversations/${encodeURIComponent(id)}/attachments`, input);
  },
  updateConversationAttachment: async (
    id: string,
    attachmentId: string,
    input: {
      title?: string;
      sourceData: string;
      sourceName?: string;
      sourceMimeType?: string;
      previewData: string;
      previewName?: string;
      previewMimeType?: string;
      note?: string;
    },
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.updateConversationAttachment({ conversationId: id, attachmentId, ...input });
    }

    return patch<{
      conversationId: string;
      attachment: ConversationAttachmentRecord;
      attachments: ConversationAttachmentSummary[];
    }>(`/conversations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`, input);
  },
  deferredResumes: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readConversationDeferredResumes(id);
    }

    return get<{ conversationId: string; resumes: DeferredResumeSummary[] }>(`/conversations/${encodeURIComponent(id)}/deferred-resumes`);
  },
  scheduleDeferredResume: async (id: string, input: { delay: string; prompt?: string; behavior?: 'steer' | 'followUp' }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.scheduleConversationDeferredResume({ conversationId: id, ...input });
    }

    return requestJson<{ conversationId: string; resume: DeferredResumeSummary; resumes: DeferredResumeSummary[] }>(
      'POST',
      `/conversations/${encodeURIComponent(id)}/deferred-resumes`,
      input,
    );
  },
  fireDeferredResumeNow: async (id: string, resumeId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.fireConversationDeferredResume({ conversationId: id, resumeId });
    }

    return requestJson<{ conversationId: string; resume: DeferredResumeSummary; resumes: DeferredResumeSummary[] }>(
      'POST',
      `/conversations/${encodeURIComponent(id)}/deferred-resumes/${encodeURIComponent(resumeId)}/fire`,
    );
  },
  cancelDeferredResume: async (id: string, resumeId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.cancelConversationDeferredResume({ conversationId: id, resumeId });
    }

    return requestJson<{ conversationId: string; cancelledId: string; resumes: DeferredResumeSummary[] }>(
      'DELETE',
      `/conversations/${encodeURIComponent(id)}/deferred-resumes/${encodeURIComponent(resumeId)}`,
    );
  },
  changeConversationCwd: async (id: string, cwd: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.changeConversationCwd({
        conversationId: id,
        cwd,
        ...(surfaceId ? { surfaceId } : {}),
      });
    }

    return requestJson<ConversationCwdChangeResult>('POST', `/conversations/${encodeURIComponent(id)}/cwd`, {
      cwd,
      ...(surfaceId ? { surfaceId } : {}),
    });
  },
  duplicateConversation: async (id: string) => {
    return requestJson<{ newSessionId: string; sessionFile: string }>('POST', `/conversations/${encodeURIComponent(id)}/duplicate`);
  },
  renameConversation: async (id: string, name: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.renameConversation({
        conversationId: id,
        name,
        ...(surfaceId ? { surfaceId } : {}),
      });
    }

    return patch<{ ok: boolean; title: string }>(`/conversations/${encodeURIComponent(id)}/title`, {
      name,
      ...(surfaceId ? { surfaceId } : {}),
    });
  },
  conversationAutoMode: async (id: string) => {
    return get<ConversationAutoModeState>(`/conversations/${encodeURIComponent(id)}/auto-mode`);
  },
  updateConversationAutoMode: async (
    id: string,
    input: {
      enabled?: boolean;
      mode?: 'manual' | 'nudge' | 'mission' | 'loop';
      mission?: import('../shared/types').MissionState;
      loop?: import('../shared/types').LoopState;
    },
    surfaceId?: string,
  ) => {
    return patch<ConversationAutoModeState>(`/conversations/${encodeURIComponent(id)}/auto-mode`, {
      ...input,
      ...(surfaceId ? { surfaceId } : {}),
    });
  },
  conversationModelPreferences: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readConversationModelPreferences({ conversationId: id });
    }
    return get<{ currentModel: string; currentThinkingLevel: string; currentServiceTier: string; hasExplicitServiceTier: boolean }>(
      `/conversations/${encodeURIComponent(id)}/model-preferences`,
    );
  },
  updateConversationModelPreferences: async (
    id: string,
    input: { model?: string | null; thinkingLevel?: string | null; serviceTier?: string | null },
    surfaceId?: string,
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.updateConversationModelPreferences({
        conversationId: id,
        ...input,
        ...(surfaceId ? { surfaceId } : {}),
      });
    }

    return patch<{ currentModel: string; currentThinkingLevel: string; currentServiceTier: string; hasExplicitServiceTier: boolean }>(
      `/conversations/${encodeURIComponent(id)}/model-preferences`,
      { ...input, ...(surfaceId ? { surfaceId } : {}) },
    );
  },
  recoverConversation: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.recoverConversation(id);
    }

    return post<ConversationRecoveryResult>(`/conversations/${encodeURIComponent(id)}/recover`);
  },
  continueConversationInHost: async (id: string, hostId: string, cwd?: string | null) => {
    const desktopBridge = getDesktopBridge();
    if (!desktopBridge || !(await shouldUseDesktopLocalCapabilities())) {
      throw new Error('Continue in is only available in the desktop app.');
    }

    return desktopBridge.continueConversationInHost({ conversationId: id, hostId, ...(cwd !== undefined ? { cwd } : {}) });
  },

  createLiveSession: async (
    cwd?: string,
    text?: string,
    options?: { workspaceCwd?: string | null; model?: string | null; thinkingLevel?: string | null; serviceTier?: string | null },
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.createLiveSession({
        cwd,
        ...(options?.workspaceCwd !== undefined ? { workspaceCwd: options.workspaceCwd } : {}),
        ...(options?.model !== undefined ? { model: options.model } : {}),
        ...(options?.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
        ...(options?.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
      });
    }

    return post<LiveSessionCreateResult>('/live-sessions', {
      cwd,
      text,
      ...(options?.workspaceCwd !== undefined ? { workspaceCwd: options.workspaceCwd } : {}),
      ...(options?.model !== undefined ? { model: options.model } : {}),
      ...(options?.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
      ...(options?.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
    });
  },

  resumeSession: async (sessionFile: string, cwd?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.resumeLiveSession({ sessionFile, ...(cwd ? { cwd } : {}) });
    }

    return post<{ id: string }>('/live-sessions/resume', { sessionFile, ...(cwd ? { cwd } : {}) });
  },

  promptSession: async (
    id: string,
    text: string,
    behavior?: 'steer' | 'followUp',
    images?: PromptImageInput[],
    attachmentRefs?: PromptAttachmentRefInput[],
    surfaceId?: string,
    contextMessages?: Array<Pick<InjectedPromptMessage, 'customType' | 'content'>>,
    relatedConversationIds?: string[],
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.submitLiveSessionPrompt({
        conversationId: id,
        text,
        behavior,
        ...(surfaceId ? { surfaceId } : {}),
        images,
        attachmentRefs,
        contextMessages,
        relatedConversationIds,
      });
    }

    return post<{ ok: boolean; accepted: boolean; delivery: 'started' | 'queued'; relatedConversationPointerWarnings?: string[] }>(
      `/live-sessions/${id}/prompt`,
      {
        text,
        behavior,
        ...(surfaceId ? { surfaceId } : {}),
        images: images?.map((image) => ({
          type: 'image' as const,
          data: image.data,
          mimeType: image.mimeType,
          ...(image.name ? { name: image.name } : {}),
        })),
        attachmentRefs: attachmentRefs?.map((attachmentRef) => ({
          attachmentId: attachmentRef.attachmentId,
          ...(attachmentRef.revision ? { revision: attachmentRef.revision } : {}),
        })),
        contextMessages: contextMessages?.map((message) => ({
          customType: message.customType,
          content: message.content,
        })),
        relatedConversationIds,
      },
    );
  },
  parallelPromptSession: async (
    id: string,
    text: string,
    images?: PromptImageInput[],
    attachmentRefs?: PromptAttachmentRefInput[],
    surfaceId?: string,
    contextMessages?: Array<Pick<InjectedPromptMessage, 'customType' | 'content'>>,
    relatedConversationIds?: string[],
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.submitLiveSessionParallelPrompt({
        conversationId: id,
        text,
        ...(surfaceId ? { surfaceId } : {}),
        images,
        attachmentRefs,
        contextMessages,
        relatedConversationIds,
      });
    }

    return post<{
      ok: boolean;
      accepted: boolean;
      jobId: string;
      childConversationId: string;
      relatedConversationPointerWarnings?: string[];
    }>(`/live-sessions/${id}/parallel-prompt`, {
      text,
      ...(surfaceId ? { surfaceId } : {}),
      images: images?.map((image) => ({
        type: 'image' as const,
        data: image.data,
        mimeType: image.mimeType,
        ...(image.name ? { name: image.name } : {}),
      })),
      attachmentRefs: attachmentRefs?.map((attachmentRef) => ({
        attachmentId: attachmentRef.attachmentId,
        ...(attachmentRef.revision ? { revision: attachmentRef.revision } : {}),
      })),
      contextMessages: contextMessages?.map((message) => ({
        customType: message.customType,
        content: message.content,
      })),
      relatedConversationIds,
    });
  },
  manageParallelPromptJob: async (id: string, jobId: string, action: 'importNow' | 'skip' | 'cancel', surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.manageLiveSessionParallelJob({
        conversationId: id,
        jobId,
        action,
        ...(surfaceId ? { surfaceId } : {}),
      });
    }

    return post<{ ok: true; status: 'imported' | 'queued' | 'skipped' | 'cancelled' }>(
      `/live-sessions/${id}/parallel-jobs/${encodeURIComponent(jobId)}`,
      {
        action,
        ...(surfaceId ? { surfaceId } : {}),
      },
    );
  },
  executeLiveSessionBash: async (id: string, command: string, options?: { excludeFromContext?: boolean }) => {
    return post<{ ok: boolean; result: unknown }>(`/live-sessions/${id}/bash`, {
      command,
      excludeFromContext: options?.excludeFromContext === true,
    });
  },
  restoreQueuedMessage: async (
    id: string,
    input: { behavior: 'steer' | 'followUp'; index: number; previewId?: string },
    surfaceId?: string,
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.restoreQueuedLiveSessionMessage({
        conversationId: id,
        ...input,
      });
    }

    return post<{ ok: boolean; text: string; images: PromptImageInput[] }>(`/live-sessions/${id}/dequeue`, {
      ...input,
      ...(surfaceId ? { surfaceId } : {}),
    });
  },
  takeoverLiveSession: async (id: string, surfaceId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.takeOverLiveSession({ conversationId: id, surfaceId });
    }

    return post<LiveSessionPresenceState>(`/live-sessions/${id}/takeover`, { surfaceId });
  },
  compactSession: async (id: string, customInstructions?: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.compactLiveSession({ conversationId: id, ...(customInstructions ? { customInstructions } : {}) });
    }

    return post<{ ok: boolean; result: unknown }>(`/live-sessions/${id}/compact`, {
      customInstructions,
      ...(surfaceId ? { surfaceId } : {}),
    });
  },
  reloadSession: async (id: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.reloadLiveSession(id);
    }

    return post<{ ok: boolean }>(`/live-sessions/${id}/reload`, surfaceId ? { surfaceId } : {});
  },
  exportSession: async (id: string, outputPath?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.exportLiveSession({
        conversationId: id,
        ...(outputPath ? { outputPath } : {}),
      });
    }

    return post<LiveSessionExportResult>(`/live-sessions/${id}/export`, { outputPath });
  },
  abortSession: async (id: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.abortLiveSession(id);
    }

    return post<{ ok: boolean }>(`/live-sessions/${id}/abort`, surfaceId ? { surfaceId } : {});
  },

  destroySession: async (id: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.destroyLiveSession(id);
    }

    return requestJson<{ ok: boolean }>('DELETE', `/live-sessions/${encodeURIComponent(id)}`, surfaceId ? { surfaceId } : {});
  },

  forkEntries: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalCapabilities())) {
      return desktopBridge.readLiveSessionForkEntries(id);
    }
    return get<LiveSessionForkEntry[]>(`/live-sessions/${id}/fork-entries`);
  },
  branchSession: async (id: string, entryId: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.branchLiveSession({ conversationId: id, entryId });
    }

    return post<{ newSessionId: string; sessionFile: string }>(`/live-sessions/${id}/branch`, {
      entryId,
      ...(surfaceId ? { surfaceId } : {}),
    });
  },
  forkSession: async (id: string, entryId: string, options?: { preserveSource?: boolean; beforeEntry?: boolean }, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && (await shouldUseDesktopLocalConversationCapabilities(id))) {
      return desktopBridge.forkLiveSession({
        conversationId: id,
        entryId,
        preserveSource: options?.preserveSource,
        beforeEntry: options?.beforeEntry,
      });
    }

    return post<{ newSessionId: string; sessionFile: string }>(`/live-sessions/${id}/fork`, {
      entryId,
      preserveSource: options?.preserveSource,
      beforeEntry: options?.beforeEntry,
      ...(surfaceId ? { surfaceId } : {}),
    });
  },

  gateways: async () => get<GatewayState>('/gateways'),
  ensureGatewayConnection: async (provider: GatewayProviderId) => post<GatewayState>('/gateways/connections', { provider }),
  updateGatewayConnection: async (
    provider: GatewayProviderId,
    input: { status: GatewayStatus; enabled?: boolean; statusMessage?: string },
  ) => patch<GatewayState>(`/gateways/connections/${encodeURIComponent(provider)}`, input),
  attachGatewayConversation: async (input: {
    provider: GatewayProviderId;
    conversationId: string;
    conversationTitle?: string;
    externalChatId?: string;
    externalChatLabel?: string;
  }) => post<GatewayState>('/gateways/bindings', input),
  detachGatewayConversation: async (conversationId: string, provider?: GatewayProviderId) =>
    del<GatewayState>(
      `/gateways/bindings/${encodeURIComponent(conversationId)}${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`,
    ),
  telegramGatewayToken: async () => get<{ configured: boolean }>('/gateways/telegram/token'),
  saveTelegramGatewayToken: async (token: string) =>
    post<{ configured: boolean; state: GatewayState }>('/gateways/telegram/token', { token }),
  deleteTelegramGatewayToken: async () => del<{ configured: boolean; state: GatewayState }>('/gateways/telegram/token'),
  saveTelegramGatewayChat: async (chatId: string) => post<GatewayState>('/gateways/telegram/chat', { chatId }),
  slackMcpAuthState: async () => get<{ authenticated: boolean }>('/gateways/slack-mcp/auth'),
  connectSlackMcp: async () => post<{ authenticated: boolean; state: GatewayState }>('/gateways/slack-mcp/auth', {}),
  disconnectSlackMcp: async () => del<{ authenticated: boolean; state: GatewayState }>('/gateways/slack-mcp/auth'),
  saveSlackMcpChannel: async (input: { channelId: string; channelLabel?: string }) =>
    post<GatewayState>('/gateways/slack-mcp/channel', input),
  attachSlackMcpChannel: async (input: {
    conversationId: string;
    conversationTitle?: string;
    externalChatId: string;
    externalChatLabel?: string;
  }) => post<GatewayState>('/gateways/slack-mcp/attach', input),

  // ── Traces ────────────────────────────────────────────────────────────
  tracesSummary: (range?: string) => get<TraceSummary>(`/traces/summary${range ? `?range=${range}` : ''}`),
  tracesModelUsage: (range?: string) =>
    get<{ models: TraceModelUsage[]; throughput: TraceThroughput[] }>(`/traces/model-usage${range ? `?range=${range}` : ''}`),
  tracesCostByConversation: (range?: string) => get<TraceCostRow[]>(`/traces/cost-by-conversation${range ? `?range=${range}` : ''}`),
  tracesToolHealth: (range?: string) => get<TraceToolHealth[]>(`/traces/tool-health${range ? `?range=${range}` : ''}`),
  tracesContext: (range?: string) => get<TraceContextResponse>(`/traces/context${range ? `?range=${range}` : ''}`),
  tracesAgentLoop: (range?: string) => get<TraceAgentLoop | null>(`/traces/agent-loop${range ? `?range=${range}` : ''}`),
  tracesTokensDaily: (range?: string) => get<TraceTokenDaily[]>(`/traces/tokens-daily${range ? `?range=${range}` : ''}`),
  tracesToolFlow: (range?: string) => get<ToolFlowResult>(`/traces/tool-flow${range ? `?range=${range}` : ''}`),
  tracesAutoMode: (range?: string) => get<AutoModeSummary>(`/traces/auto-mode${range ? `?range=${range}` : ''}`),
  tracesCacheEfficiency: (range?: string) =>
    get<{ series: CacheEfficiencyPoint[]; aggregate: CacheEfficiencyAggregate }>(
      `/traces/cache-efficiency${range ? `?range=${range}` : ''}`,
    ),
  tracesSystemPrompt: (range?: string) =>
    get<{ series: SystemPromptPoint[]; aggregate: SystemPromptAggregate }>(`/traces/system-prompt${range ? `?range=${range}` : ''}`),
  tracesContextPointers: (range?: string) => get<ContextPointerUsageResult>(`/traces/context-pointers${range ? `?range=${range}` : ''}`),

  // ── Unified settings store ──────────────────────────────────────

  settings: async () => get<Record<string, unknown>>('/settings'),
  settingsSchema: async () =>
    get<
      Array<{
        extensionId: string;
        key: string;
        type: string;
        default?: unknown;
        description?: string;
        group: string;
        enum?: string[];
        placeholder?: string;
        order: number;
      }>
    >('/settings/schema'),
  updateSettings: async (overrides: Record<string, unknown>) => patch<Record<string, unknown>>('/settings', overrides),
};
