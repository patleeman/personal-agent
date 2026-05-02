import type { AppStatus, ConversationArtifactRecord, ConversationArtifactSummary, ConversationAttachmentAssetData, ConversationAttachmentRecord, ConversationAttachmentSummary, ConversationAutoModeState, ConversationAutomationWorkspaceState, ConversationBootstrapState, ConversationCheckpointReviewContext, ConversationCommitCheckpointRecord, ConversationCommitCheckpointSummary, ConversationContentSearchResult, ConversationContextDocRef, ConversationCwdChangeResult, ConversationRecoveryResult, ConversationSummaryRecord, ConversationTitleSettingsState, DaemonState, DefaultCwdState, DeferredResumeSummary, DesktopEnvironmentState, DesktopRemoteDirectoryListing, DisplayBlock, DurableRunDetailResult, DurableRunListResult, FilePickerResult, FolderPickerResult, InjectedPromptMessage, InstructionFilesState, KnowledgeBaseState, LiveSessionContext, LiveSessionCreateResult, LiveSessionExportResult, LiveSessionForkEntry, LiveSessionMeta, LiveSessionPresenceState, MemoryData, ModelProviderState, ModelState, PromptAttachmentRefInput, PromptImageInput, ProviderAuthState, ProviderOAuthLoginState, ScheduledTaskDetail, ScheduledTaskSummary, SessionDetailResult, SessionMeta, SkillFoldersState, ToolsState, TranscriptionInstallResult, TranscriptionModelStatus, TranscriptionProviderId, TranscriptionResult, TranscriptionSettingsState, UncommittedDiffResult, VaultBacklinksResult, VaultEntry, VaultFileContent, VaultFileListResult, VaultImageUploadResult, VaultSearchResponse, VaultShareImportResult, VaultTreeResult, WorkspaceDiffOverlay, WorkspaceDirectoryListing, WorkspaceFileContent } from '../shared/types';
import { buildApiPath } from './apiBase';
import { getDesktopBridge, readDesktopEnvironment } from '../desktop/desktopBridge';
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
    const data = await res.json() as { error?: string };
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

function withViewProfile(path: string, profile?: string): string {
  if (!profile) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}viewProfile=${encodeURIComponent(profile)}`;
}

const pendingMemoryRequests = new Map<string, Promise<MemoryData>>();
const KNOWLEDGE_BASE_CACHE_TTL_MS = 3_000;
let pendingKnowledgeBaseRequest: Promise<KnowledgeBaseState> | null = null;
let cachedKnowledgeBaseState: KnowledgeBaseState | null = null;
let cachedKnowledgeBaseReadAtMs = 0;
let desktopEnvironmentPromise: Promise<DesktopEnvironmentState | null> | null = null;

function buildMemoryRequestKey(options?: { profile?: string }): string {
  return options?.profile?.trim() || '__current__';
}

async function getMemoryData(options?: { profile?: string }): Promise<MemoryData> {
  const cacheKey = buildMemoryRequestKey(options);
  const pending = pendingMemoryRequests.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = get<MemoryData>(withViewProfile('/memory', options?.profile)).finally(() => {
    pendingMemoryRequests.delete(cacheKey);
  });
  pendingMemoryRequests.set(cacheKey, request);
  return request;
}

async function getKnowledgeBaseState(): Promise<KnowledgeBaseState> {
  if (pendingKnowledgeBaseRequest) {
    return pendingKnowledgeBaseRequest;
  }

  if (cachedKnowledgeBaseState && Date.now() - cachedKnowledgeBaseReadAtMs < KNOWLEDGE_BASE_CACHE_TTL_MS) {
    return cachedKnowledgeBaseState;
  }

  const request = get<KnowledgeBaseState>('/knowledge-base')
    .then((state) => {
      cachedKnowledgeBaseState = state;
      cachedKnowledgeBaseReadAtMs = Date.now();
      return state;
    })
    .finally(() => {
      if (pendingKnowledgeBaseRequest === request) {
        pendingKnowledgeBaseRequest = null;
      }
    });
  pendingKnowledgeBaseRequest = request;
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
  if (!getDesktopBridge() || !await shouldUseDesktopLocalCapabilities()) {
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
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(1000, value)
    : undefined;
}

export function normalizeDurableRunLogTailParam(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(1000, value)
    : undefined;
}

export function normalizeConversationContentSearchLimit(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(100, value)
    : 80;
}

export function normalizeVaultSearchLimit(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(50, value)
    : 20;
}

export const api = {
  // ── Core ──────────────────────────────────────────────────────────────────
  status:       async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readAppStatus();
    }
    return get<AppStatus>('/status');
  },
  daemon:       async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readDaemonState();
    }
    return get<DaemonState>('/daemon');
  },
  updateDaemonPower: async (input: { keepAwake: boolean }) => patch<DaemonState>('/daemon/power', input),
  sessions:     async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readSessions();
    }
    return get<SessionMeta[]>('/sessions');
  },
  sessionMeta:  async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readSessionMeta(id);
    }
    return get<SessionMeta>(`/sessions/${encodeURIComponent(id)}/meta`);
  },
  sessionDetail: async (id: string, options?: {
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
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
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readSessionBlock({ sessionId: id, blockId });
    }
    return get<DisplayBlock>(`/sessions/${encodeURIComponent(id)}/blocks/${encodeURIComponent(blockId)}`);
  },
  sessionSearchIndex: async (sessionIds: string[]) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readSessionSearchIndex(sessionIds);
    }
    return post<{ index: Record<string, string> }>('/sessions/search-index', { sessionIds });
  },
  conversationContentSearch: async (query: string, limit = 80) => post<ConversationContentSearchResult>('/sessions/search', { query, limit: normalizeConversationContentSearchLimit(limit) }),
  conversationSummaries: async (sessionIds: string[]) => post<{ summaries: Record<string, ConversationSummaryRecord> }>('/conversation-summaries', { sessionIds }),
  warmRelatedConversationPointers: async (input: { prompt: string; currentConversationId?: string; currentCwd?: string | null }) => post<{ ok: boolean; pointerCount: number }>('/related-conversation-pointers/warm', input),
  skillFolders: async () => get<SkillFoldersState>('/skill-folders'),
  updateSkillFolders: async (skillDirs: string[]) => patch<SkillFoldersState>('/skill-folders', { skillDirs }),
  instructions: async () => get<InstructionFilesState>('/instructions'),
  updateInstructions: async (instructionFiles: string[]) => patch<InstructionFilesState>('/instructions', { instructionFiles }),

  // ── Models ────────────────────────────────────────────────────────────────
  models: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
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
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readModelProviders();
    }
    return get<ModelProviderState>('/model-providers');
  },
  saveModelProvider: async (provider: string, input: {
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    authHeader?: boolean;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
    modelOverrides?: Record<string, unknown>;
  }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.saveModelProvider({ provider, ...input });
    }

    return post<ModelProviderState>('/model-providers/providers', { provider, ...input });
  },
  deleteModelProvider: async (provider: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.deleteModelProvider(provider);
    }

    return del<ModelProviderState>(`/model-providers/providers/${encodeURIComponent(provider)}`);
  },
  saveModelProviderModel: async (provider: string, input: {
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
  }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.saveModelProviderModel({ provider, ...input });
    }

    return post<ModelProviderState>(`/model-providers/providers/${encodeURIComponent(provider)}/models`, input);
  },
  deleteModelProviderModel: async (provider: string, modelId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.deleteModelProviderModel({ provider, modelId });
    }

    return del<ModelProviderState>(`/model-providers/providers/${encodeURIComponent(provider)}/models/${encodeURIComponent(modelId)}`);
  },
  defaultCwd: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readDefaultCwd();
    }

    return get<DefaultCwdState>('/default-cwd');
  },
  knowledgeBase: async () => {
    return getKnowledgeBaseState();
  },
  vaultFiles: async () => {
    return get<VaultFileListResult>('/vault-files');
  },
  tools: async (options?: { profile?: string }) => get<ToolsState>(withViewProfile('/tools', options?.profile)),
  setModel: async (model: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.updateModelPreferences({ model });
    }

    return patch<{ ok: boolean }>('/models/current', { model });
  },
  updateModelPreferences: async (input: { model?: string; thinkingLevel?: string; serviceTier?: string }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.updateModelPreferences(input);
    }

    return patch<{ ok: boolean }>('/models/current', input);
  },
  updateDefaultCwd: async (cwd: string | null) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.updateDefaultCwd(cwd);
    }

    return patch<DefaultCwdState>('/default-cwd', { cwd });
  },
  updateKnowledgeBase: async (input: { repoUrl?: string | null; branch?: string | null }) => {
    pendingKnowledgeBaseRequest = null;
    cachedKnowledgeBaseState = null;
    cachedKnowledgeBaseReadAtMs = 0;
    return patch<KnowledgeBaseState>('/knowledge-base', input);
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
  syncKnowledgeBase: async () => {
    pendingKnowledgeBaseRequest = null;
    cachedKnowledgeBaseState = null;
    cachedKnowledgeBaseReadAtMs = 0;
    return post<KnowledgeBaseState>('/knowledge-base/sync', {});
  },
  providerAuth: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readProviderAuth();
    }
    return get<ProviderAuthState>('/provider-auth');
  },
  setProviderApiKey: async (provider: string, apiKey: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.setProviderApiKey({ provider, apiKey });
    }

    return patch<ProviderAuthState>(`/provider-auth/${encodeURIComponent(provider)}/api-key`, { apiKey });
  },
  removeProviderCredential: async (provider: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.removeProviderCredential(provider);
    }

    return del<ProviderAuthState>(`/provider-auth/${encodeURIComponent(provider)}`);
  },
  startProviderOAuthLogin: async (provider: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.startProviderOAuthLogin(provider);
    }

    return post<ProviderOAuthLoginState>(`/provider-auth/${encodeURIComponent(provider)}/oauth/start`);
  },
  providerOAuthLogin: async (loginId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readProviderOAuthLogin(loginId);
    }
    return get<ProviderOAuthLoginState | null>(`/provider-auth/oauth/${encodeURIComponent(loginId)}`);
  },
  submitProviderOAuthLoginInput: async (loginId: string, value: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.submitProviderOAuthLoginInput({ loginId, value });
    }

    return post<ProviderOAuthLoginState>(`/provider-auth/oauth/${encodeURIComponent(loginId)}/input`, { input: value });
  },
  cancelProviderOAuthLogin: async (loginId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.cancelProviderOAuthLogin(loginId);
    }

    return post<ProviderOAuthLoginState>(`/provider-auth/oauth/${encodeURIComponent(loginId)}/cancel`);
  },
  conversationTitleSettings: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readConversationTitleSettings();
    }

    return get<ConversationTitleSettingsState>('/conversation-titles/settings');
  },
  updateConversationTitleSettings: async (input: { enabled?: boolean; model?: string | null }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.updateConversationTitleSettings(input);
    }

    return patch<ConversationTitleSettingsState>('/conversation-titles/settings', input);
  },
  openConversationTabs: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readOpenConversationTabs();
    }

    return get<{ sessionIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[]; workspacePaths: string[] }>('/ui/open-conversations');
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
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.updateOpenConversationTabs(request);
    }

    return patch<{ ok: boolean; sessionIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[]; workspacePaths: string[] }>('/ui/open-conversations', request);
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
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readScheduledTasks();
    }
    return get<ScheduledTaskSummary[]>('/tasks');
  },
  taskDetail: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readScheduledTaskDetail(id);
    }
    return get<ScheduledTaskDetail>(`/tasks/${encodeURIComponent(id)}`);
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
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.createScheduledTask(input);
    }

    return post<{ ok: boolean; task: ScheduledTaskDetail }>('/tasks', input);
  },
  setTaskEnabled: async (id: string, enabled: boolean) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.updateScheduledTask({ taskId: id, enabled });
    }

    return patch<{ ok: boolean; task: ScheduledTaskDetail }>(`/tasks/${encodeURIComponent(id)}`, { enabled });
  },
  saveTask: async (id: string, input: {
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
  }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.updateScheduledTask({ taskId: id, ...input });
    }

    return patch<{ ok: boolean; task: ScheduledTaskDetail }>(`/tasks/${encodeURIComponent(id)}`, input);
  },
  taskLog: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readScheduledTaskLog(id);
    }
    return get<{ log: string; path: string }>(`/tasks/${encodeURIComponent(id)}/log`);
  },
  deleteTask: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.deleteScheduledTask(id);
    }

    return del<{ ok: true; deleted: boolean }>(`/tasks/${encodeURIComponent(id)}`);
  },
  runTaskNow: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.runScheduledTask(id);
    }

    return post<{ ok: boolean; accepted: boolean; runId: string }>(`/tasks/${encodeURIComponent(id)}/run`);
  },
  runs: async () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readDurableRuns();
    }
    return get<DurableRunListResult>('/runs');
  },
  durableRun: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readDurableRun(id);
    }
    return get<DurableRunDetailResult>(`/runs/${encodeURIComponent(id)}`);
  },
  durableRunLog: async (id: string, tail?: number) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readDurableRunLog({ runId: id, tail });
    }

    const normalizedTail = normalizeDurableRunLogTailParam(tail);
    return get<{ log: string; path: string }>(`/runs/${encodeURIComponent(id)}/log${normalizedTail ? `?tail=${encodeURIComponent(String(normalizedTail))}` : ''}`);
  },
  markDurableRunAttentionRead: async (id: string, read = true) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.markDurableRunAttention({ runId: id, read });
    }

    return patch<{ ok: boolean }>(`/runs/${encodeURIComponent(id)}/attention`, { read });
  },
  cancelDurableRun: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.cancelDurableRun(id);
    }

    return post<{ cancelled: boolean; runId: string }>(`/runs/${encodeURIComponent(id)}/cancel`);
  },

  // ── Workspace helpers ────────────────────────────────────────────────────
  pickFolder: async (input?: string | { cwd?: string | null; prompt?: string | null }) => {
    const request = typeof input === 'string'
      ? { cwd: input }
      : {
          ...(input?.cwd !== undefined ? { cwd: input.cwd } : {}),
          ...(typeof input?.prompt === 'string' && input.prompt.trim().length > 0 ? { prompt: input.prompt.trim() } : {}),
        };
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.pickFolder(request);
    }

    return post<FolderPickerResult>('/folder-picker', request);
  },
  remoteDirectory: async (hostId: string, path?: string | null) => {
    const desktopBridge = getDesktopBridge();
    if (!desktopBridge || !await shouldUseDesktopLocalCapabilities()) {
      throw new Error('Remote directory browsing is only available in the desktop app.');
    }

    return desktopBridge.readRemoteDirectory({ hostId, ...(path !== undefined ? { path } : {}) }) as Promise<DesktopRemoteDirectoryListing>;
  },
  pickFiles: async (cwd?: string) => post<FilePickerResult>('/file-picker', cwd !== undefined ? { cwd } : {}),

  // ── Memory browser ────────────────────────────────────────────────────────
  memory:         (options?: { profile?: string }) => getMemoryData(options),

  markConversationAttentionRead: async (id: string, read = true) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.markConversationAttention({ conversationId: id, read });
    }

    return patch<{ ok: boolean }>(`/conversations/${encodeURIComponent(id)}/attention`, { read });
  },

  // ── Live sessions ─────────────────────────────────────────────────────────
  liveSession: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readLiveSession(id);
    }
    return get<LiveSessionMeta & { live: boolean }>(`/live-sessions/${id}`);
  },
  liveSessionContext: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
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
  createWorkspaceFolder: async (cwd: string, path: string) =>
    post<WorkspaceEntry>('/workspace/folder', { cwd, path }),
  deleteWorkspacePath: async (cwd: string, path: string) => {
    const params = new URLSearchParams({ cwd, path });
    return del<{ ok: boolean }>(`/workspace/path?${params.toString()}`);
  },
  renameWorkspacePath: async (cwd: string, path: string, newName: string) =>
    post<WorkspaceEntry>('/workspace/rename', { cwd, path, newName }),
  moveWorkspacePath: async (cwd: string, path: string, targetDir: string) =>
    post<WorkspaceEntry>('/workspace/move', { cwd, path, targetDir }),
  conversationBootstrap: async (id: string, options?: {
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
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
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readConversationPlansWorkspace();
    }

    return get<ConversationAutomationWorkspaceState>('/conversation-plans/workspace');
  },
  conversationArtifacts: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readConversationArtifacts(id);
    }

    return get<{ conversationId: string; artifacts: ConversationArtifactSummary[] }>(`/conversations/${encodeURIComponent(id)}/artifacts`);
  },
  conversationArtifact: async (id: string, artifactId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readConversationArtifact({ conversationId: id, artifactId });
    }

    return get<{ conversationId: string; artifact: ConversationArtifactRecord }>(`/conversations/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}`);
  },
  conversationCheckpoints: async (id: string) => get<{ conversationId: string; checkpoints: ConversationCommitCheckpointSummary[] }>(`/conversations/${encodeURIComponent(id)}/checkpoints`),
  conversationCheckpoint: async (id: string, checkpointId: string) => get<{ conversationId: string; checkpoint: ConversationCommitCheckpointRecord }>(`/conversations/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}`),
  conversationCheckpointReviewContext: async (id: string, checkpointId: string) => {
    return get<ConversationCheckpointReviewContext>(`/conversations/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/review-context`);
  },
  createConversationCheckpointComment: async (
    id: string,
    checkpointId: string,
    input: { body: string; filePath?: string },
  ) => {
    return post<{ conversationId: string; checkpoint: ConversationCommitCheckpointRecord }>(`/conversations/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/comments`, input);
  },
  conversationContextDocs: async (id: string) => {
    return get<{ conversationId: string; attachedContextDocs: ConversationContextDocRef[] }>(`/conversations/${encodeURIComponent(id)}/context-docs`);
  },
  updateConversationContextDocs: async (id: string, docs: ConversationContextDocRef[]) => {
    return patch<{ conversationId: string; attachedContextDocs: ConversationContextDocRef[] }>(`/conversations/${encodeURIComponent(id)}/context-docs`, { docs });
  },
  conversationAttachments: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readConversationAttachments(id);
    }

    return get<{ conversationId: string; attachments: ConversationAttachmentSummary[] }>(`/conversations/${encodeURIComponent(id)}/attachments`);
  },
  conversationAttachment: async (id: string, attachmentId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readConversationAttachment({ conversationId: id, attachmentId });
    }

    return get<{ conversationId: string; attachment: ConversationAttachmentRecord }>(`/conversations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`);
  },
  conversationAttachmentAsset: async (
    id: string,
    attachmentId: string,
    asset: 'source' | 'preview',
    revision?: number,
  ): Promise<ConversationAttachmentAssetData> => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readConversationAttachmentAsset({ conversationId: id, attachmentId, asset, revision });
    }

    const params = new URLSearchParams();
    if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0) {
      params.set('revision', String(revision));
    }
    const requestPath = buildApiPath(`/conversations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}/download/${asset}${params.toString() ? `?${params.toString()}` : ''}`);
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
  createConversationAttachment: async (id: string, input: {
    kind?: 'excalidraw';
    title?: string;
    sourceData: string;
    sourceName?: string;
    sourceMimeType?: string;
    previewData: string;
    previewName?: string;
    previewMimeType?: string;
    note?: string;
  }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.createConversationAttachment({ conversationId: id, ...input });
    }

    return post<{
      conversationId: string;
      attachment: ConversationAttachmentRecord;
      attachments: ConversationAttachmentSummary[];
    }>(`/conversations/${encodeURIComponent(id)}/attachments`, input);
  },
  updateConversationAttachment: async (id: string, attachmentId: string, input: {
    title?: string;
    sourceData: string;
    sourceName?: string;
    sourceMimeType?: string;
    previewData: string;
    previewName?: string;
    previewMimeType?: string;
    note?: string;
  }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
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
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readConversationDeferredResumes(id);
    }

    return get<{ conversationId: string; resumes: DeferredResumeSummary[] }>(`/conversations/${encodeURIComponent(id)}/deferred-resumes`);
  },
  scheduleDeferredResume: async (id: string, input: { delay: string; prompt?: string; behavior?: 'steer' | 'followUp' }) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.scheduleConversationDeferredResume({ conversationId: id, ...input });
    }

    return requestJson<{ conversationId: string; resume: DeferredResumeSummary; resumes: DeferredResumeSummary[] }>('POST', `/conversations/${encodeURIComponent(id)}/deferred-resumes`, input);
  },
  fireDeferredResumeNow: async (id: string, resumeId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.fireConversationDeferredResume({ conversationId: id, resumeId });
    }

    return requestJson<{ conversationId: string; resume: DeferredResumeSummary; resumes: DeferredResumeSummary[] }>('POST', `/conversations/${encodeURIComponent(id)}/deferred-resumes/${encodeURIComponent(resumeId)}/fire`);
  },
  cancelDeferredResume: async (id: string, resumeId: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.cancelConversationDeferredResume({ conversationId: id, resumeId });
    }

    return requestJson<{ conversationId: string; cancelledId: string; resumes: DeferredResumeSummary[] }>('DELETE', `/conversations/${encodeURIComponent(id)}/deferred-resumes/${encodeURIComponent(resumeId)}`);
  },
  changeConversationCwd: async (id: string, cwd: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.changeConversationCwd({
        conversationId: id,
        cwd,
        ...(surfaceId ? { surfaceId } : {}),
      });
    }

    return requestJson<ConversationCwdChangeResult>('POST', `/conversations/${encodeURIComponent(id)}/cwd`, { cwd, ...(surfaceId ? { surfaceId } : {}) });
  },
  duplicateConversation: async (id: string) => {
    return requestJson<{ newSessionId: string; sessionFile: string }>('POST', `/conversations/${encodeURIComponent(id)}/duplicate`);
  },
  renameConversation: async (id: string, name: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.renameConversation({
        conversationId: id,
        name,
        ...(surfaceId ? { surfaceId } : {}),
      });
    }

    return patch<{ ok: boolean; title: string }>(`/conversations/${encodeURIComponent(id)}/title`, { name, ...(surfaceId ? { surfaceId } : {}) });
  },
  conversationAutoMode: async (id: string) => {
    return get<ConversationAutoModeState>(`/conversations/${encodeURIComponent(id)}/auto-mode`);
  },
  updateConversationAutoMode: async (id: string, input: { enabled: boolean }, surfaceId?: string) => {
    return patch<ConversationAutoModeState>(`/conversations/${encodeURIComponent(id)}/auto-mode`, { ...input, ...(surfaceId ? { surfaceId } : {}) });
  },
  conversationModelPreferences: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readConversationModelPreferences({ conversationId: id });
    }
    return get<{ currentModel: string; currentThinkingLevel: string; currentServiceTier: string; hasExplicitServiceTier: boolean }>(`/conversations/${encodeURIComponent(id)}/model-preferences`);
  },
  updateConversationModelPreferences: async (id: string, input: { model?: string | null; thinkingLevel?: string | null; serviceTier?: string | null }, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.updateConversationModelPreferences({
        conversationId: id,
        ...input,
        ...(surfaceId ? { surfaceId } : {}),
      });
    }

    return patch<{ currentModel: string; currentThinkingLevel: string; currentServiceTier: string; hasExplicitServiceTier: boolean }>(`/conversations/${encodeURIComponent(id)}/model-preferences`, { ...input, ...(surfaceId ? { surfaceId } : {}) });
  },
  recoverConversation: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.recoverConversation(id);
    }

    return post<ConversationRecoveryResult>(`/conversations/${encodeURIComponent(id)}/recover`);
  },
  continueConversationInHost: async (id: string, hostId: string, cwd?: string | null) => {
    const desktopBridge = getDesktopBridge();
    if (!desktopBridge || !await shouldUseDesktopLocalCapabilities()) {
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
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
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
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
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
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
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

    return post<{ ok: boolean; accepted: boolean; delivery: 'started' | 'queued'; relatedConversationPointerWarnings?: string[] }>(`/live-sessions/${id}/prompt`, {
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
    });
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
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
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

    return post<{ ok: boolean; accepted: boolean; jobId: string; childConversationId: string; relatedConversationPointerWarnings?: string[] }>(`/live-sessions/${id}/parallel-prompt`, {
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
  manageParallelPromptJob: async (
    id: string,
    jobId: string,
    action: 'importNow' | 'skip' | 'cancel',
    surfaceId?: string,
  ) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.manageLiveSessionParallelJob({
        conversationId: id,
        jobId,
        action,
        ...(surfaceId ? { surfaceId } : {}),
      });
    }

    return post<{ ok: true; status: 'imported' | 'queued' | 'skipped' | 'cancelled' }>(`/live-sessions/${id}/parallel-jobs/${encodeURIComponent(jobId)}`, {
      action,
      ...(surfaceId ? { surfaceId } : {}),
    });
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
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
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
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.takeOverLiveSession({ conversationId: id, surfaceId });
    }

    return post<LiveSessionPresenceState>(`/live-sessions/${id}/takeover`, { surfaceId });
  },
  compactSession: async (id: string, customInstructions?: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.compactLiveSession({ conversationId: id, ...(customInstructions ? { customInstructions } : {}) });
    }

    return post<{ ok: boolean; result: unknown }>(`/live-sessions/${id}/compact`, { customInstructions, ...(surfaceId ? { surfaceId } : {}) });
  },
  summarizeAndForkSession: async (id: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.summarizeAndForkLiveSession(id);
    }

    return post<{ newSessionId: string; sessionFile: string }>(`/live-sessions/${id}/summarize-fork`, surfaceId ? { surfaceId } : {});
  },
  reloadSession: async (id: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.reloadLiveSession(id);
    }

    return post<{ ok: boolean }>(`/live-sessions/${id}/reload`, surfaceId ? { surfaceId } : {});
  },
  exportSession: async (id: string, outputPath?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.exportLiveSession({
        conversationId: id,
        ...(outputPath ? { outputPath } : {}),
      });
    }

    return post<LiveSessionExportResult>(`/live-sessions/${id}/export`, { outputPath });
  },
  abortSession: async (id: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.abortLiveSession(id);
    }

    return post<{ ok: boolean }>(`/live-sessions/${id}/abort`, surfaceId ? { surfaceId } : {});
  },

  destroySession: async (id: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.destroyLiveSession(id);
    }

    return requestJson<{ ok: boolean }>('DELETE', `/live-sessions/${encodeURIComponent(id)}`, surfaceId ? { surfaceId } : {});
  },

  forkEntries: async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalCapabilities()) {
      return desktopBridge.readLiveSessionForkEntries(id);
    }
    return get<LiveSessionForkEntry[]>(`/live-sessions/${id}/fork-entries`);
  },
  branchSession: async (id: string, entryId: string, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
      return desktopBridge.branchLiveSession({ conversationId: id, entryId });
    }

    return post<{ newSessionId: string; sessionFile: string }>(`/live-sessions/${id}/branch`, { entryId, ...(surfaceId ? { surfaceId } : {}) });
  },
  forkSession: async (id: string, entryId: string, options?: { preserveSource?: boolean; beforeEntry?: boolean }, surfaceId?: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge && await shouldUseDesktopLocalConversationCapabilities(id)) {
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
};

// ── Vault editor ─────────────────────────────────────────────────────────────

export const vaultApi = {
  tree: (dir?: string) =>
    get<VaultTreeResult>(`/vault/tree${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`),

  readFile: (id: string) =>
    get<VaultFileContent>(`/vault/file?id=${encodeURIComponent(id)}`),

  writeFile: (id: string, content: string) =>
    put<VaultEntry>('/vault/file', { id, content }),

  deleteFile: (id: string) =>
    del<{ ok: boolean }>(`/vault/file?id=${encodeURIComponent(id)}`),

  rename: (id: string, newName: string) =>
    post<VaultEntry>('/vault/rename', { id, newName }),

  createFolder: (id: string) =>
    post<VaultEntry>('/vault/folder', { id }),

  backlinks: (id: string) =>
    get<VaultBacklinksResult>(`/vault/backlinks?id=${encodeURIComponent(id)}`),

  search: (q: string, limit = 20) =>
    get<VaultSearchResponse>(`/vault/search?q=${encodeURIComponent(q)}&limit=${normalizeVaultSearchLimit(limit)}`),

  move: (id: string, targetDir: string) =>
    post<VaultEntry>('/vault/move', { id, targetDir }),

  uploadImage: (filename: string, dataUrl: string) =>
    post<VaultImageUploadResult>('/vault/image', { filename, dataUrl }),

  importUrl: (input: { url: string; title?: string; directoryId?: string; sourceApp?: string }) =>
    post<VaultShareImportResult>('/vault/share-import', {
      kind: 'url',
      url: input.url,
      ...(input.title ? { title: input.title } : {}),
      ...(input.directoryId ? { directoryId: input.directoryId } : {}),
      ...(input.sourceApp ? { sourceApp: input.sourceApp } : {}),
    }),

  assetUrl: (id: string) => `/api/vault/asset?id=${encodeURIComponent(id)}`,
};
