/**
 * Live Pi session registry.
 * Wraps @mariozechner/pi-coding-agent SDK sessions in-process and
 * exposes a pub/sub SSE event layer for the web server.
 */
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, normalize, relative, resolve } from 'node:path';
import {
  getDurableSessionsDir,
  getPiAgentRuntimeDir,
  resolveChildProcessEnv,
} from '@personal-agent/core';
import {
  AgentSession,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  createBashTool,
  type AgentSessionEvent,
  type ExtensionFactory,
  type SessionEntry,
} from '@mariozechner/pi-coding-agent';
import { stream, streamSimple, type Api, type Context, type Model, type ProviderStreamOptions, type SimpleStreamOptions } from '@mariozechner/pi-ai';
import { publishAppEvent } from '../shared/appEvents.js';
import {
  applyConversationModelPreferencesToLiveSession,
  readConversationModelPreferenceSnapshot,
  resolveConversationModelPreferenceState,
  type ConversationModelPreferenceInput,
  type ConversationModelPreferenceState,
} from './conversationModelPreferences.js';
import { modelSupportsServiceTier } from '../models/modelServiceTiers.js';
import { normalizeModelContextWindow } from '../models/modelContextWindows.js';
import { readSavedModelPreferences } from '../models/modelPreferences.js';
import { createRuntimeModelRegistry } from '../models/modelRegistry.js';
import {
  generateConversationTitle,
  hasAssistantTitleSourceMessage,
} from './conversationAutoTitle.js';
import { syncWebLiveConversationRun, type WebLiveConversationRunState } from './conversationRuns.js';
import {
  buildDisplayBlocksFromEntries,
  getAssistantErrorDisplayMessage,
  readSessionBlocksByFile,
  readSessionMetaByFile,
  type DisplayBlock,
} from './sessions.js';
import { estimateContextUsageSegments } from './sessionContextUsage.js';
import { readGitRepoInfo, readGitStatusSummary } from '../workspace/gitStatus.js';
import { logWarn } from '../shared/logging.js';
import {
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_PROMPT,
  CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT,
  CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE,
  readConversationAutoModeStateFromSessionManager,
  writeConversationAutoModeState,
  type ConversationAutoModeState,
  type ConversationAutoModeStateInput,
} from './conversationAutoMode.js';

const AGENT_DIR = getPiAgentRuntimeDir();
const SETTINGS_FILE = join(AGENT_DIR, 'settings.json');
const SESSIONS_DIR = getDurableSessionsDir();

export function resolvePersistentSessionDir(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  return join(SESSIONS_DIR, safePath);
}

function resolveConversationPreferenceStateForSession(
  sessionManager: Pick<SessionManager, 'buildSessionContext' | 'getBranch'>,
  availableModels: Model<Api>[],
): ConversationModelPreferenceState {
  return resolveConversationModelPreferenceState(
    readConversationModelPreferenceSnapshot(sessionManager),
    readSavedModelPreferences(SETTINGS_FILE, availableModels),
    availableModels,
  );
}

function buildConversationServiceTierPreferenceInput(
  state: Pick<ConversationModelPreferenceState, 'currentServiceTier' | 'hasExplicitServiceTier'>,
): string | null | undefined {
  if (!state.hasExplicitServiceTier) {
    return undefined;
  }

  return state.currentServiceTier || null;
}

function buildServiceTierAwareStreamFn(
  modelRegistry: ModelRegistry,
  serviceTier: string,
) {
  return async (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      throw new Error(auth.error);
    }

    const mergedOptions: ProviderStreamOptions = {
      ...options,
      apiKey: auth.apiKey,
      headers: auth.headers || options?.headers ? { ...auth.headers, ...options?.headers } : undefined,
    };

    if (!serviceTier || !modelSupportsServiceTier(model, serviceTier)) {
      return streamSimple(model, context, mergedOptions);
    }

    const reasoningEffort = typeof (options as { reasoning?: unknown } | undefined)?.reasoning === 'string'
      ? (options as { reasoning: string }).reasoning
      : undefined;

    return stream(model, context, {
      ...mergedOptions,
      reasoningEffort,
      serviceTier,
    });
  };
}

function applyLiveSessionServiceTier(
  session: AgentSession,
  serviceTier: string,
): void {
  session.agent.streamFn = buildServiceTierAwareStreamFn(session.modelRegistry, serviceTier);
}

// ── SSE event types sent to clients ──────────────────────────────────────────

export interface LiveContextUsageSegment {
  key: 'system' | 'user' | 'assistant' | 'tool' | 'summary' | 'other';
  label: string;
  tokens: number;
}

export interface LiveContextUsage {
  tokens: number | null;
  modelId?: string;
  contextWindow?: number;
  percent?: number | null;
  segments?: LiveContextUsageSegment[];
}

export interface QueuedPromptPreview {
  id: string;
  text: string;
  imageCount: number;
  restorable?: boolean;
}

type ParallelPromptJobStatus = 'running' | 'ready' | 'failed' | 'importing';

export interface ParallelPromptPreview {
  id: string;
  prompt: string;
  childConversationId: string;
  status: ParallelPromptJobStatus;
  imageCount: number;
  attachmentRefs: string[];
  touchedFiles: string[];
  parentTouchedFiles: string[];
  overlapFiles: string[];
  sideEffects: string[];
  resultPreview?: string;
  error?: string;
}

export type LiveSessionSurfaceType = 'desktop_web' | 'mobile_web';

interface LiveSurfacePresenceRecord {
  surfaceId: string;
  surfaceType: LiveSessionSurfaceType;
  connectedAt: string;
  connections: number;
}

export interface LiveSessionPresence {
  surfaceId: string;
  surfaceType: LiveSessionSurfaceType;
  connectedAt: string;
}

export interface LiveSessionPresenceState {
  surfaces: LiveSessionPresence[];
  controllerSurfaceId: string | null;
  controllerSurfaceType: LiveSessionSurfaceType | null;
  controllerAcquiredAt: string | null;
}

export class LiveSessionControlError extends Error {
  constructor(message = 'This conversation is controlled by another surface. Take over here to continue.') {
    super(message);
    this.name = 'LiveSessionControlError';
  }
}

export type SseEvent =
  | { type: 'snapshot';        blocks: DisplayBlock[]; blockOffset: number; totalBlocks: number; isStreaming: boolean }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'cwd_changed';     newConversationId: string; cwd: string; autoContinued: boolean }
  | { type: 'user_message';    block: Extract<DisplayBlock, { type: 'user' }> }
  | { type: 'queue_state';     steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] }
  | { type: 'parallel_state';  jobs: ParallelPromptPreview[] }
  | { type: 'presence_state';  state: LiveSessionPresenceState }
  | { type: 'auto_mode_state'; state: ConversationAutoModeState }
  | { type: 'text_delta';      delta: string }
  | { type: 'thinking_delta';  delta: string }
  | { type: 'tool_start';      toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_update';     toolCallId: string; partialResult: unknown }
  | { type: 'tool_end';        toolCallId: string; toolName: string; isError: boolean; durationMs: number; output: string; details?: unknown }
  | { type: 'title_update';    title: string }
  | { type: 'context_usage';   usage: LiveContextUsage | null }
  | { type: 'stats_update';    tokens: { input: number; output: number; total: number }; cost: number }
  | { type: 'compaction_start'; mode: 'manual' | 'auto' }
  | { type: 'error';           message: string };

export interface PromptImageAttachment {
  type: 'image';
  data: string;
  mimeType: string;
  name?: string;
}

interface PendingConversationWorkingDirectoryChange {
  cwd: string;
  continuePrompt?: string;
  loaderOptions: LiveSessionLoaderOptions;
}

// ── Internal entry ────────────────────────────────────────────────────────────

interface LiveListener {
  send: (event: SseEvent) => void;
  tailBlocks?: number;
}

interface LiveEntry {
  sessionId: string;
  session: AgentSession;
  cwd: string;
  listeners: Set<LiveListener>;
  title: string;
  autoTitleRequested: boolean;
  lastContextUsageJson: string | null;
  lastQueueStateJson: string | null;
  lastParallelStateJson?: string | null;
  lastAutoModeStateJson?: string | null;
  currentTurnError?: string | null;
  lastDurableRunState?: WebLiveConversationRunState;
  contextUsageTimer?: ReturnType<typeof setTimeout>;
  pendingHiddenTurnCustomTypes: string[];
  activeHiddenTurnCustomType: string | null;
  pendingAutoModeContinuation?: boolean;
  pendingAutoCompactionReason?: 'overflow' | 'threshold' | null;
  lastCompactionSummaryTitle?: string | null;
  isCompacting?: boolean;
  parallelJobs?: ParallelPromptJob[];
  importingParallelJobs?: boolean;
  presenceBySurfaceId?: Map<string, LiveSurfacePresenceRecord>;
  controllerSurfaceId?: string | null;
  controllerAcquiredAt?: string | null;
}

interface ParallelPromptJob {
  id: string;
  prompt: string;
  childConversationId: string;
  childSessionFile?: string;
  status: ParallelPromptJobStatus;
  createdAt: string;
  updatedAt: string;
  imageCount: number;
  attachmentRefs: string[];
  touchedFiles: string[];
  parentTouchedFiles: string[];
  overlapFiles: string[];
  sideEffects: string[];
  forkEntryId?: string;
  repoRoot?: string;
  worktreeDirtyPathsAtStart: string[];
  resultText?: string;
  error?: string;
}

export interface LiveSessionLifecycleEvent {
  conversationId: string;
  sessionFile?: string;
  title: string;
  cwd: string;
  trigger: 'turn_end' | 'auto_compaction_end';
}

export interface LiveSessionStateSnapshot {
  blocks: DisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  hasSnapshot: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  hasPendingHiddenTurn: boolean;
  error: string | null;
  title: string | null;
  tokens: { input: number; output: number; total: number } | null;
  cost: number | null;
  contextUsage: LiveContextUsage | null;
  pendingQueue: { steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] };
  parallelJobs: ParallelPromptPreview[];
  presence: LiveSessionPresenceState;
  autoModeState: ConversationAutoModeState | null;
  cwdChange: { newConversationId: string; cwd: string; autoContinued: boolean } | null;
}

export type LiveSessionLifecycleHandler = (event: LiveSessionLifecycleEvent) => void | Promise<void>;

export const registry = new Map<string, LiveEntry>();
const toolTimings = new Map<string, number>(); // toolCallId → start ms
let syntheticBashExecutionCounter = 0;
const lifecycleHandlers = new Set<LiveSessionLifecycleHandler>();
const pendingConversationWorkingDirectoryChanges = new Map<string, PendingConversationWorkingDirectoryChange>();

export function registerLiveSessionLifecycleHandler(handler: LiveSessionLifecycleHandler): () => void {
  lifecycleHandlers.add(handler);
  return () => lifecycleHandlers.delete(handler);
}

function notifyLiveSessionLifecycleHandlers(entry: LiveEntry, trigger: 'turn_end' | 'auto_compaction_end'): void {
  const event: LiveSessionLifecycleEvent = {
    conversationId: entry.sessionId,
    sessionFile: resolveLiveSessionFile(entry.session, { ensurePersisted: true }),
    title: resolveEntryTitle(entry),
    cwd: entry.cwd,
    trigger,
  };

  for (const handler of lifecycleHandlers) {
    Promise.resolve(handler(event)).catch((error) => {
      logWarn('live session lifecycle handler failed', {
        conversationId: entry.sessionId,
        trigger,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      });
    });
  }
}

export function reloadAllLiveSessionAuth(): number {
  let reloadedCount = 0;

  for (const entry of registry.values()) {
    const authStorage = entry.session.modelRegistry?.authStorage;
    if (!authStorage || typeof authStorage.reload !== 'function') {
      continue;
    }

    authStorage.reload();
    reloadedCount += 1;
  }

  return reloadedCount;
}

export function refreshAllLiveSessionModelRegistries(): number {
  let refreshedCount = 0;

  for (const entry of registry.values()) {
    const modelRegistry = entry.session.modelRegistry;
    if (!modelRegistry || typeof modelRegistry.refresh !== 'function') {
      continue;
    }

    modelRegistry.refresh();
    refreshedCount += 1;
  }

  return refreshedCount;
}

// ── Auth / model helpers ──────────────────────────────────────────────────────

function makeAuth() {
  return AuthStorage.create(join(AGENT_DIR, 'auth.json'));
}

function makeRegistry(auth: AuthStorage) {
  return createRuntimeModelRegistry(auth);
}

interface ToolPatchableSessionInternals {
  _baseToolRegistry?: Map<string, unknown>;
  _refreshToolRegistry?: (options?: {
    activeToolNames?: string[];
    includeAllExtensionTools?: boolean;
  }) => void;
}

function patchConversationBashTool(session: AgentSession, cwd: string, conversationId: string, sessionFile?: string): void {
  const patchableSession = session as unknown as ToolPatchableSessionInternals;
  if (!(patchableSession._baseToolRegistry instanceof Map) || typeof patchableSession._refreshToolRegistry !== 'function') {
    return;
  }

  patchableSession._baseToolRegistry.set('bash', createBashTool(cwd, {
    commandPrefix: session.settingsManager.getShellCommandPrefix(),
    spawnHook: (context) => ({
      ...context,
      env: resolveChildProcessEnv({
        PERSONAL_AGENT_SOURCE_CONVERSATION_ID: conversationId,
        ...(sessionFile ? { PERSONAL_AGENT_SOURCE_SESSION_FILE: sessionFile } : {}),
      }, context.env),
    }),
  }));

  patchableSession._refreshToolRegistry({
    activeToolNames: session.getActiveToolNames(),
    includeAllExtensionTools: true,
  });
}

interface PersistableSessionManager {
  persist?: boolean;
  sessionFile?: string;
  flushed?: boolean;
  _rewriteFile?: () => void;
  _persist?: (entry: unknown) => void;
}

const SESSION_MANAGER_PERSISTENCE_PATCH = Symbol('pa.session-manager-persistence-patch');

export function patchSessionManagerPersistence(sessionManager: SessionManager): void {
  const manager = sessionManager as unknown as PersistableSessionManager & {
    [SESSION_MANAGER_PERSISTENCE_PATCH]?: boolean;
  };

  if (manager[SESSION_MANAGER_PERSISTENCE_PATCH]) {
    return;
  }

  if (typeof manager._rewriteFile !== 'function') {
    return;
  }

  const rewriteFile = manager._rewriteFile.bind(manager);
  manager._persist = (entry: unknown) => {
    if (!manager.persist || !manager.sessionFile) {
      return;
    }

    if (!manager.flushed || !existsSync(manager.sessionFile)) {
      rewriteFile();
      manager.flushed = true;
      return;
    }

    appendFileSync(manager.sessionFile, `${JSON.stringify(entry)}\n`);
  };

  manager[SESSION_MANAGER_PERSISTENCE_PATCH] = true;
}

export function ensureSessionFileExists(sessionManager: SessionManager): void {
  const manager = sessionManager as unknown as PersistableSessionManager;
  if (!manager.persist || !manager.sessionFile || typeof manager._rewriteFile !== 'function') {
    return;
  }

  if (existsSync(manager.sessionFile) && manager.flushed) {
    return;
  }

  manager._rewriteFile();
  manager.flushed = true;
}

function resolveLiveSessionFile(
  session: Pick<AgentSession, 'sessionFile'> & { sessionManager?: Pick<SessionManager, 'getSessionFile'> },
  options: { ensurePersisted?: boolean } = {},
): string | undefined {
  if (options.ensurePersisted && session.sessionManager) {
    ensureSessionFileExists(session.sessionManager as SessionManager);
  }

  const managerFile = typeof session.sessionManager?.getSessionFile === 'function'
    ? session.sessionManager.getSessionFile()?.trim()
    : '';
  if (managerFile) {
    return managerFile;
  }

  const sessionFile = session.sessionFile?.trim();
  return sessionFile || undefined;
}

function summarizeUserMessageContent(content: unknown): { text: string; imageCount: number } {
  const blocks = Array.isArray(content)
    ? content as Array<{ type?: string; text?: string }>
    : typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : [];

  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
  const imageCount = blocks.filter((block) => block.type === 'image').length;

  return { text, imageCount };
}

function formatConversationTitle(text: string, imageCount: number): string {
  return text.trim().replace(/\n/g, ' ').slice(0, 80)
    || (imageCount === 1 ? '(image attachment)' : imageCount > 1 ? `(${imageCount} image attachments)` : '');
}

function getSessionMessages(session: AgentSession): Array<{ role?: string; content?: unknown }> {
  const stateMessages = (session as AgentSession & {
    state?: { messages?: Array<{ role?: string; content?: unknown }> };
    agent?: { state?: { messages?: Array<{ role?: string; content?: unknown }> } };
  }).state?.messages;

  if (Array.isArray(stateMessages)) {
    return stateMessages;
  }

  const agentMessages = (session as AgentSession & {
    agent?: { state?: { messages?: Array<{ role?: string; content?: unknown }> } };
  }).agent?.state?.messages;

  return Array.isArray(agentMessages) ? agentMessages : [];
}

function buildFallbackTitleFromContent(content: unknown): string {
  const { text, imageCount } = summarizeUserMessageContent(content);
  return formatConversationTitle(text, imageCount);
}

export function isPlaceholderConversationTitle(title: string | null | undefined): boolean {
  const normalized = title?.trim().toLowerCase();
  return !normalized || normalized === 'new conversation' || normalized === '(new conversation)';
}

export function resolveStableSessionTitle(session: AgentSession): string {
  const sessionName = session.sessionName?.trim();
  if (sessionName) {
    return sessionName;
  }

  const sessionFile = resolveLiveSessionFile(session);
  if (sessionFile) {
    const persistedTitle = readSessionMetaByFile(sessionFile)?.title?.trim();
    if (persistedTitle && !isPlaceholderConversationTitle(persistedTitle)) {
      return persistedTitle;
    }
  }

  const firstUser = getSessionMessages(session).find((message) => message.role === 'user');
  if (!firstUser) {
    return '';
  }

  return buildFallbackTitleFromContent(firstUser.content);
}

function resolveEntryTitle(entry: LiveEntry): string {
  const sessionName = entry.session.sessionName?.trim();
  if (sessionName) {
    return sessionName;
  }

  return entry.title.trim();
}

function isLikelyUnsupportedImageInputError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  const mentionsImageInput = normalized.includes('image')
    || normalized.includes('vision')
    || normalized.includes('multimodal');

  const indicatesUnsupported = normalized.includes('not support')
    || normalized.includes('unsupported')
    || normalized.includes('not enabled')
    || normalized.includes('text-only')
    || normalized.includes('text only')
    || normalized.includes('invalid image')
    || normalized.includes('image input');

  return mentionsImageInput && indicatesUnsupported;
}

function readContextUsagePayload(session: AgentSession): LiveContextUsage | null {
  try {
    const usage = session.getContextUsage();
    if (!usage) {
      return null;
    }

    const modelId = session.model?.id;
    const contextWindow = normalizeModelContextWindow(
      modelId,
      usage.contextWindow,
      session.model?.contextWindow ?? 128_000,
    );

    return {
      ...usage,
      modelId,
      contextWindow,
      percent: usage.tokens !== null && contextWindow > 0 ? (usage.tokens / contextWindow) * 100 : null,
      ...(usage.tokens !== null
        ? { segments: estimateContextUsageSegments(session.messages, usage.tokens) }
        : {}),
    };
  } catch {
    return null;
  }
}

function normalizeQueuedPromptBehavior(
  behavior: 'steer' | 'followUp' | undefined,
  options: { isStreaming: boolean; hasHiddenTurnQueued: boolean },
): 'steer' | 'followUp' | undefined {
  if (options.isStreaming) {
    return behavior ?? 'followUp';
  }

  if (options.hasHiddenTurnQueued) {
    return behavior ?? 'followUp';
  }

  return undefined;
}

function hasQueuedOrActiveHiddenTurn(entry: Pick<LiveEntry, 'pendingHiddenTurnCustomTypes' | 'activeHiddenTurnCustomType'>): boolean {
  const pendingHiddenTurnCustomTypes = Array.isArray(entry.pendingHiddenTurnCustomTypes)
    ? entry.pendingHiddenTurnCustomTypes
    : [];
  return Boolean(entry.activeHiddenTurnCustomType) || pendingHiddenTurnCustomTypes.length > 0;
}

export function canInjectResumeFallbackPrompt(sessionId: string): boolean {
  const entry = registry.get(sessionId);
  if (!entry) {
    return false;
  }

  if (entry.session.isStreaming || hasQueuedOrActiveHiddenTurn(entry)) {
    return false;
  }

  const steering = typeof entry.session.getSteeringMessages === 'function'
    ? entry.session.getSteeringMessages()
    : [];
  if (steering.length > 0) {
    return false;
  }

  const followUp = typeof entry.session.getFollowUpMessages === 'function'
    ? entry.session.getFollowUpMessages()
    : [];
  return followUp.length === 0;
}

const INTERNAL_QUEUED_PROMPT_ID_FIELD = '__personalAgentQueuedPromptId';
let queuedPromptPreviewIdCounter = 0;

function createQueuedPromptPreviewId(queueType: 'steer' | 'followUp'): string {
  queuedPromptPreviewIdCounter += 1;
  return `${queueType}-queued-${queuedPromptPreviewIdCounter}`;
}

function formatQueuedPromptPreviewText(text: string, imageCount: number): string {
  const normalizedText = text.trim();
  if (normalizedText) {
    return normalizedText;
  }

  if (imageCount > 0) {
    return '';
  }

  return '(empty queued prompt)';
}

function buildQueuedPromptPreview(
  id: string,
  text: string,
  imageCount: number,
  options: { restorable?: boolean } = {},
): QueuedPromptPreview {
  return {
    id,
    text: formatQueuedPromptPreviewText(text, imageCount),
    imageCount,
    ...(typeof options.restorable === 'boolean' ? { restorable: options.restorable } : {}),
  };
}

interface InternalQueuedAgentMessage {
  role?: string;
  content?: unknown;
  __personalAgentQueuedPromptId?: string;
}

interface InternalQueuedAgentQueueContainer {
  messages?: InternalQueuedAgentMessage[];
}

type InternalQueuedAgentQueue = InternalQueuedAgentMessage[] | InternalQueuedAgentQueueContainer;

interface InternalAgentQueues {
  steeringQueue?: InternalQueuedAgentQueue;
  followUpQueue?: InternalQueuedAgentQueue;
}

function resolveInternalQueuedMessages(
  queue: InternalQueuedAgentQueue | undefined,
): InternalQueuedAgentMessage[] | undefined {
  if (Array.isArray(queue)) {
    return queue;
  }

  if (queue && typeof queue === 'object' && Array.isArray(queue.messages)) {
    return queue.messages;
  }

  return undefined;
}

function ensureQueuedPromptPreviewId(
  queueType: 'steer' | 'followUp',
  message: InternalQueuedAgentMessage,
): string {
  const existingId = message.__personalAgentQueuedPromptId?.trim();
  if (existingId) {
    return existingId;
  }

  const id = createQueuedPromptPreviewId(queueType);
  try {
    Object.defineProperty(message, INTERNAL_QUEUED_PROMPT_ID_FIELD, {
      value: id,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    message.__personalAgentQueuedPromptId = id;
  }
  return id;
}

function createVisibleQueueFallbackPreview(
  queueType: 'steer' | 'followUp',
  index: number,
  text: string,
): QueuedPromptPreview {
  return buildQueuedPromptPreview(`${queueType}-visible-${index}`, text, 0, { restorable: true });
}

function isVisibleQueueFallbackPreviewId(
  queueType: 'steer' | 'followUp',
  previewId?: string,
): boolean {
  const normalizedPreviewId = previewId?.trim() ?? '';
  return normalizedPreviewId.startsWith(`${queueType}-visible-`);
}

function readQueuedPromptPreviews(
  queueType: 'steer' | 'followUp',
  visibleQueue: string[],
  internalQueue: InternalQueuedAgentQueue | undefined,
): QueuedPromptPreview[] {
  if (visibleQueue.length === 0) {
    return [];
  }

  const internalQueueMessages = resolveInternalQueuedMessages(internalQueue);
  if (!Array.isArray(internalQueueMessages)) {
    return visibleQueue.map((text, index) => createVisibleQueueFallbackPreview(queueType, index, text));
  }

  const internalUserQueue = internalQueueMessages.filter((queuedMessage): queuedMessage is InternalQueuedAgentMessage => queuedMessage?.role === 'user');
  if (internalUserQueue.length === 0) {
    return visibleQueue.map((text, index) => createVisibleQueueFallbackPreview(queueType, index, text));
  }

  const alignedInternalQueue = internalUserQueue.length > visibleQueue.length
    ? internalUserQueue.slice(internalUserQueue.length - visibleQueue.length)
    : internalUserQueue;

  const previews: QueuedPromptPreview[] = [];
  let searchStartIndex = 0;

  for (let index = 0; index < visibleQueue.length; index += 1) {
    const visibleText = visibleQueue[index] ?? '';
    let matchedPreview: QueuedPromptPreview | null = null;

    for (let searchIndex = searchStartIndex; searchIndex < alignedInternalQueue.length; searchIndex += 1) {
      const queuedMessage = alignedInternalQueue[searchIndex];
      const extracted = extractQueuedPromptContent(queuedMessage, visibleText);
      if (extracted.text !== visibleText) {
        continue;
      }

      matchedPreview = buildQueuedPromptPreview(
        ensureQueuedPromptPreviewId(queueType, queuedMessage),
        extracted.text,
        extracted.images.length,
      );
      searchStartIndex = searchIndex + 1;
      break;
    }

    previews.push(matchedPreview ?? createVisibleQueueFallbackPreview(queueType, index, visibleText));
  }

  return previews;
}

function readQueueState(session: AgentSession): { steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] } {
  const steer = typeof session.getSteeringMessages === 'function'
    ? session.getSteeringMessages()
    : [];
  const followUp = typeof session.getFollowUpMessages === 'function'
    ? session.getFollowUpMessages()
    : [];
  const internalAgent = session.agent as unknown as InternalAgentQueues | undefined;

  return {
    steering: readQueuedPromptPreviews('steer', [...steer], internalAgent?.steeringQueue),
    followUp: readQueuedPromptPreviews('followUp', [...followUp], internalAgent?.followUpQueue),
  };
}

export function listQueuedPromptPreviews(sessionId: string): { steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] } {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  return readQueueState(entry.session);
}

const PARALLEL_RESULT_CUSTOM_TYPE = 'parallel_result';
const PARALLEL_JOBS_FILE_SUFFIX = '.parallel.json';
const PARALLEL_PREVIEW_PATH_LIMIT = 5;
const PARALLEL_PREVIEW_ATTACHMENT_LIMIT = 4;
const PARALLEL_PREVIEW_SIDE_EFFECT_LIMIT = 3;
let parallelPromptJobCounter = 0;

function resolveParallelJobsFile(sessionFile: string): string {
  return `${sessionFile}${PARALLEL_JOBS_FILE_SUFFIX}`;
}

function normalizeParallelPromptJobStatus(value: unknown): ParallelPromptJobStatus {
  return value === 'ready' || value === 'failed' || value === 'importing'
    ? value
    : 'running';
}

function normalizeParallelPromptList(value: unknown, limit = 32): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const next: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    next.push(normalized);
    if (next.length >= limit) {
      break;
    }
  }

  return next;
}

function normalizeParallelPromptJob(candidate: unknown): ParallelPromptJob | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const job = candidate as Partial<ParallelPromptJob>;
  const id = typeof job.id === 'string' ? job.id.trim() : '';
  const prompt = typeof job.prompt === 'string' ? job.prompt : '';
  const childConversationId = typeof job.childConversationId === 'string' ? job.childConversationId.trim() : '';
  if (!id || !childConversationId) {
    return null;
  }

  const createdAt = typeof job.createdAt === 'string' && job.createdAt.trim().length > 0
    ? job.createdAt.trim()
    : new Date().toISOString();
  const updatedAt = typeof job.updatedAt === 'string' && job.updatedAt.trim().length > 0
    ? job.updatedAt.trim()
    : createdAt;
  const childSessionFile = typeof job.childSessionFile === 'string' && job.childSessionFile.trim().length > 0
    ? job.childSessionFile.trim()
    : undefined;
  const forkEntryId = typeof job.forkEntryId === 'string' && job.forkEntryId.trim().length > 0
    ? job.forkEntryId.trim()
    : undefined;
  const repoRoot = typeof job.repoRoot === 'string' && job.repoRoot.trim().length > 0
    ? job.repoRoot.trim()
    : undefined;

  return {
    id,
    prompt,
    childConversationId,
    ...(childSessionFile ? { childSessionFile } : {}),
    status: normalizeParallelPromptJobStatus(job.status),
    createdAt,
    updatedAt,
    imageCount: Number.isInteger(job.imageCount) && Number(job.imageCount) > 0 ? Number(job.imageCount) : 0,
    attachmentRefs: normalizeParallelPromptList(job.attachmentRefs, 12),
    touchedFiles: normalizeParallelPromptList(job.touchedFiles, 24),
    parentTouchedFiles: normalizeParallelPromptList(job.parentTouchedFiles, 24),
    overlapFiles: normalizeParallelPromptList(job.overlapFiles, 24),
    sideEffects: normalizeParallelPromptList(job.sideEffects, 12),
    ...(forkEntryId ? { forkEntryId } : {}),
    ...(repoRoot ? { repoRoot } : {}),
    worktreeDirtyPathsAtStart: normalizeParallelPromptList(job.worktreeDirtyPathsAtStart, 128),
    ...(typeof job.resultText === 'string' && job.resultText.trim().length > 0 ? { resultText: job.resultText } : {}),
    ...(typeof job.error === 'string' && job.error.trim().length > 0 ? { error: job.error.trim() } : {}),
  };
}

function readPersistedParallelJobs(sessionFile: string): ParallelPromptJob[] {
  const jobsFile = resolveParallelJobsFile(sessionFile);
  if (!existsSync(jobsFile)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(jobsFile, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((candidate): ParallelPromptJob[] => {
      const normalized = normalizeParallelPromptJob(candidate);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

function writePersistedParallelJobs(sessionFile: string, jobs: ParallelPromptJob[]): void {
  const jobsFile = resolveParallelJobsFile(sessionFile);
  if (jobs.length === 0) {
    if (existsSync(jobsFile)) {
      unlinkSync(jobsFile);
    }
    return;
  }

  writeFileSync(jobsFile, `${JSON.stringify(jobs, null, 2)}\n`);
}

function persistParallelJobs(entry: Pick<LiveEntry, 'session' | 'parallelJobs'>): void {
  const sessionFile = entry.session.sessionFile?.trim();
  if (!sessionFile) {
    return;
  }

  writePersistedParallelJobs(sessionFile, Array.isArray(entry.parallelJobs) ? entry.parallelJobs : []);
}

function replacePersistedParallelJob(
  sessionFile: string,
  jobId: string,
  updater: (job: ParallelPromptJob) => ParallelPromptJob | null,
): ParallelPromptJob[] {
  const jobs = readPersistedParallelJobs(sessionFile);
  const nextJobs: ParallelPromptJob[] = [];

  for (const job of jobs) {
    if (job.id !== jobId) {
      nextJobs.push(job);
      continue;
    }

    const updated = updater(job);
    if (updated) {
      nextJobs.push(updated);
    }
  }

  const reconciled = reconcilePersistedParallelJobs(sessionFile, nextJobs);
  writePersistedParallelJobs(sessionFile, reconciled);
  return reconciled;
}

function readImportedParallelChildConversationIds(sessionFile: string): Set<string> {
  const imported = new Set<string>();

  try {
    const lines = readFileSync(sessionFile, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const rawLine = line.trim();
      if (!rawLine) {
        continue;
      }

      try {
        const entry = JSON.parse(rawLine) as {
          type?: string;
          display?: boolean;
          customType?: string;
          details?: { childConversationId?: unknown } | null;
        };
        if (entry.type !== 'custom_message' || entry.customType !== PARALLEL_RESULT_CUSTOM_TYPE) {
          continue;
        }

        const childConversationId = typeof entry.details?.childConversationId === 'string'
          ? entry.details.childConversationId.trim()
          : '';
        if (childConversationId) {
          imported.add(childConversationId);
        }
      } catch {
        continue;
      }
    }
  } catch {
    return imported;
  }

  return imported;
}

function normalizeParallelComparablePath(pathValue: string): string {
  return normalize(pathValue).replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeParallelTouchedPath(pathValue: string, input: { cwd?: string; repoRoot?: string } = {}): string {
  const normalized = pathValue.trim();
  if (!normalized) {
    return '';
  }

  if (input.repoRoot) {
    const absolutePath = normalized.startsWith('/')
      ? resolve(normalized)
      : input.cwd
        ? resolve(input.cwd, normalized)
        : null;
    if (absolutePath) {
      const relativePath = relative(input.repoRoot, absolutePath);
      if (relativePath && !relativePath.startsWith('..')) {
        return normalizeParallelComparablePath(relativePath);
      }
      if (relativePath === '') {
        return normalizeParallelComparablePath(absolutePath);
      }
      if (normalized.startsWith('/')) {
        return normalizeParallelComparablePath(absolutePath);
      }
    }
  }

  return normalizeParallelComparablePath(normalized);
}

function collectParallelToolCallPaths(argumentsValue: unknown): string[] {
  if (!argumentsValue || typeof argumentsValue !== 'object') {
    return [];
  }

  const args = argumentsValue as {
    path?: unknown;
    paths?: unknown;
    filePath?: unknown;
    filePaths?: unknown;
  };
  const paths = [
    typeof args.path === 'string' ? args.path.trim() : '',
    typeof args.filePath === 'string' ? args.filePath.trim() : '',
  ].filter((value): value is string => value.length > 0);

  const multiPaths = [args.paths, args.filePaths]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .flatMap((value): string[] => typeof value === 'string' && value.trim().length > 0 ? [value.trim()] : []);

  return [...paths, ...multiPaths];
}

function collectParallelTouchedFilesFromBranchEntries(
  entries: StableForkBranchEntry[],
  options: { cwd?: string; repoRoot?: string; includeRead?: boolean } = {},
): string[] {
  const seen = new Set<string>();
  const touchedFiles: string[] = [];

  for (const entry of entries) {
    if (entry?.type !== 'message' || entry.message?.role !== 'assistant' || !Array.isArray(entry.message.content)) {
      continue;
    }

    for (const part of entry.message.content) {
      if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'toolCall') {
        continue;
      }

      const toolName = typeof (part as { name?: unknown }).name === 'string'
        ? (part as { name: string }).name.trim()
        : '';
      if ((toolName === 'read' && options.includeRead !== false)
        || toolName === 'edit'
        || toolName === 'write'
        || toolName === 'checkpoint') {
        // keep going
      } else {
        continue;
      }

      for (const rawPath of collectParallelToolCallPaths((part as { arguments?: unknown }).arguments)) {
        const normalizedPath = normalizeParallelTouchedPath(rawPath, options);
        if (!normalizedPath || seen.has(normalizedPath)) {
          continue;
        }

        seen.add(normalizedPath);
        touchedFiles.push(normalizedPath);
      }
    }
  }

  return touchedFiles;
}

function readParallelTouchedFilesFromSessionFile(
  sessionFile: string,
  options: { cwd?: string; repoRoot?: string } = {},
): string[] {
  return collectParallelTouchedFilesFromBranchEntries(getStableForkBranchEntries(sessionFile), options);
}

function readParallelMutatedFilesFromSessionFile(
  sessionFile: string,
  options: { cwd?: string; repoRoot?: string } = {},
): string[] {
  return collectParallelTouchedFilesFromBranchEntries(getStableForkBranchEntries(sessionFile), {
    ...options,
    includeRead: false,
  });
}

function isParallelRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readParallelRecordString(value: Record<string, unknown> | null, key: string): string | null {
  const candidate = value?.[key];
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

function readParallelToolAction(block: Extract<DisplayBlock, { type: 'tool_use' }>): string | null {
  const details = isParallelRecord(block.details) ? block.details : null;
  const input = isParallelRecord(block.input) ? block.input : null;
  return readParallelRecordString(details, 'action') ?? readParallelRecordString(input, 'action');
}

function summarizeParallelToolOutput(block: Extract<DisplayBlock, { type: 'tool_use' }>): string | null {
  const firstLine = block.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return null;
  }

  return truncateParallelPreviewText(firstLine, 200);
}

function isParallelSideEffectBlock(block: Extract<DisplayBlock, { type: 'tool_use' }>): boolean {
  const action = readParallelToolAction(block);

  if (block.tool === 'artifact') {
    return action === 'save' || action === 'delete';
  }

  if (block.tool === 'checkpoint') {
    return action === 'save';
  }

  if (block.tool === 'reminder') {
    return true;
  }

  if (block.tool === 'conversation_queue') {
    return action === 'add' || action === 'cancel';
  }

  if (block.tool === 'scheduled_task') {
    return action === 'save' || action === 'delete' || action === 'run';
  }

  if (block.tool === 'run') {
    return action === 'start'
      || action === 'start_agent'
      || action === 'rerun'
      || action === 'follow_up'
      || action === 'cancel';
  }

  if (block.tool === 'change_working_directory') {
    return action === 'queue';
  }

  return false;
}

function readParallelSideEffectsFromSessionFile(sessionFile: string): string[] {
  const detail = readSessionBlocksByFile(sessionFile);
  const blocks = detail?.blocks ?? [];
  const seen = new Set<string>();
  const sideEffects: string[] = [];

  for (const block of blocks) {
    if (block.type !== 'tool_use' || !isParallelSideEffectBlock(block)) {
      continue;
    }

    const summary = summarizeParallelToolOutput(block);
    if (!summary || seen.has(summary)) {
      continue;
    }

    seen.add(summary);
    sideEffects.push(summary);
  }

  return sideEffects;
}

function readParallelCurrentWorktreeDirtyPaths(cwd: string, repoRoot?: string): string[] {
  if (!cwd.trim()) {
    return [];
  }

  const resolvedRepoRoot = repoRoot?.trim() || readGitRepoInfo(cwd)?.root;
  if (!resolvedRepoRoot) {
    return [];
  }

  const summary = readGitStatusSummary(resolvedRepoRoot);
  if (!summary) {
    return [];
  }

  return normalizeParallelPromptList(summary.changes.map((change) => normalizeParallelComparablePath(change.relativePath)), 256);
}

function readParentTouchedFilesSinceFork(
  sessionFile: string,
  forkEntryId: string | undefined,
  options: { cwd?: string; repoRoot?: string; includeRead?: boolean } = {},
): string[] {
  const branch = getStableForkBranchEntries(sessionFile);
  if (!forkEntryId) {
    return collectParallelTouchedFilesFromBranchEntries(branch, options);
  }

  const forkIndex = branch.findIndex((entry) => entry.id?.trim() === forkEntryId);
  const branchTail = forkIndex >= 0 ? branch.slice(forkIndex + 1) : branch;
  return collectParallelTouchedFilesFromBranchEntries(branchTail, options);
}

function readParallelOverlapFiles(input: {
  mutatingChildFiles: string[];
  parentMutatingFiles: string[];
  currentDirtyPaths: string[];
  worktreeDirtyPathsAtStart: string[];
}): string[] {
  if (input.mutatingChildFiles.length === 0) {
    return [];
  }

  const startDirtyPaths = new Set(input.worktreeDirtyPathsAtStart);
  const concurrentDirtyPaths = input.currentDirtyPaths.filter((path) => !startDirtyPaths.has(path));
  const overlapCandidates = new Set<string>([
    ...normalizeParallelPromptList(input.parentMutatingFiles, 64),
    ...normalizeParallelPromptList(concurrentDirtyPaths, 128),
  ]);

  return input.mutatingChildFiles.filter((path) => overlapCandidates.has(path));
}

function readParallelJobCompletionFromSessionFile(
  sessionFile: string,
  options: { cwd?: string; repoRoot?: string } = {},
): {
  hasTerminalReply: boolean;
  status?: Extract<ParallelPromptJobStatus, 'ready' | 'failed'>;
  resultText?: string;
  error?: string;
  touchedFiles: string[];
  sideEffects: string[];
} {
  const branch = getStableForkBranchEntries(sessionFile);
  const touchedFiles = readParallelTouchedFilesFromSessionFile(sessionFile, options);
  const sideEffects = readParallelSideEffectsFromSessionFile(sessionFile);

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== 'message' || entry.message?.role !== 'assistant') {
      continue;
    }

    if (entry.message.stopReason === 'toolUse') {
      continue;
    }

    if (entry.message.stopReason === 'error') {
      const errorMessage = entry.message.errorMessage?.trim();
      return {
        hasTerminalReply: true,
        status: 'failed',
        error: errorMessage && errorMessage.length > 0
          ? errorMessage
          : 'The parallel prompt failed before completing.',
        touchedFiles,
        sideEffects,
      };
    }

    const resultText = extractTextFromMessageContent(entry.message.content);
    return {
      hasTerminalReply: true,
      status: 'ready',
      ...(resultText ? { resultText } : {}),
      touchedFiles,
      sideEffects,
    };
  }

  return {
    hasTerminalReply: false,
    touchedFiles,
    sideEffects,
  };
}

function reconcileParallelPromptJob(sessionFile: string, job: ParallelPromptJob): ParallelPromptJob {
  const parentMeta = readSessionMetaByFile(sessionFile);
  const sourceCwd = parentMeta?.cwd ?? '';
  const repoRoot = sourceCwd ? (job.repoRoot?.trim() || readGitRepoInfo(sourceCwd)?.root) : job.repoRoot?.trim();
  const childEntry = registry.get(job.childConversationId);
  const childSessionFile = childEntry?.session.sessionFile?.trim() || job.childSessionFile?.trim() || '';
  const updatedAt = new Date().toISOString();
  const parentTouchedFiles = readParentTouchedFilesSinceFork(sessionFile, job.forkEntryId, { cwd: sourceCwd, repoRoot });
  const parentMutatingFiles = readParentTouchedFilesSinceFork(sessionFile, job.forkEntryId, {
    cwd: sourceCwd,
    repoRoot,
    includeRead: false,
  });
  const currentDirtyPaths = readParallelCurrentWorktreeDirtyPaths(sourceCwd, repoRoot);
  const next: ParallelPromptJob = {
    ...job,
    ...(childSessionFile ? { childSessionFile } : {}),
    ...(repoRoot ? { repoRoot } : {}),
    updatedAt,
    touchedFiles: Array.isArray(job.touchedFiles) ? job.touchedFiles : [],
    parentTouchedFiles,
    overlapFiles: [],
    sideEffects: Array.isArray(job.sideEffects) ? job.sideEffects : [],
    worktreeDirtyPathsAtStart: normalizeParallelPromptList(job.worktreeDirtyPathsAtStart, 128),
  };

  if (childEntry?.session.isStreaming) {
    next.status = 'running';
    next.overlapFiles = readParallelOverlapFiles({
      mutatingChildFiles: childSessionFile && existsSync(childSessionFile)
        ? readParallelMutatedFilesFromSessionFile(childSessionFile, { cwd: sourceCwd, repoRoot })
        : [],
      parentMutatingFiles,
      currentDirtyPaths,
      worktreeDirtyPathsAtStart: next.worktreeDirtyPathsAtStart,
    });
    return next;
  }

  if (childSessionFile && existsSync(childSessionFile)) {
    const completion = readParallelJobCompletionFromSessionFile(childSessionFile, { cwd: sourceCwd, repoRoot });
    next.touchedFiles = completion.touchedFiles;
    next.sideEffects = completion.sideEffects;
    next.overlapFiles = readParallelOverlapFiles({
      mutatingChildFiles: readParallelMutatedFilesFromSessionFile(childSessionFile, { cwd: sourceCwd, repoRoot }),
      parentMutatingFiles,
      currentDirtyPaths,
      worktreeDirtyPathsAtStart: next.worktreeDirtyPathsAtStart,
    });

    if (completion.status === 'failed') {
      next.status = 'failed';
      delete next.resultText;
      next.error = completion.error;
      return next;
    }

    if (completion.status === 'ready') {
      next.status = 'ready';
      next.resultText = completion.resultText ?? '';
      delete next.error;
      return next;
    }
  }

  next.overlapFiles = readParallelOverlapFiles({
    mutatingChildFiles: [],
    parentMutatingFiles,
    currentDirtyPaths,
    worktreeDirtyPathsAtStart: next.worktreeDirtyPathsAtStart,
  });

  if (next.status === 'importing') {
    next.status = next.error?.trim() ? 'failed' : 'ready';
    return next;
  }

  if (next.status === 'running') {
    next.status = 'failed';
    next.error = next.error?.trim() || 'Parallel prompt was interrupted before producing a final reply.';
  }

  return next;
}

function reconcilePersistedParallelJobs(sessionFile: string, jobs: ParallelPromptJob[]): ParallelPromptJob[] {
  const importedChildConversationIds = readImportedParallelChildConversationIds(sessionFile);
  return jobs
    .filter((job) => !importedChildConversationIds.has(job.childConversationId))
    .map((job) => reconcileParallelPromptJob(sessionFile, job));
}

function loadPersistedParallelJobs(entry: Pick<LiveEntry, 'session'>): ParallelPromptJob[] {
  const sessionFile = entry.session.sessionFile?.trim();
  if (!sessionFile) {
    return [];
  }

  const jobs = reconcilePersistedParallelJobs(sessionFile, readPersistedParallelJobs(sessionFile));
  writePersistedParallelJobs(sessionFile, jobs);
  return jobs;
}

function createParallelPromptJobId(): string {
  parallelPromptJobCounter += 1;
  return `parallel-${parallelPromptJobCounter}`;
}

function truncateParallelPreviewText(text: string, maxLength = 240): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : normalized;
}

function buildParallelPromptPreview(job: ParallelPromptJob): ParallelPromptPreview {
  const attachmentRefs = Array.isArray(job.attachmentRefs) ? job.attachmentRefs : [];
  const touchedFiles = Array.isArray(job.touchedFiles) ? job.touchedFiles : [];
  const parentTouchedFiles = Array.isArray(job.parentTouchedFiles) ? job.parentTouchedFiles : [];
  const overlapFiles = Array.isArray(job.overlapFiles) ? job.overlapFiles : [];
  const sideEffects = Array.isArray(job.sideEffects) ? job.sideEffects : [];
  return {
    id: job.id,
    prompt: truncateParallelPreviewText(job.prompt),
    childConversationId: job.childConversationId,
    status: job.status,
    imageCount: Number.isInteger(job.imageCount) && job.imageCount > 0 ? job.imageCount : 0,
    attachmentRefs: attachmentRefs.slice(0, PARALLEL_PREVIEW_ATTACHMENT_LIMIT),
    touchedFiles: touchedFiles.slice(0, PARALLEL_PREVIEW_PATH_LIMIT),
    parentTouchedFiles: parentTouchedFiles.slice(0, PARALLEL_PREVIEW_PATH_LIMIT),
    overlapFiles: overlapFiles.slice(0, PARALLEL_PREVIEW_PATH_LIMIT),
    sideEffects: sideEffects.slice(0, PARALLEL_PREVIEW_SIDE_EFFECT_LIMIT),
    ...(job.resultText ? { resultPreview: truncateParallelPreviewText(job.resultText) } : {}),
    ...(job.error ? { error: truncateParallelPreviewText(job.error) } : {}),
  };
}

function readParallelState(entry: Pick<LiveEntry, 'parallelJobs'>): ParallelPromptPreview[] {
  const jobs = Array.isArray(entry.parallelJobs) ? entry.parallelJobs : [];
  return jobs.map((job) => buildParallelPromptPreview(job));
}

function removeQueuedUserMessage(
  queue: InternalQueuedAgentMessage[],
  input: { index: number; previewId?: string },
): { message: InternalQueuedAgentMessage; userQueueIndex: number } | undefined {
  const previewId = input.previewId?.trim() || '';
  let userQueueIndex = 0;

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const queuedMessage = queue[queueIndex];
    if (queuedMessage?.role !== 'user') {
      continue;
    }

    const matchesPreviewId = previewId.length > 0
      && queuedMessage.__personalAgentQueuedPromptId === previewId;
    const matchesIndex = previewId.length === 0 && userQueueIndex === input.index;
    if (matchesPreviewId || matchesIndex) {
      return {
        message: queue.splice(queueIndex, 1)[0],
        userQueueIndex,
      };
    }

    userQueueIndex += 1;
  }

  return undefined;
}

function extractQueuedPromptContent(
  message: InternalQueuedAgentMessage | undefined,
  fallbackText: string,
): { text: string; images: PromptImageAttachment[] } {
  const textParts: string[] = [];
  const images: PromptImageAttachment[] = [];
  const content = Array.isArray(message?.content) ? message.content : [];

  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    if ((part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
      textParts.push((part as { text: string }).text);
      continue;
    }

    if ((part as { type?: unknown }).type === 'image'
      && typeof (part as { data?: unknown }).data === 'string'
      && typeof (part as { mimeType?: unknown }).mimeType === 'string') {
      const name = typeof (part as { name?: unknown }).name === 'string'
        ? (part as { name: string }).name
        : undefined;

      images.push({
        type: 'image',
        data: (part as { data: string }).data,
        mimeType: (part as { mimeType: string }).mimeType,
        ...(name ? { name } : {}),
      });
    }
  }

  return {
    text: textParts.join('') || fallbackText,
    images,
  };
}

function buildUserMessageBlock(message: { content?: unknown; timestamp?: string | number }): Extract<DisplayBlock, { type: 'user' }> | null {
  const [block] = buildDisplayBlocksFromEntries([
    {
      id: 'live-user',
      timestamp: message.timestamp ?? Date.now(),
      message: {
        role: 'user',
        content: message.content,
      },
    },
  ]);

  return block?.type === 'user' ? block : null;
}

function buildLiveStateBlocks(session: AgentSession, options: { omitStreamMessage?: boolean } = {}): DisplayBlock[] {
  const state = session.state;
  const messages = state.messages.slice();
  const streamMessage = state.streamingMessage;

  if (streamMessage && !options.omitStreamMessage) {
    messages.push(streamMessage);
  }

  return buildDisplayBlocksFromEntries(messages.map((message, index) => ({
    id: `live-${index}`,
    timestamp: (message as { timestamp?: string | number }).timestamp ?? index,
    message: {
      role: (message as { role?: string }).role ?? 'unknown',
      content: (message as { content?: unknown }).content,
      toolCallId: (message as { toolCallId?: string }).toolCallId,
      toolName: (message as { toolName?: string }).toolName,
      details: (message as { details?: unknown }).details,
      stopReason: (message as { stopReason?: string }).stopReason,
      errorMessage: (message as { errorMessage?: string }).errorMessage,
      summary: (message as { summary?: string }).summary,
      tokensBefore: (message as { tokensBefore?: number }).tokensBefore,
      fromId: (message as { fromId?: string }).fromId,
      customType: (message as { customType?: string }).customType,
      display: (message as { display?: boolean }).display,
      command: (message as { command?: string }).command,
      output: (message as { output?: string }).output,
      exitCode: (message as { exitCode?: number }).exitCode,
      cancelled: (message as { cancelled?: boolean }).cancelled,
      truncated: (message as { truncated?: boolean }).truncated,
      fullOutputPath: (message as { fullOutputPath?: string }).fullOutputPath,
      excludeFromContext: (message as { excludeFromContext?: boolean }).excludeFromContext,
    },
  })));
}

function resolveCompactionSummaryTitle(input: {
  mode: 'manual' | 'auto';
  reason?: 'overflow' | 'threshold' | null;
  willRetry?: boolean;
}): string {
  if (input.mode === 'manual') {
    return 'Manual compaction';
  }

  if (input.reason === 'overflow' || input.willRetry) {
    return 'Overflow recovery compaction';
  }

  return 'Proactive compaction';
}

function applyLatestCompactionSummaryTitle(blocks: DisplayBlock[], title: string | null | undefined): DisplayBlock[] {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) {
    return blocks;
  }

  let index = -1;
  for (let candidateIndex = blocks.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = blocks[candidateIndex];
    if (candidate?.type === 'summary' && candidate.kind === 'compaction') {
      index = candidateIndex;
      break;
    }
  }

  if (index < 0) {
    return blocks;
  }

  const block = blocks[index];
  if (block.type !== 'summary' || block.title === normalizedTitle) {
    return blocks;
  }

  const next = blocks.slice();
  next[index] = {
    ...block,
    title: normalizedTitle,
  };
  return next;
}

function fingerprintDisplayBlock(block: DisplayBlock): string {
  switch (block.type) {
    case 'user':
      return JSON.stringify({
        type: block.type,
        ts: block.ts,
        text: block.text,
        imageCount: block.images?.length ?? 0,
      });
    case 'text':
    case 'thinking':
      return JSON.stringify({ type: block.type, ts: block.ts, text: block.text });
    case 'context':
      return JSON.stringify({ type: block.type, ts: block.ts, text: block.text, customType: block.customType ?? null });
    case 'summary':
      return JSON.stringify({ type: block.type, ts: block.ts, kind: block.kind, title: block.title, text: block.text });
    case 'tool_use':
      return JSON.stringify({
        type: block.type,
        ts: block.ts,
        tool: block.tool,
        toolCallId: block.toolCallId,
        output: block.output,
      });
    case 'image':
      return JSON.stringify({
        type: block.type,
        ts: block.ts,
        alt: block.alt,
        mimeType: block.mimeType,
        caption: block.caption,
        src: block.src?.slice(0, 128),
      });
    case 'error':
      return JSON.stringify({
        type: block.type,
        ts: block.ts,
        tool: block.tool,
        message: block.message,
      });
  }
}

function mergeIdentityKey(block: DisplayBlock): string | null {
  switch (block.type) {
    case 'tool_use':
      return block.toolCallId ? `tool:${block.toolCallId}` : null;
    case 'summary':
      return `summary:${block.kind}:${block.title}:${block.text}`;
    default:
      return null;
  }
}

function parseDisplayBlockTimestampMs(block: DisplayBlock): number | null {
  const ms = Date.parse(block.ts);
  return Number.isFinite(ms) ? ms : null;
}

function mergePersistedIdentityBlock(existing: DisplayBlock, liveBlock: DisplayBlock): DisplayBlock {
  if (existing.type !== liveBlock.type) {
    return liveBlock;
  }

  if (existing.type === 'summary' && liveBlock.type === 'summary') {
    return existing;
  }

  if (existing.type === 'tool_use' && liveBlock.type === 'tool_use') {
    const liveHasOutput = liveBlock.output.trim().length > 0;
    const existingHasOutput = existing.output.trim().length > 0;

    if (!liveHasOutput && existingHasOutput && liveBlock.durationMs === undefined && liveBlock.details === undefined) {
      return existing;
    }

    return {
      ...existing,
      ...liveBlock,
      output: liveHasOutput ? liveBlock.output : existing.output,
      durationMs: liveBlock.durationMs ?? existing.durationMs,
      details: liveBlock.details ?? existing.details,
      outputDeferred: liveBlock.outputDeferred ?? existing.outputDeferred,
    };
  }

  return liveBlock;
}

// Live session state only contains the currently-kept context window after compaction.
// Merge it with the persisted snapshot so reconnects/navigation preserve any durable-only blocks while
// still converging on the compacted view once summaries are present.
function mergeConversationHistoryBlocks(persistedBlocks: DisplayBlock[], liveBlocks: DisplayBlock[]): DisplayBlock[] {
  if (persistedBlocks.length === 0) {
    return liveBlocks;
  }

  if (liveBlocks.length === 0) {
    return persistedBlocks;
  }

  const persistedFingerprints = persistedBlocks.map(fingerprintDisplayBlock);
  const liveFingerprints = liveBlocks.map(fingerprintDisplayBlock);
  const maxOverlap = Math.min(persistedFingerprints.length, liveFingerprints.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true;

    for (let index = 0; index < overlap; index += 1) {
      if (persistedFingerprints[persistedFingerprints.length - overlap + index] !== liveFingerprints[index]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return [...persistedBlocks, ...liveBlocks.slice(overlap)];
    }
  }

  const merged = [...persistedBlocks];
  const seenFingerprints = new Set(persistedFingerprints);
  const mergedIndexByIdentity = new Map<string, number>();
  const latestPersistedTimestampMs = parseDisplayBlockTimestampMs(persistedBlocks[persistedBlocks.length - 1]);
  let lastMatchedLiveIndex = -1;

  for (const [index, block] of merged.entries()) {
    const identityKey = mergeIdentityKey(block);
    if (identityKey) {
      mergedIndexByIdentity.set(identityKey, index);
    }
  }

  for (const [liveIndex, liveBlock] of liveBlocks.entries()) {
    const identityKey = mergeIdentityKey(liveBlock);
    if (identityKey) {
      const existingIndex = mergedIndexByIdentity.get(identityKey);
      if (existingIndex !== undefined) {
        const mergedBlock = mergePersistedIdentityBlock(merged[existingIndex], liveBlock);
        merged[existingIndex] = mergedBlock;
        seenFingerprints.add(fingerprintDisplayBlock(mergedBlock));
        lastMatchedLiveIndex = liveIndex;
        continue;
      }
    }

    const fingerprint = fingerprintDisplayBlock(liveBlock);
    if (seenFingerprints.has(fingerprint)) {
      lastMatchedLiveIndex = liveIndex;
    }
  }

  const appendStartIndex = lastMatchedLiveIndex >= 0 ? lastMatchedLiveIndex + 1 : 0;

  for (let liveIndex = appendStartIndex; liveIndex < liveBlocks.length; liveIndex += 1) {
    const liveBlock = liveBlocks[liveIndex];
    const identityKey = mergeIdentityKey(liveBlock);
    if (identityKey) {
      const existingIndex = mergedIndexByIdentity.get(identityKey);
      if (existingIndex !== undefined) {
        const mergedBlock = mergePersistedIdentityBlock(merged[existingIndex], liveBlock);
        merged[existingIndex] = mergedBlock;
        seenFingerprints.add(fingerprintDisplayBlock(mergedBlock));
        continue;
      }
    }

    const fingerprint = fingerprintDisplayBlock(liveBlock);
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }

    if (latestPersistedTimestampMs !== null) {
      const liveTimestampMs = parseDisplayBlockTimestampMs(liveBlock);
      if (liveTimestampMs !== null && liveTimestampMs < latestPersistedTimestampMs) {
        continue;
      }
    }

    merged.push(liveBlock);
    seenFingerprints.add(fingerprint);

    if (identityKey) {
      mergedIndexByIdentity.set(identityKey, merged.length - 1);
    }
  }

  return merged;
}

const DEFAULT_LIVE_SNAPSHOT_TAIL_BLOCKS = 400;

function ensureHiddenTurnState(entry: LiveEntry): void {
  if (!Array.isArray(entry.pendingHiddenTurnCustomTypes)) {
    entry.pendingHiddenTurnCustomTypes = [];
  }
  if (typeof entry.activeHiddenTurnCustomType === 'undefined') {
    entry.activeHiddenTurnCustomType = null;
  }
}

function buildLiveSnapshot(entry: LiveEntry, tailBlocks?: number): {
  blocks: DisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  isStreaming: boolean;
} {
  ensureHiddenTurnState(entry);
  const liveBlocks = buildLiveStateBlocks(entry.session, {
    omitStreamMessage: Boolean(entry.activeHiddenTurnCustomType),
  });
  const sessionFile = entry.session.sessionFile?.trim();
  if (!sessionFile || !existsSync(sessionFile)) {
    return {
      blocks: applyLatestCompactionSummaryTitle(liveBlocks, entry.lastCompactionSummaryTitle),
      blockOffset: 0,
      totalBlocks: liveBlocks.length,
      isStreaming: entry.session.isStreaming,
    };
  }

  const persisted = readSessionBlocksByFile(sessionFile, { tailBlocks: tailBlocks ?? DEFAULT_LIVE_SNAPSHOT_TAIL_BLOCKS });
  if (!persisted || persisted.blocks.length === 0) {
    return {
      blocks: applyLatestCompactionSummaryTitle(liveBlocks, entry.lastCompactionSummaryTitle),
      blockOffset: 0,
      totalBlocks: liveBlocks.length,
      isStreaming: entry.session.isStreaming,
    };
  }

  // session.state.messages is the *current context window*, not a chronological display transcript.
  // After compaction it can reorder blocks as: summary → pre-compaction tail → post-compaction tail.
  // For idle live sessions we should render the durable transcript from disk exactly as persisted.
  if (!entry.session.isStreaming) {
    return {
      blocks: applyLatestCompactionSummaryTitle(persisted.blocks, entry.lastCompactionSummaryTitle),
      blockOffset: persisted.blockOffset,
      totalBlocks: persisted.totalBlocks,
      isStreaming: entry.session.isStreaming,
    };
  }

  const blocks = mergeConversationHistoryBlocks(persisted.blocks, liveBlocks);
  return {
    blocks: applyLatestCompactionSummaryTitle(blocks, entry.lastCompactionSummaryTitle),
    blockOffset: persisted.blockOffset,
    totalBlocks: persisted.blockOffset + blocks.length,
    isStreaming: entry.session.isStreaming,
  };
}

function broadcastSnapshot(entry: LiveEntry): void {
  for (const listener of entry.listeners) {
    listener.send({
      type: 'snapshot',
      ...buildLiveSnapshot(entry, listener.tailBlocks),
    });
  }
}

function publishSessionMetaChanged(sessionId: string): void {
  publishAppEvent({ type: 'session_meta_changed', sessionId });
}

export function readLiveSessionStateSnapshot(sessionId: string, tailBlocks?: number): LiveSessionStateSnapshot {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  let tokens: LiveSessionStateSnapshot['tokens'] = null;
  let cost: number | null = null;
  try {
    const stats = entry.session.getSessionStats();
    tokens = stats.tokens;
    cost = stats.cost;
  } catch {
    tokens = null;
    cost = null;
  }

  return {
    ...buildLiveSnapshot(entry, tailBlocks),
    hasSnapshot: true,
    isStreaming: entry.session.isStreaming && !entry.activeHiddenTurnCustomType,
    isCompacting: entry.isCompacting === true,
    hasPendingHiddenTurn: hasQueuedOrActiveHiddenTurn(entry),
    error: entry.currentTurnError ?? null,
    title: resolveEntryTitle(entry),
    tokens,
    cost,
    contextUsage: readContextUsagePayload(entry.session),
    pendingQueue: readQueueState(entry.session),
    parallelJobs: readParallelState(entry),
    presence: buildPresenceState(entry),
    autoModeState: readConversationAutoModeState(entry),
    cwdChange: null,
  };
}

function broadcastTitle(entry: LiveEntry): void {
  const title = resolveEntryTitle(entry);
  if (!title) {
    return;
  }

  entry.title = title;
  broadcast(entry, { type: 'title_update', title });
  publishAppEvent({ type: 'live_title', sessionId: entry.sessionId, title });
  publishSessionMetaChanged(entry.sessionId);
}

function applySessionTitle(entry: LiveEntry, title: string): void {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return;
  }

  entry.session.setSessionName(normalizedTitle);
  entry.title = normalizedTitle;
  broadcastTitle(entry);
}

function resolveLiveSessionProfile(): string | undefined {
  const profile = process.env.PERSONAL_AGENT_ACTIVE_PROFILE ?? process.env.PERSONAL_AGENT_PROFILE;
  const normalized = profile?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

async function syncDurableConversationRun(
  entry: LiveEntry,
  state: WebLiveConversationRunState,
  input: { force?: boolean; lastError?: string } = {},
): Promise<void> {
  const sessionFile = entry.session.sessionFile?.trim();
  if (!sessionFile) {
    return;
  }

  if (!input.force && entry.lastDurableRunState === state && !input.lastError) {
    return;
  }

  try {
    await syncWebLiveConversationRun({
      conversationId: entry.sessionId,
      sessionFile,
      cwd: entry.cwd,
      title: resolveEntryTitle(entry),
      profile: resolveLiveSessionProfile(),
      state,
      lastError: input.lastError,
    });
    entry.lastDurableRunState = state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${new Date().toISOString()}] [web] [error] conversation durable run sync failed sessionId=${entry.sessionId} state=${state} message=${message}`);
  }
}

function maybeAutoTitleConversation(entry: LiveEntry): void {
  if (entry.autoTitleRequested) {
    return;
  }

  if (entry.session.sessionName?.trim()) {
    entry.autoTitleRequested = true;
    return;
  }

  const messages = getSessionMessages(entry.session);
  if (!hasAssistantTitleSourceMessage(messages)) {
    return;
  }

  entry.autoTitleRequested = true;
  void generateConversationTitle({
    messages,
    modelRegistry: entry.session.modelRegistry,
    settingsFile: SETTINGS_FILE,
  })
    .then((title) => {
      if (registry.get(entry.sessionId) !== entry) {
        return;
      }

      if (entry.session.sessionName?.trim()) {
        entry.autoTitleRequested = true;
        return;
      }

      if (!title) {
        entry.autoTitleRequested = false;
        return;
      }

      applySessionTitle(entry, title);
    })
    .catch((error) => {
      if (registry.get(entry.sessionId) === entry && !entry.session.sessionName?.trim()) {
        entry.autoTitleRequested = false;
      }

      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error(`[${new Date().toISOString()}] [web] [error] conversation auto-title failed sessionId=${entry.sessionId} message=${message}`);
      if (stack) {
        console.error(stack);
      }
    });
}

function broadcastContextUsage(entry: LiveEntry, force = false): void {
  const usage = readContextUsagePayload(entry.session);
  const nextJson = JSON.stringify(usage);
  if (!force && entry.lastContextUsageJson === nextJson) {
    return;
  }

  entry.lastContextUsageJson = nextJson;
  broadcast(entry, { type: 'context_usage', usage });
}

function broadcastQueueState(entry: LiveEntry, force = false): void {
  const queueState = readQueueState(entry.session);
  const nextJson = JSON.stringify(queueState);
  if (!force && entry.lastQueueStateJson === nextJson) {
    return;
  }

  entry.lastQueueStateJson = nextJson;
  broadcast(entry, { type: 'queue_state', ...queueState });
}

function broadcastParallelState(entry: LiveEntry, force = false): void {
  const jobs = readParallelState(entry);
  const nextJson = JSON.stringify(jobs);
  if (!force && entry.lastParallelStateJson === nextJson) {
    return;
  }

  entry.lastParallelStateJson = nextJson;
  broadcast(entry, { type: 'parallel_state', jobs });
}

function readConversationAutoModeState(entry: Pick<LiveEntry, 'session'>): ConversationAutoModeState {
  return readConversationAutoModeStateFromSessionManager(entry.session.sessionManager);
}

function broadcastAutoModeState(entry: LiveEntry, force = false): void {
  const state = readConversationAutoModeState(entry);
  const nextJson = JSON.stringify(state);
  if (!force && entry.lastAutoModeStateJson === nextJson) {
    return;
  }

  entry.lastAutoModeStateJson = nextJson;
  broadcast(entry, { type: 'auto_mode_state', state });
}

function shouldExposeHiddenTurnInTranscript(customType: string | null | undefined): boolean {
  return customType === CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE
    || customType === CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE;
}

function shouldSuppressLiveEventForHiddenTurn(entry: LiveEntry, event: AgentSessionEvent): boolean {
  ensureHiddenTurnState(entry);
  if (!entry.activeHiddenTurnCustomType) {
    return false;
  }

  if (shouldExposeHiddenTurnInTranscript(entry.activeHiddenTurnCustomType)) {
    return false;
  }

  return event.type === 'agent_start'
    || event.type === 'agent_end'
    || event.type === 'turn_end'
    || event.type === 'message_update'
    || event.type === 'message_end'
    || event.type === 'tool_execution_start'
    || event.type === 'tool_execution_update'
    || event.type === 'tool_execution_end';
}

function scheduleContextUsage(entry: LiveEntry, delayMs = 400): void {
  if (entry.contextUsageTimer) {
    return;
  }

  entry.contextUsageTimer = setTimeout(() => {
    entry.contextUsageTimer = undefined;
    broadcastContextUsage(entry);
  }, delayMs);
}

function clearContextUsageTimer(entry: LiveEntry): void {
  if (!entry.contextUsageTimer) {
    return;
  }

  clearTimeout(entry.contextUsageTimer);
  entry.contextUsageTimer = undefined;
}

function ensurePresenceMap(entry: LiveEntry): Map<string, LiveSurfacePresenceRecord> {
  entry.presenceBySurfaceId ??= new Map<string, LiveSurfacePresenceRecord>();
  entry.controllerSurfaceId ??= null;
  entry.controllerAcquiredAt ??= null;
  return entry.presenceBySurfaceId;
}

function buildPresenceState(entry: LiveEntry): LiveSessionPresenceState {
  const presenceBySurfaceId = ensurePresenceMap(entry);
  const surfaces = [...presenceBySurfaceId.values()]
    .sort((left, right) => {
      const byConnectedAt = left.connectedAt.localeCompare(right.connectedAt);
      return byConnectedAt !== 0 ? byConnectedAt : left.surfaceId.localeCompare(right.surfaceId);
    })
    .map((surface) => ({
      surfaceId: surface.surfaceId,
      surfaceType: surface.surfaceType,
      connectedAt: surface.connectedAt,
    }));
  const controller = entry.controllerSurfaceId ? presenceBySurfaceId.get(entry.controllerSurfaceId) ?? null : null;

  return {
    surfaces,
    controllerSurfaceId: controller?.surfaceId ?? null,
    controllerSurfaceType: controller?.surfaceType ?? null,
    controllerAcquiredAt: controller ? entry.controllerAcquiredAt ?? null : null,
  };
}

function broadcastPresenceState(entry: LiveEntry, options?: { exclude?: LiveListener }): void {
  broadcast(entry, { type: 'presence_state', state: buildPresenceState(entry) }, options);
}

function registerLiveSurface(entry: LiveEntry, input: {
  surfaceId: string;
  surfaceType: LiveSessionSurfaceType;
}): boolean {
  const surfaceId = input.surfaceId.trim();
  if (!surfaceId) {
    return false;
  }

  const presenceBySurfaceId = ensurePresenceMap(entry);
  const existing = presenceBySurfaceId.get(surfaceId);
  if (existing) {
    existing.connections += 1;
    if (existing.surfaceType !== input.surfaceType) {
      existing.surfaceType = input.surfaceType;
      return true;
    }
    return false;
  }

  presenceBySurfaceId.set(surfaceId, {
    surfaceId,
    surfaceType: input.surfaceType,
    connectedAt: new Date().toISOString(),
    connections: 1,
  });

  const currentController = entry.controllerSurfaceId
    ? presenceBySurfaceId.get(entry.controllerSurfaceId) ?? null
    : null;
  const shouldAdoptController = !currentController || currentController.surfaceType === input.surfaceType;

  if (shouldAdoptController && entry.controllerSurfaceId !== surfaceId) {
    entry.controllerSurfaceId = surfaceId;
    entry.controllerAcquiredAt = new Date().toISOString();
  }

  return true;
}

function removeLiveSurface(entry: LiveEntry, surfaceId: string): boolean {
  const trimmedSurfaceId = surfaceId.trim();
  if (!trimmedSurfaceId) {
    return false;
  }

  const presenceBySurfaceId = ensurePresenceMap(entry);
  const existing = presenceBySurfaceId.get(trimmedSurfaceId);
  if (!existing) {
    return false;
  }

  if (existing.connections > 1) {
    existing.connections -= 1;
    return false;
  }

  presenceBySurfaceId.delete(trimmedSurfaceId);

  if (entry.controllerSurfaceId === trimmedSurfaceId) {
    entry.controllerSurfaceId = null;
    entry.controllerAcquiredAt = null;
  }

  return true;
}

function assertSurfaceCanControl(entry: LiveEntry, surfaceId?: string): void {
  if (!surfaceId) {
    return;
  }

  const trimmedSurfaceId = surfaceId.trim();
  if (!trimmedSurfaceId) {
    throw new LiveSessionControlError('Surface id is required to control this conversation.');
  }

  const presenceBySurfaceId = ensurePresenceMap(entry);
  if (!presenceBySurfaceId.has(trimmedSurfaceId)) {
    throw new LiveSessionControlError();
  }

  if (!entry.controllerSurfaceId) {
    throw new LiveSessionControlError('No surface is currently controlling this conversation. Take over here to continue.');
  }

  if (entry.controllerSurfaceId !== trimmedSurfaceId) {
    throw new LiveSessionControlError();
  }
}

export function ensureSessionSurfaceCanControl(sessionId: string, surfaceId?: string): void {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  assertSurfaceCanControl(entry, surfaceId);
}

export function takeOverSessionControl(sessionId: string, surfaceId: string): LiveSessionPresenceState {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  const trimmedSurfaceId = surfaceId.trim();
  const presenceBySurfaceId = ensurePresenceMap(entry);
  if (!trimmedSurfaceId || !presenceBySurfaceId.has(trimmedSurfaceId)) {
    throw new LiveSessionControlError('Open the conversation on this surface before taking control.');
  }

  if (entry.controllerSurfaceId !== trimmedSurfaceId) {
    entry.controllerSurfaceId = trimmedSurfaceId;
    entry.controllerAcquiredAt = new Date().toISOString();
    broadcastPresenceState(entry);
  }

  return buildPresenceState(entry);
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireSession(
  id: string,
  session: AgentSession,
  cwd: string,
  options: { autoTitleRequested?: boolean } = {},
) {
  const entry: LiveEntry = {
    sessionId: id,
    session,
    cwd,
    listeners: new Set(),
    title: resolveStableSessionTitle(session),
    autoTitleRequested: options.autoTitleRequested ?? false,
    lastContextUsageJson: null,
    lastQueueStateJson: null,
    lastParallelStateJson: null,
    currentTurnError: null,
    pendingHiddenTurnCustomTypes: [],
    activeHiddenTurnCustomType: null,
    pendingAutoModeContinuation: false,
    pendingAutoCompactionReason: null,
    lastCompactionSummaryTitle: null,
    isCompacting: false,
    parallelJobs: [],
    importingParallelJobs: false,
    presenceBySurfaceId: new Map(),
    controllerSurfaceId: null,
    controllerAcquiredAt: null,

  };
  entry.parallelJobs = loadPersistedParallelJobs(entry);
  registry.set(id, entry);
  publishSessionMetaChanged(id);
  void syncDurableConversationRun(entry, session.isStreaming ? 'running' : 'waiting', { force: true });
  maybeAutoTitleConversation(entry);
  if (entry.parallelJobs.length > 0) {
    queueMicrotask(() => {
      void tryImportReadyParallelJobs(entry);
    });
  }

  session.subscribe((event: AgentSessionEvent) => {
    ensureHiddenTurnState(entry);
    if (event.type === 'agent_start' && !entry.activeHiddenTurnCustomType && entry.pendingHiddenTurnCustomTypes.length > 0) {
      entry.activeHiddenTurnCustomType = entry.pendingHiddenTurnCustomTypes.shift() ?? null;
    }
    const activeHiddenTurnCustomType = entry.activeHiddenTurnCustomType;
    const suppressLiveEvent = shouldSuppressLiveEventForHiddenTurn(entry, event);

    if (event.type === 'turn_end') {
      if (!activeHiddenTurnCustomType) {
        maybeAutoTitleConversation(entry);
      }
      if (activeHiddenTurnCustomType === CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE) {
        const shouldContinueAutoMode = entry.pendingAutoModeContinuation === true;
        entry.pendingAutoModeContinuation = false;
        if (shouldContinueAutoMode) {
          queueMicrotask(() => {
            void Promise.resolve(requestConversationAutoModeContinuationTurn(entry.sessionId)).catch((error) => {
              logWarn('conversation auto mode continuation request failed', {
                sessionId: entry.sessionId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
              });
            });
          });
        }
      }
      void syncDurableConversationRun(entry, 'waiting');
      notifyLiveSessionLifecycleHandlers(entry, 'turn_end');
      void applyPendingConversationWorkingDirectoryChange(entry);
    }

    if (event.type === 'agent_start' || event.type === 'message_update' || event.type === 'tool_execution_start' || event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      scheduleContextUsage(entry);
    }

    if (event.type === 'agent_start') {
      entry.currentTurnError = null;
      publishSessionMetaChanged(entry.sessionId);
      void syncDurableConversationRun(entry, 'running');
    }

    if (event.type === 'agent_end') {
      if (!entry.activeHiddenTurnCustomType) {
        maybeAutoTitleConversation(entry);
      }
      void syncDurableConversationRun(entry, 'waiting');
    }

    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const errorMessage = getAssistantErrorDisplayMessage(event.message);
      if (errorMessage) {
        entry.currentTurnError = errorMessage;
      }
    }

    if (event.type === 'queue_update') {
      broadcastQueueState(entry, true);
    }

    if (event.type === 'message_start' && event.message.role === 'user') {
      if (!entry.session.sessionName?.trim() && isPlaceholderConversationTitle(entry.title)) {
        const fallbackTitle = buildFallbackTitleFromContent(event.message.content);
        if (fallbackTitle) {
          entry.title = fallbackTitle;
          broadcastTitle(entry);
        }
      }
      broadcastQueueState(entry);
    }

    // Emit stats after agent_end
    if (event.type === 'agent_end') {
      try {
        const stats = session.getSessionStats();
        broadcast(entry, { type: 'stats_update', tokens: stats.tokens, cost: stats.cost });
      } catch { /* ignore */ }
      clearContextUsageTimer(entry);
      broadcastContextUsage(entry, true);
    }

    if (event.type === 'turn_end') {
      clearContextUsageTimer(entry);
      broadcastContextUsage(entry, true);
      publishSessionMetaChanged(entry.sessionId);
    }

    if (event.type === 'compaction_start') {
      entry.isCompacting = true;
      entry.pendingAutoCompactionReason = event.reason === 'manual' ? null : event.reason;
    }

    if (event.type === 'compaction_end') {
      entry.isCompacting = false;
      const compactionReason = event.reason === 'manual' ? null : event.reason;
      entry.pendingAutoCompactionReason = null;

      if (compactionReason && !event.aborted && event.result) {
        entry.lastCompactionSummaryTitle = resolveCompactionSummaryTitle({
          mode: 'auto',
          reason: compactionReason,
          willRetry: event.willRetry,
        });
        broadcastSnapshot(entry);
        clearContextUsageTimer(entry);
        broadcastContextUsage(entry, true);
        publishSessionMetaChanged(entry.sessionId);
        notifyLiveSessionLifecycleHandlers(entry, 'auto_compaction_end');
      }
    }

    const sse = toSse(event);
    if (sse && !suppressLiveEvent) {
      broadcast(entry, sse);
    }

    if ((event.type === 'turn_end' || event.type === 'agent_end') && entry.activeHiddenTurnCustomType) {
      entry.activeHiddenTurnCustomType = null;
    }

    if (event.type === 'turn_end' || event.type === 'agent_end') {
      void tryImportReadyParallelJobs(entry);
    }
  });


  return entry;
}

export function toSse(event: AgentSessionEvent): SseEvent | null {
  switch (event.type) {
    case 'agent_start': return { type: 'agent_start' };
    case 'agent_end':   return { type: 'agent_end' };
    case 'turn_end':    return { type: 'turn_end' };

    case 'message_start': {
      if (event.message.role !== 'user') {
        return null;
      }

      const block = buildUserMessageBlock(event.message);
      return block ? { type: 'user_message', block } : null;
    }

    case 'message_end': {
      if (event.message.role !== 'assistant') {
        return null;
      }

      const errorMessage = getAssistantErrorDisplayMessage(event.message);
      return errorMessage ? { type: 'error', message: errorMessage } : null;
    }

    case 'message_update': {
      const e = event.assistantMessageEvent;
      if (e.type === 'text_delta')     return { type: 'text_delta',     delta: e.delta };
      if (e.type === 'thinking_delta') return { type: 'thinking_delta', delta: e.delta };
      return null;
    }

    case 'tool_execution_start':
      toolTimings.set(event.toolCallId, Date.now());
      return { type: 'tool_start', toolCallId: event.toolCallId, toolName: event.toolName, args: event.args };

    case 'tool_execution_update':
      return { type: 'tool_update', toolCallId: event.toolCallId, partialResult: event.partialResult };

    case 'tool_execution_end': {
      const start = toolTimings.get(event.toolCallId) ?? Date.now();
      toolTimings.delete(event.toolCallId);
      // Extract final text output from result
      const result = event.result as { content?: Array<{ type: string; text?: string }>; details?: unknown } | undefined;
      const outputText = result?.content
        ?.filter(c => c.type === 'text')
        .map(c => c.text ?? '')
        .join('\n')
        .slice(0, 8000) ?? '';
      return {
        type:       'tool_end',
        toolCallId: event.toolCallId,
        toolName:   event.toolName,
        isError:    event.isError,
        durationMs: Date.now() - start,
        output:     outputText,
        details:    result?.details,
      };
    }

    case 'compaction_start':
      return { type: 'compaction_start', mode: event.reason === 'manual' ? 'manual' : 'auto' };

    default:
      return null;
  }
}

function broadcast(entry: LiveEntry, event: SseEvent, options?: { exclude?: LiveListener }) {
  for (const listener of entry.listeners) {
    if (listener === options?.exclude) {
      continue;
    }
    listener.send(event);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isLive(sessionId: string): boolean {
  return registry.has(sessionId);
}

export function getLiveSessions() {
  return Array.from(registry.entries()).map(([id, entry]) => ({
    id,
    cwd: entry.cwd,
    sessionFile: resolveLiveSessionFile(entry.session) ?? '',
    title: resolveEntryTitle(entry),
    isStreaming: entry.session.isStreaming && !entry.activeHiddenTurnCustomType,
    hasPendingHiddenTurn: hasQueuedOrActiveHiddenTurn(entry),
  }));
}

export function getLiveSessionForkEntries(sessionId: string): unknown[] | null {
  const entry = registry.get(sessionId);
  if (!entry) {
    return null;
  }
  return entry.session.getUserMessagesForForking();
}

export function getAvailableModelObjects() {
  const auth = makeAuth();
  const registry = makeRegistry(auth);
  return registry.getAvailable();
}

export function getAvailableModels() {
  return getAvailableModelObjects().map((model) => {
    const contextWindow = normalizeModelContextWindow(model.id, model.contextWindow, 128_000);
    return {
      id: model.id,
      name: model.name ?? model.id,
      context: contextWindow,
      contextWindow,
      provider: (model as { provider?: string }).provider ?? '',
      api: (model as { api?: string }).api,
    };
  });
}

const NEW_SESSION_PROMPT_PROBE = 'hello';

interface BeforeAgentStartProbeMessage {
  customType: string;
  content: string;
  display?: boolean;
  details?: unknown;
}

interface BeforeAgentStartProbeRunner {
  emitBeforeAgentStart: (
    prompt: string,
    images: unknown[] | undefined,
    systemPrompt: string,
  ) => Promise<{
    messages?: BeforeAgentStartProbeMessage[];
    systemPrompt?: string;
  } | undefined>;
}

async function inspectNewSessionRequest(session: AgentSession): Promise<{
  newSessionSystemPrompt: string;
  newSessionInjectedMessages: BeforeAgentStartProbeMessage[];
  newSessionToolDefinitions: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    active: true;
  }>;
}> {
  const baseSystemPrompt = session.systemPrompt;
  const extensionRunner = (session as unknown as { _extensionRunner?: BeforeAgentStartProbeRunner })._extensionRunner;
  const beforeAgentStartResult = extensionRunner
    ? await extensionRunner.emitBeforeAgentStart(NEW_SESSION_PROMPT_PROBE, undefined, baseSystemPrompt)
    : undefined;

  return {
    newSessionSystemPrompt: beforeAgentStartResult?.systemPrompt ?? baseSystemPrompt,
    newSessionInjectedMessages: beforeAgentStartResult?.messages ?? [],
    newSessionToolDefinitions: session.state.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
      active: true as const,
    })),
  };
}

export async function inspectAvailableTools(
  cwd: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{
  cwd: string;
  activeTools: string[];
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    active: boolean;
  }>;
  newSessionSystemPrompt: string;
  newSessionInjectedMessages: BeforeAgentStartProbeMessage[];
  newSessionToolDefinitions: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    active: true;
  }>;
}> {
  const auth = makeAuth();
  const resourceLoader = await makeLoader(cwd, options);
  const { session } = await createAgentSession({
    cwd,
    agentDir: options.agentDir ?? AGENT_DIR,
    authStorage: auth,
    modelRegistry: makeRegistry(auth),
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
  });

  try {
    const activeTools = session.getActiveToolNames();
    const activeToolSet = new Set(activeTools);
    const tools = session.getAllTools()
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
        active: activeToolSet.has(tool.name),
      }))
      .sort((left, right) => {
        if (left.active !== right.active) {
          return left.active ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });
    const newSessionRequest = await inspectNewSessionRequest(session);

    return {
      cwd,
      activeTools,
      tools,
      ...newSessionRequest,
    };
  } finally {
    session.dispose();
  }
}

export function getSessionStats(sessionId: string) {
  const entry = registry.get(sessionId);
  if (!entry) return null;
  try { return entry.session.getSessionStats(); } catch { return null; }
}

export function getSessionContextUsage(sessionId: string): LiveContextUsage | null {
  const entry = registry.get(sessionId);
  if (!entry) return null;
  return readContextUsagePayload(entry.session);
}

export interface LiveSessionLoaderOptions {
  agentDir?: string;
  extensionFactories?: ExtensionFactory[];
  additionalExtensionPaths?: string[];
  additionalSkillPaths?: string[];
  additionalPromptTemplatePaths?: string[];
  additionalThemePaths?: string[];
  initialModel?: string | null;
  initialThinkingLevel?: string | null;
  initialServiceTier?: string | null;
}

interface PrewarmedLiveSessionLoaderEntry {
  loader: DefaultResourceLoader;
  warmedAtMs: number;
}

const PREWARMED_LIVE_SESSION_LOADERS_MAX = 4;
const PREWARMED_LIVE_SESSION_LOADERS_TTL_MS = 60_000;
const prewarmedLiveSessionLoaders = new Map<string, PrewarmedLiveSessionLoaderEntry>();
const inflightLiveSessionLoaderWarmups = new Map<string, Promise<DefaultResourceLoader>>();

function normalizeLiveSessionLoaderPaths(paths: string[] | undefined): string[] {
  return [...new Set((paths ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function buildLiveSessionLoaderCacheKey(cwd: string, options: LiveSessionLoaderOptions = {}): string {
  return JSON.stringify({
    cwd,
    agentDir: options.agentDir ?? AGENT_DIR,
    extensionFactories: (options.extensionFactories ?? []).map((factory, index) => factory.name || `factory-${String(index)}`),
    additionalExtensionPaths: normalizeLiveSessionLoaderPaths(options.additionalExtensionPaths),
    additionalSkillPaths: normalizeLiveSessionLoaderPaths(options.additionalSkillPaths),
    additionalPromptTemplatePaths: normalizeLiveSessionLoaderPaths(options.additionalPromptTemplatePaths),
    additionalThemePaths: normalizeLiveSessionLoaderPaths(options.additionalThemePaths),
  });
}

function createLiveSessionLoader(cwd: string, options: LiveSessionLoaderOptions = {}): DefaultResourceLoader {
  return new DefaultResourceLoader({
    cwd,
    agentDir: options.agentDir ?? AGENT_DIR,
    extensionFactories: options.extensionFactories,
    additionalExtensionPaths: options.additionalExtensionPaths,
    additionalSkillPaths: options.additionalSkillPaths,
    additionalPromptTemplatePaths: options.additionalPromptTemplatePaths,
    additionalThemePaths: options.additionalThemePaths,
  });
}

function trimPrewarmedLiveSessionLoaders(): void {
  while (prewarmedLiveSessionLoaders.size > PREWARMED_LIVE_SESSION_LOADERS_MAX) {
    const oldestKey = prewarmedLiveSessionLoaders.keys().next().value;
    if (!oldestKey) {
      break;
    }

    prewarmedLiveSessionLoaders.delete(oldestKey);
  }
}

function readPrewarmedLiveSessionLoader(cacheKey: string): DefaultResourceLoader | undefined {
  const cached = prewarmedLiveSessionLoaders.get(cacheKey);
  if (!cached) {
    return undefined;
  }

  if ((Date.now() - cached.warmedAtMs) > PREWARMED_LIVE_SESSION_LOADERS_TTL_MS) {
    prewarmedLiveSessionLoaders.delete(cacheKey);
    return undefined;
  }

  prewarmedLiveSessionLoaders.delete(cacheKey);
  return cached.loader;
}

async function loadLiveSessionLoaderFresh(cwd: string, options: LiveSessionLoaderOptions = {}): Promise<DefaultResourceLoader> {
  const loader = createLiveSessionLoader(cwd, options);
  await loader.reload();
  return loader;
}

export function clearPrewarmedLiveSessionLoaders(): void {
  prewarmedLiveSessionLoaders.clear();
  inflightLiveSessionLoaderWarmups.clear();
}

export async function prewarmLiveSessionLoader(cwd: string, options: LiveSessionLoaderOptions = {}): Promise<void> {
  const cacheKey = buildLiveSessionLoaderCacheKey(cwd, options);
  const cached = prewarmedLiveSessionLoaders.get(cacheKey);
  if (cached && (Date.now() - cached.warmedAtMs) <= PREWARMED_LIVE_SESSION_LOADERS_TTL_MS) {
    return;
  }

  const inflight = inflightLiveSessionLoaderWarmups.get(cacheKey);
  if (inflight) {
    await inflight;
    return;
  }

  const warmup = loadLiveSessionLoaderFresh(cwd, options)
    .then((loader) => {
      prewarmedLiveSessionLoaders.delete(cacheKey);
      prewarmedLiveSessionLoaders.set(cacheKey, {
        loader,
        warmedAtMs: Date.now(),
      });
      trimPrewarmedLiveSessionLoaders();
      return loader;
    })
    .finally(() => {
      inflightLiveSessionLoaderWarmups.delete(cacheKey);
    });

  inflightLiveSessionLoaderWarmups.set(cacheKey, warmup);
  await warmup;
}

function queuePrewarmLiveSessionLoader(cwd: string, options: LiveSessionLoaderOptions = {}): void {
  void prewarmLiveSessionLoader(cwd, options).catch((error) => {
    logWarn('live session loader prewarm failed', {
      cwd,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });
}

async function makeLoader(cwd: string, options: LiveSessionLoaderOptions = {}) {
  const cacheKey = buildLiveSessionLoaderCacheKey(cwd, options);
  const prewarmed = readPrewarmedLiveSessionLoader(cacheKey);
  if (prewarmed) {
    return prewarmed;
  }

  const inflight = inflightLiveSessionLoaderWarmups.get(cacheKey);
  if (inflight) {
    const warmed = await inflight;
    return readPrewarmedLiveSessionLoader(cacheKey) ?? warmed;
  }

  return loadLiveSessionLoaderFresh(cwd, options);
}

async function repairSessionModelProvider(session: Pick<AgentSession, 'setModel' | 'sessionManager' | 'model'>, models: ReturnType<ModelRegistry['getAvailable']>): Promise<void> {
  const currentId = session.model?.id ?? '';
  const currentProvider = (session.model as { provider?: string } | undefined)?.provider ?? '';
  if (!currentId) {
    return;
  }

  const exactMatch = models.find((candidate) => candidate.id === currentId && candidate.provider === currentProvider);
  if (exactMatch) {
    return;
  }

  const idMatches = models.filter((candidate) => candidate.id === currentId);
  if (idMatches.length !== 1) {
    return;
  }

  const repairedModel = idMatches[0]!;
  await session.setModel(repairedModel);
  session.sessionManager.appendModelChange(repairedModel.provider, repairedModel.id);
}

/** Create a brand-new Pi session. */
export async function createSession(
  cwd: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{ id: string; sessionFile: string }> {
  const auth = makeAuth();
  const modelRegistry = makeRegistry(auth);
  const resourceLoader = await makeLoader(cwd, options);
  const sessionManager = SessionManager.create(cwd, resolvePersistentSessionDir(cwd));
  const { session } = await createAgentSession({
    cwd,
    agentDir: options.agentDir ?? AGENT_DIR,
    authStorage: auth,
    modelRegistry,
    resourceLoader,
    sessionManager,
  });

  patchConversationBashTool(session, cwd, session.sessionId, resolveLiveSessionFile(session));
  patchSessionManagerPersistence(session.sessionManager);
  ensureSessionFileExists(session.sessionManager);

  const availableModels = modelRegistry.getAvailable();
  await repairSessionModelProvider(session, availableModels);

  if (options.initialModel !== undefined || options.initialThinkingLevel !== undefined || options.initialServiceTier !== undefined) {
    await applyConversationModelPreferencesToLiveSession(
      session,
      {
        ...(options.initialModel !== undefined ? { model: options.initialModel } : {}),
        ...(options.initialThinkingLevel !== undefined ? { thinkingLevel: options.initialThinkingLevel } : {}),
        ...(options.initialServiceTier !== undefined ? { serviceTier: options.initialServiceTier } : {}),
      },
      {
        currentModel: session.model?.id ?? '',
        currentThinkingLevel: session.thinkingLevel ?? '',
        currentServiceTier: readSavedModelPreferences(SETTINGS_FILE, availableModels).currentServiceTier,
      },
      availableModels,
    );
  }

  applyLiveSessionServiceTier(
    session,
    resolveConversationPreferenceStateForSession(session.sessionManager, availableModels).currentServiceTier,
  );

  const id = session.sessionId;
  wireSession(id, session, cwd);
  queuePrewarmLiveSessionLoader(cwd, options);
  return { id, sessionFile: resolveLiveSessionFile(session) ?? '' };
}

/** Create a new live session in a different cwd from an existing session file. */
export async function createSessionFromExisting(
  sessionFile: string,
  cwd: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{ id: string; sessionFile: string }> {
  const auth = makeAuth();
  const modelRegistry = makeRegistry(auth);
  const resourceLoader = await makeLoader(cwd, options);
  const sessionManager = SessionManager.forkFrom(sessionFile, cwd, resolvePersistentSessionDir(cwd));
  const { session } = await createAgentSession({
    cwd,
    agentDir: options.agentDir ?? AGENT_DIR,
    authStorage: auth,
    modelRegistry,
    resourceLoader,
    sessionManager,
  });

  patchConversationBashTool(session, cwd, session.sessionId, resolveLiveSessionFile(session));
  patchSessionManagerPersistence(session.sessionManager);
  ensureSessionFileExists(session.sessionManager);
  const availableModels = modelRegistry.getAvailable();
  await repairSessionModelProvider(session, availableModels);
  applyLiveSessionServiceTier(
    session,
    resolveConversationPreferenceStateForSession(session.sessionManager, availableModels).currentServiceTier,
  );

  const id = session.sessionId;
  wireSession(id, session, cwd);
  queuePrewarmLiveSessionLoader(cwd, options);
  return { id, sessionFile: resolveLiveSessionFile(session) ?? '' };
}

function buildRelatedConversationCompactionInstructions(prompt: string): string {
  return [
    'You are preparing a compact handoff from an older conversation for reuse in a brand new conversation.',
    'Focus only on context that still helps with the user\'s next prompt.',
    '',
    'The next prompt is:',
    prompt.trim(),
    '',
    'Include only the most relevant goals, decisions, file paths, commands, errors, and unresolved work.',
    'Drop unrelated history and repetition. If the conversation is not directly relevant, say so briefly.',
  ].join('\n');
}

function extractLatestCompactionSummaryText(detail: ReturnType<typeof readSessionBlocksByFile>): string | null {
  const blocks = detail?.blocks ?? [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.type === 'summary' && block.kind === 'compaction' && block.text.trim().length > 0) {
      return block.text.trim();
    }
  }

  return null;
}

export async function summarizeSessionFileForPrompt(
  sessionFile: string,
  cwd: string,
  prompt: string,
  options: LiveSessionLoaderOptions = {},
): Promise<string> {
  const auth = makeAuth();
  const modelRegistry = makeRegistry(auth);
  const resourceLoader = await makeLoader(cwd, options);
  const sessionManager = SessionManager.forkFrom(sessionFile, cwd, resolvePersistentSessionDir(cwd));
  const { session } = await createAgentSession({
    cwd,
    agentDir: options.agentDir ?? AGENT_DIR,
    authStorage: auth,
    modelRegistry,
    resourceLoader,
    sessionManager,
  });

  ensureSessionFileExists(session.sessionManager);
  await repairSessionModelProvider(session, modelRegistry.getAvailable());

  const temporarySessionFile = resolveLiveSessionFile(session) ?? '';

  try {
    await session.compact(buildRelatedConversationCompactionInstructions(prompt));
    const detail = temporarySessionFile
      ? readSessionBlocksByFile(temporarySessionFile)
      : null;
    const summary = extractLatestCompactionSummaryText(detail);
    if (!summary) {
      throw new Error('Compaction did not produce a reusable summary.');
    }

    return summary;
  } finally {
    session.dispose();
    if (temporarySessionFile && existsSync(temporarySessionFile)) {
      try {
        unlinkSync(temporarySessionFile);
      } catch {
        // Ignore temp session cleanup failures.
      }
    }
  }
}

export async function requestConversationWorkingDirectoryChange(
  input: {
    conversationId: string;
    cwd: string;
    continuePrompt?: string;
  },
  loaderOptions: LiveSessionLoaderOptions = {},
): Promise<{
  conversationId: string;
  cwd: string;
  queued: boolean;
  unchanged?: boolean;
}> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new Error('conversationId is required.');
  }

  const nextCwd = input.cwd.trim();
  if (!nextCwd) {
    throw new Error('cwd is required.');
  }

  const entry = registry.get(conversationId);
  if (!entry) {
    throw new Error(`Session ${conversationId} is not live.`);
  }

  if (!resolveLiveSessionFile(entry.session, { ensurePersisted: true })) {
    throw new Error('Conversation working directory changes require a persisted session file.');
  }

  if (nextCwd === entry.cwd) {
    pendingConversationWorkingDirectoryChanges.delete(conversationId);
    return {
      conversationId,
      cwd: entry.cwd,
      queued: false,
      unchanged: true,
    };
  }

  pendingConversationWorkingDirectoryChanges.set(conversationId, {
    cwd: nextCwd,
    continuePrompt: input.continuePrompt?.trim() || undefined,
    loaderOptions,
  });

  return {
    conversationId,
    cwd: nextCwd,
    queued: true,
  };
}

async function applyPendingConversationWorkingDirectoryChange(entry: LiveEntry): Promise<void> {
  const pending = pendingConversationWorkingDirectoryChanges.get(entry.sessionId);
  if (!pending) {
    return;
  }

  pendingConversationWorkingDirectoryChanges.delete(entry.sessionId);

  const sourceSessionFile = resolveLiveSessionFile(entry.session, { ensurePersisted: true });
  if (!sourceSessionFile) {
    broadcast(entry, {
      type: 'error',
      message: 'Could not change the working directory because the session file is unavailable.',
    });
    return;
  }

  try {
    const result = await createSessionFromExisting(sourceSessionFile, pending.cwd, pending.loaderOptions);
    const autoContinued = Boolean(pending.continuePrompt);

    broadcast(entry, {
      type: 'cwd_changed',
      newConversationId: result.id,
      cwd: pending.cwd,
      autoContinued,
    });
    destroySession(entry.sessionId);

    if (pending.continuePrompt) {
      void promptSession(result.id, pending.continuePrompt).catch((error) => {
        logWarn('failed to continue conversation after working directory change', {
          conversationId: result.id,
          cwd: pending.cwd,
          error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        });
      });
    }
  } catch (error) {
    broadcast(entry, {
      type: 'error',
      message: `Could not change the working directory: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** Resume an existing session file into a live session. */
export async function resumeSession(
  sessionFile: string,
  options: LiveSessionLoaderOptions & { cwdOverride?: string } = {},
): Promise<{ id: string }> {
  // Don't re-create if already live
  for (const [id, e] of registry.entries()) {
    if (resolveLiveSessionFile(e.session) === sessionFile) return { id };
  }

  const {
    cwdOverride,
    ...loaderOptions
  } = options;
  const normalizedCwdOverride = typeof cwdOverride === 'string' && cwdOverride.trim().length > 0
    ? cwdOverride.trim()
    : undefined;

  const metadataCwd = readSessionMetaByFile(sessionFile)?.cwd;
  const effectiveCwdOverride = normalizedCwdOverride ?? metadataCwd;
  const auth = makeAuth();
  const modelRegistry = makeRegistry(auth);
  const sessionManager = SessionManager.open(sessionFile, undefined, effectiveCwdOverride);
  const cwd = effectiveCwdOverride ?? sessionManager.getCwd();
  const resourceLoader = await makeLoader(cwd, loaderOptions);
  const { session } = await createAgentSession({
    cwd,
    agentDir: loaderOptions.agentDir ?? AGENT_DIR,
    authStorage: auth,
    modelRegistry,
    resourceLoader,
    sessionManager,
  });

  patchConversationBashTool(session, cwd, session.sessionId, resolveLiveSessionFile(session));
  patchSessionManagerPersistence(session.sessionManager);
  const availableModels = modelRegistry.getAvailable();
  await repairSessionModelProvider(session, availableModels);
  applyLiveSessionServiceTier(
    session,
    resolveConversationPreferenceStateForSession(session.sessionManager, availableModels).currentServiceTier,
  );

  const id = session.sessionId;
  wireSession(id, session, cwd, {
    autoTitleRequested: Boolean(session.sessionName?.trim()),
  });
  queuePrewarmLiveSessionLoader(cwd, loaderOptions);
  return { id };
}

/** Subscribe to SSE events for a live session. Returns unsubscribe fn or null if not live. */
export function subscribe(
  sessionId: string,
  listener: (e: SseEvent) => void,
  options?: {
    tailBlocks?: number;
    surface?: {
      surfaceId: string;
      surfaceType: LiveSessionSurfaceType;
    };
  },
): (() => void) | null {
  const entry = registry.get(sessionId);
  if (!entry) return null;

  const subscription: LiveListener = {
    send: listener,
    tailBlocks: options?.tailBlocks,
  };
  entry.listeners.add(subscription);

  const presenceChanged = options?.surface
    ? registerLiveSurface(entry, options.surface)
    : false;

  listener({ type: 'snapshot', ...buildLiveSnapshot(entry, options?.tailBlocks) });
  const title = resolveEntryTitle(entry);
  if (title) {
    listener({ type: 'title_update', title });
  }
  listener({ type: 'context_usage', usage: readContextUsagePayload(entry.session) });
  listener({ type: 'queue_state', ...readQueueState(entry.session) });
  listener({ type: 'parallel_state', jobs: readParallelState(entry) });
  if (options?.surface || (entry.presenceBySurfaceId?.size ?? 0) > 0) {
    listener({ type: 'presence_state', state: buildPresenceState(entry) });
  }
  if (entry.session.isStreaming
    && (!entry.activeHiddenTurnCustomType || shouldExposeHiddenTurnInTranscript(entry.activeHiddenTurnCustomType))) {
    listener({ type: 'agent_start' });
  }

  if (presenceChanged) {
    broadcastPresenceState(entry, { exclude: subscription });
  }

  return () => {
    entry.listeners.delete(subscription);
    if (options?.surface && removeLiveSurface(entry, options.surface.surfaceId)) {
      broadcastPresenceState(entry);
    }
  };
}

export function readLiveSessionAutoModeState(sessionId: string): ConversationAutoModeState {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  return readConversationAutoModeState(entry);
}

export function broadcastConversationAutoModeState(sessionId: string, force = true): void {
  const entry = registry.get(sessionId);
  if (!entry) {
    return;
  }

  broadcastAutoModeState(entry, force);
}

export async function requestConversationAutoModeTurn(sessionId: string): Promise<boolean> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  if (!readConversationAutoModeState(entry).enabled) {
    return false;
  }

  const hasCompletedAssistantTurn = Array.isArray(entry.session.state?.messages)
    && entry.session.state.messages.some((message) => message?.role === 'assistant');
  if (!hasCompletedAssistantTurn) {
    return false;
  }

  if (entry.session.isStreaming || hasQueuedOrActiveHiddenTurn(entry)) {
    return false;
  }

  const steering = typeof entry.session.getSteeringMessages === 'function'
    ? entry.session.getSteeringMessages()
    : [];
  const followUp = typeof entry.session.getFollowUpMessages === 'function'
    ? entry.session.getFollowUpMessages()
    : [];
  if (steering.length > 0 || followUp.length > 0) {
    return false;
  }

  ensureHiddenTurnState(entry);
  entry.pendingHiddenTurnCustomTypes.push(CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE);
  publishSessionMetaChanged(sessionId);

  try {
    repairDanglingToolCallContext(entry.session);
    await entry.session.sendCustomMessage({
      customType: CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE,
      content: CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT,
      display: false,
      details: { source: 'conversation-auto-mode' },
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
    return true;
  } catch (error) {
    const pendingIndex = entry.pendingHiddenTurnCustomTypes.lastIndexOf(CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE);
    if (pendingIndex >= 0) {
      entry.pendingHiddenTurnCustomTypes.splice(pendingIndex, 1);
    }
    publishSessionMetaChanged(sessionId);
    throw error;
  }
}

export function markConversationAutoModeContinueRequested(sessionId: string): void {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  entry.pendingAutoModeContinuation = true;
}

export async function requestConversationAutoModeContinuationTurn(sessionId: string): Promise<boolean> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  if (!readConversationAutoModeState(entry).enabled || entry.session.isStreaming) {
    return false;
  }

  const steering = typeof entry.session.getSteeringMessages === 'function'
    ? entry.session.getSteeringMessages()
    : [];
  const followUp = typeof entry.session.getFollowUpMessages === 'function'
    ? entry.session.getFollowUpMessages()
    : [];
  if (steering.length > 0 || followUp.length > 0) {
    return false;
  }

  repairDanglingToolCallContext(entry.session);
  await entry.session.sendCustomMessage({
    customType: CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
    content: CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_PROMPT,
    display: false,
    details: { source: 'conversation-auto-mode' },
  }, {
    deliverAs: 'followUp',
    triggerTurn: true,
  });
  return true;
}

export async function setLiveSessionAutoModeState(
  sessionId: string,
  input: ConversationAutoModeStateInput,
): Promise<ConversationAutoModeState> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  const nextState = writeConversationAutoModeState(entry.session.sessionManager, input);
  if (!nextState.enabled) {
    entry.pendingAutoModeContinuation = false;
  }
  broadcastAutoModeState(entry, true);
  publishSessionMetaChanged(sessionId);
  publishAppEvent({ type: 'session_file_changed', sessionId });

  return nextState;
}

/** Append hidden context before the next user-visible prompt in a live session. */
export async function queuePromptContext(
  sessionId: string,
  customType: string,
  content: string,
): Promise<void> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  const message = content.trim();
  if (!message) {
    return;
  }

  const customMessage = {
    customType,
    content: message,
    display: false,
    details: undefined,
  };

  if (entry.session.isStreaming) {
    await entry.session.sendCustomMessage(customMessage, {
      deliverAs: 'nextTurn',
    });
    return;
  }

  await entry.session.sendCustomMessage(customMessage);
}

export async function appendDetachedUserMessage(
  sessionId: string,
  text: string,
): Promise<void> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  if (entry.session.isStreaming) {
    throw new Error(`Session ${sessionId} is currently streaming`);
  }

  const normalizedText = text.trim();
  if (!normalizedText) {
    return;
  }

  const message = {
    role: 'user' as const,
    content: [{ type: 'text' as const, text: normalizedText }],
    timestamp: Date.now(),
  };

  entry.session.state.messages = [...entry.session.state.messages, message];
  entry.session.sessionManager.appendMessage(message);

  if (!entry.session.sessionName?.trim() && isPlaceholderConversationTitle(entry.title)) {
    const fallbackTitle = buildFallbackTitleFromContent(message.content);
    if (fallbackTitle) {
      entry.title = fallbackTitle;
      broadcastTitle(entry);
    }
  }

  publishSessionMetaChanged(sessionId);
}

export async function appendVisibleCustomMessage(
  sessionId: string,
  customType: string,
  content: string,
  details?: unknown,
): Promise<void> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  if (entry.session.isStreaming) {
    throw new Error(`Session ${sessionId} is currently streaming`);
  }

  const message = content.trim();
  if (!message) {
    return;
  }

  await entry.session.sendCustomMessage({
    customType,
    content: message,
    display: true,
    details,
  });
  broadcastSnapshot(entry);
  publishSessionMetaChanged(sessionId);
}

async function appendParallelImportedMessage(
  sessionId: string,
  content: string,
  details: { childConversationId: string; status: 'complete' | 'failed' },
): Promise<void> {
  await appendDetachedUserMessage(sessionId, content);

  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  await entry.session.sendCustomMessage({
    customType: PARALLEL_RESULT_CUSTOM_TYPE,
    content: `Imported parallel response from ${details.childConversationId}.`,
    display: false,
    details,
  });
  broadcastSnapshot(entry);
  publishSessionMetaChanged(sessionId);
}

function shouldPreserveParallelChildLiveSession(entry: LiveEntry | undefined): boolean {
  if (!entry) {
    return false;
  }

  return entry.listeners.size > 0 || (entry.presenceBySurfaceId?.size ?? 0) > 0;
}

async function finalizeParallelChildLiveSession(
  childConversationId: string,
  options: { abortIfRunning?: boolean } = {},
): Promise<'destroyed' | 'preserved' | 'missing'> {
  const childEntry = registry.get(childConversationId);
  if (!childEntry) {
    return 'missing';
  }

  if (options.abortIfRunning && childEntry.session.isStreaming) {
    try {
      await childEntry.session.abort();
    } catch (error) {
      logWarn('parallel child abort failed before cleanup', {
        conversationId: childConversationId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  if (shouldPreserveParallelChildLiveSession(childEntry)) {
    return 'preserved';
  }

  if (!options.abortIfRunning && childEntry.session.isStreaming) {
    return 'preserved';
  }

  destroySession(childConversationId);
  return 'destroyed';
}

async function tryImportReadyParallelJobs(entry: LiveEntry): Promise<void> {
  entry.parallelJobs ??= [];
  if (entry.importingParallelJobs || entry.session.isStreaming || hasQueuedOrActiveHiddenTurn(entry)) {
    return;
  }

  const nextJob = entry.parallelJobs[0];
  if (!nextJob || (nextJob.status !== 'ready' && nextJob.status !== 'failed')) {
    return;
  }

  entry.importingParallelJobs = true;
  try {
    while (!entry.session.isStreaming && !hasQueuedOrActiveHiddenTurn(entry)) {
      const currentJob = entry.parallelJobs[0];
      if (!currentJob || (currentJob.status !== 'ready' && currentJob.status !== 'failed')) {
        break;
      }

      const fallbackStatus: Extract<ParallelPromptJobStatus, 'ready' | 'failed'> = currentJob.error?.trim() ? 'failed' : 'ready';
      currentJob.status = 'importing';
      currentJob.updatedAt = new Date().toISOString();
      persistParallelJobs(entry);
      broadcastParallelState(entry, true);

      try {
        await appendParallelImportedMessage(
          entry.sessionId,
          buildParallelImportedContent(currentJob),
          {
            childConversationId: currentJob.childConversationId,
            status: currentJob.error?.trim() ? 'failed' : 'complete',
          },
        );
      } catch (error) {
        currentJob.status = fallbackStatus;
        currentJob.updatedAt = new Date().toISOString();
        persistParallelJobs(entry);
        broadcastParallelState(entry, true);
        throw error;
      }

      entry.parallelJobs.shift();
      persistParallelJobs(entry);
      broadcastParallelState(entry, true);
      await finalizeParallelChildLiveSession(currentJob.childConversationId);
    }
  } finally {
    entry.importingParallelJobs = false;
  }
}

export async function startParallelPromptSession(
  sessionId: string,
  input: {
    text: string;
    images?: PromptImageAttachment[];
    attachmentRefs?: string[];
    contextMessages?: Array<{ customType: string; content: string }>;
  },
  options: LiveSessionLoaderOptions = {},
): Promise<{ jobId: string; childConversationId: string }> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  const text = input.text.trim();
  if (!text && (!input.images || input.images.length === 0)) {
    throw new Error('text or images required');
  }

  const sourceSessionFile = entry.session.sessionFile?.trim();
  if (!sourceSessionFile) {
    throw new Error('Parallel prompts require a persisted session file.');
  }

  const activeTurnInProgress = entry.session.isStreaming || hasQueuedOrActiveHiddenTurn(entry);
  if (!activeTurnInProgress) {
    throw new Error('Parallel prompts are only available while the conversation is busy.');
  }

  const parallelRepoRoot = readGitRepoInfo(entry.cwd)?.root;
  const stableEntryId = resolveStableForkEntryId(sourceSessionFile, { activeTurnInProgress });
  const forked = stableEntryId
    ? await forkSession(sessionId, stableEntryId, {
        preserveSource: true,
        ...options,
      })
    : await createSession(entry.cwd, {
        ...options,
        initialModel: options.initialModel === undefined ? entry.session.model?.id ?? null : options.initialModel,
        initialThinkingLevel: options.initialThinkingLevel === undefined
          ? entry.session.thinkingLevel ?? null
          : options.initialThinkingLevel,
        initialServiceTier: options.initialServiceTier === undefined
          ? buildConversationServiceTierPreferenceInput(resolveConversationPreferenceStateForSession(entry.session.sessionManager, getAvailableModelObjects()))
          : options.initialServiceTier,
      });

  const childConversationId = 'id' in forked ? forked.id : forked.newSessionId;
  const now = new Date().toISOString();
  const job: ParallelPromptJob = {
    id: createParallelPromptJobId(),
    prompt: text,
    childConversationId,
    childSessionFile: forked.sessionFile,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    imageCount: input.images?.length ?? 0,
    attachmentRefs: normalizeParallelPromptList(input.attachmentRefs, 12),
    touchedFiles: [],
    parentTouchedFiles: [],
    overlapFiles: [],
    sideEffects: [],
    ...(stableEntryId ? { forkEntryId: stableEntryId } : {}),
    ...(parallelRepoRoot ? { repoRoot: parallelRepoRoot } : {}),
    worktreeDirtyPathsAtStart: readParallelCurrentWorktreeDirtyPaths(entry.cwd, parallelRepoRoot),
  };
  entry.parallelJobs ??= [];
  entry.parallelJobs.push(job);
  persistParallelJobs(entry);
  broadcastParallelState(entry, true);

  try {
    for (const message of input.contextMessages ?? []) {
      await queuePromptContext(childConversationId, message.customType, message.content);
    }

    const submitted = await submitPromptSession(childConversationId, text, undefined, input.images);
    void submitted.completion.then(async () => {
      const completion = existsSync(forked.sessionFile)
        ? readParallelJobCompletionFromSessionFile(forked.sessionFile, { cwd: entry.cwd, repoRoot: parallelRepoRoot })
        : { hasTerminalReply: false, touchedFiles: [] as string[], sideEffects: [] as string[] };
      const nextJobs = replacePersistedParallelJob(sourceSessionFile, job.id, (currentJob) => ({
        ...currentJob,
        childSessionFile: forked.sessionFile,
        status: completion.status ?? 'ready',
        updatedAt: new Date().toISOString(),
        touchedFiles: completion.touchedFiles,
        sideEffects: completion.sideEffects,
        ...(completion.status === 'failed'
          ? { error: completion.error ?? 'The parallel prompt failed before completing.' }
          : {}),
        ...(completion.status === 'ready' || completion.resultText !== undefined
          ? { resultText: completion.resultText ?? '' }
          : {}),
      }));
      const currentEntry = registry.get(sessionId);
      if (!currentEntry || currentEntry.session.sessionFile?.trim() !== sourceSessionFile) {
        return;
      }

      currentEntry.parallelJobs = nextJobs;
      broadcastParallelState(currentEntry, true);
      await tryImportReadyParallelJobs(currentEntry);
    }).catch(async (error: unknown) => {
      const completion = existsSync(forked.sessionFile)
        ? readParallelJobCompletionFromSessionFile(forked.sessionFile, { cwd: entry.cwd, repoRoot: parallelRepoRoot })
        : { hasTerminalReply: false, touchedFiles: [] as string[], sideEffects: [] as string[] };
      const nextJobs = replacePersistedParallelJob(sourceSessionFile, job.id, (currentJob) => ({
        ...currentJob,
        childSessionFile: forked.sessionFile,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        touchedFiles: completion.touchedFiles,
        sideEffects: completion.sideEffects,
        error: completion.error ?? (error instanceof Error ? error.message : String(error)),
        ...(completion.resultText !== undefined ? { resultText: completion.resultText } : {}),
      }));
      const currentEntry = registry.get(sessionId);
      if (!currentEntry || currentEntry.session.sessionFile?.trim() !== sourceSessionFile) {
        return;
      }

      currentEntry.parallelJobs = nextJobs;
      broadcastParallelState(currentEntry, true);
      await tryImportReadyParallelJobs(currentEntry);
    });

    return {
      jobId: job.id,
      childConversationId,
    };
  } catch (error) {
    entry.parallelJobs = entry.parallelJobs.filter((candidate) => candidate.id !== job.id);
    persistParallelJobs(entry);
    broadcastParallelState(entry, true);
    throw error;
  }
}

export async function manageParallelPromptJob(
  sessionId: string,
  input: { jobId: string; action: 'importNow' | 'skip' | 'cancel' },
): Promise<{ ok: true; status: 'imported' | 'queued' | 'skipped' | 'cancelled' }> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  const jobId = input.jobId.trim();
  if (!jobId) {
    throw new Error('jobId required');
  }

  entry.parallelJobs ??= [];
  const jobIndex = entry.parallelJobs.findIndex((candidate) => candidate.id === jobId);
  if (jobIndex < 0) {
    throw new Error('Parallel prompt no longer exists.');
  }

  const job = entry.parallelJobs[jobIndex]!;
  if (input.action === 'skip') {
    if (job.status === 'running') {
      throw new Error('Use cancel to stop a running parallel prompt.');
    }
    if (job.status === 'importing') {
      throw new Error('Parallel prompt is already being appended.');
    }

    entry.parallelJobs.splice(jobIndex, 1);
    persistParallelJobs(entry);
    broadcastParallelState(entry, true);
    await finalizeParallelChildLiveSession(job.childConversationId);
    return { ok: true, status: 'skipped' };
  }

  if (input.action === 'cancel') {
    if (job.status === 'importing') {
      throw new Error('Parallel prompt is already being appended.');
    }

    entry.parallelJobs.splice(jobIndex, 1);
    persistParallelJobs(entry);
    broadcastParallelState(entry, true);
    await finalizeParallelChildLiveSession(job.childConversationId, { abortIfRunning: true });
    return { ok: true, status: 'cancelled' };
  }

  if (job.status !== 'ready' && job.status !== 'failed') {
    throw new Error('Only completed parallel prompts can be imported now.');
  }

  if (jobIndex > 0) {
    entry.parallelJobs.splice(jobIndex, 1);
    entry.parallelJobs.unshift(job);
    persistParallelJobs(entry);
    broadcastParallelState(entry, true);
  }

  await tryImportReadyParallelJobs(entry);
  const imported = !(entry.parallelJobs ?? []).some((candidate) => candidate.id === jobId);
  return { ok: true, status: imported ? 'imported' : 'queued' };
}

function resolvePromptBehavior(
  entry: LiveEntry,
  behavior?: 'steer' | 'followUp',
): 'steer' | 'followUp' | undefined {
  return normalizeQueuedPromptBehavior(behavior, {
    isStreaming: entry.session.isStreaming,
    hasHiddenTurnQueued: hasQueuedOrActiveHiddenTurn(entry),
  });
}

function isHiddenSessionBranchEntry(entry: SessionEntry | undefined): boolean {
  return entry?.type === 'custom_message' && entry.display === false;
}

function resolveDanglingToolCallRepairLeafId(
  sessionManager: Pick<SessionManager, 'getBranch' | 'getEntry'>,
): string | null | undefined {
  const branch = sessionManager.getBranch();
  if (branch.length === 0) {
    return undefined;
  }

  const pendingToolCalls = new Map<string, { index: number; parentId: string | null }>();

  for (const [index, entry] of branch.entries()) {
    if (entry.type !== 'message') {
      continue;
    }

    const { message } = entry;
    if (message.role === 'assistant') {
      for (const part of message.content) {
        if (part.type !== 'toolCall') {
          continue;
        }

        const toolCallId = part.id?.trim();
        if (!toolCallId) {
          continue;
        }

        pendingToolCalls.set(toolCallId, {
          index,
          parentId: entry.parentId ?? null,
        });
      }
      continue;
    }

    if (message.role === 'toolResult') {
      const toolCallId = message.toolCallId?.trim();
      if (toolCallId) {
        pendingToolCalls.delete(toolCallId);
      }
    }
  }

  let repairLeafId: string | null | undefined;
  let earliestPendingIndex = Number.POSITIVE_INFINITY;
  for (const pending of pendingToolCalls.values()) {
    if (pending.index < earliestPendingIndex) {
      earliestPendingIndex = pending.index;
      repairLeafId = pending.parentId;
    }
  }

  if (repairLeafId === undefined) {
    return undefined;
  }

  while (repairLeafId) {
    const parentEntry = sessionManager.getEntry(repairLeafId);
    if (!isHiddenSessionBranchEntry(parentEntry) || !parentEntry) {
      break;
    }
    repairLeafId = parentEntry.parentId ?? null;
  }

  return repairLeafId;
}

function repairDanglingToolCallContext(session: Pick<AgentSession, 'sessionManager' | 'state'>): boolean {
  const sessionManager = session.sessionManager as Partial<Pick<SessionManager, 'getBranch' | 'getEntry' | 'branch' | 'resetLeaf' | 'buildSessionContext'>> | undefined;
  if (!sessionManager
    || typeof sessionManager.getBranch !== 'function'
    || typeof sessionManager.getEntry !== 'function'
    || typeof sessionManager.branch !== 'function'
    || typeof sessionManager.resetLeaf !== 'function'
    || typeof sessionManager.buildSessionContext !== 'function') {
    return false;
  }

  const repairLeafId = resolveDanglingToolCallRepairLeafId(sessionManager as Pick<SessionManager, 'getBranch' | 'getEntry'>);
  if (repairLeafId === undefined) {
    return false;
  }

  if (repairLeafId === null) {
    sessionManager.resetLeaf();
  } else {
    sessionManager.branch(repairLeafId);
  }
  session.state.messages = sessionManager.buildSessionContext().messages;
  return true;
}

type TranscriptTailRecoveryReason = 'assistant_error' | 'dangling_tool_call';

interface TranscriptTailRecoveryPlan {
  targetEntryId: string | null;
  reason: TranscriptTailRecoveryReason;
  summary: string;
  details?: unknown;
}

function resolveVisibleSessionBranchTargetId(
  sessionManager: Pick<SessionManager, 'getEntry'>,
  entryId: string | null | undefined,
): string | null {
  let targetEntryId = entryId ?? null;
  while (targetEntryId) {
    const targetEntry = sessionManager.getEntry(targetEntryId);
    if (!targetEntry || !isHiddenSessionBranchEntry(targetEntry)) {
      break;
    }
    targetEntryId = targetEntry.parentId ?? null;
  }
  return targetEntryId;
}

function buildTranscriptTailRecoveryPlan(
  input: {
    targetEntryId: string | null;
    reason: TranscriptTailRecoveryReason;
    errorMessage?: string;
  },
): TranscriptTailRecoveryPlan {
  const summaryLines = input.reason === 'assistant_error'
    ? ['Recovered from a failed tail so the conversation can continue from the last stable point.']
    : ['Recovered from an unfinished tool-use tail so the conversation can continue from the last stable point.'];

  const errorMessage = input.errorMessage?.trim();
  if (errorMessage) {
    summaryLines.push(`Error: ${errorMessage}`);
  }

  return {
    targetEntryId: input.targetEntryId,
    reason: input.reason,
    summary: summaryLines.join('\n'),
    details: {
      source: 'conversation-recovery',
      reason: input.reason,
      ...(errorMessage ? { errorMessage } : {}),
    },
  };
}

function resolveTranscriptTailRecoveryPlan(
  sessionManager: Pick<SessionManager, 'getBranch' | 'getEntry'>,
): TranscriptTailRecoveryPlan | null {
  const branch = sessionManager.getBranch();
  if (branch.length === 0) {
    return null;
  }

  const leafEntry = branch[branch.length - 1];
  if (leafEntry?.type === 'message' && leafEntry.message.role === 'assistant') {
    const errorMessage = getAssistantErrorDisplayMessage(leafEntry.message);
    if (errorMessage) {
      return buildTranscriptTailRecoveryPlan({
        targetEntryId: resolveVisibleSessionBranchTargetId(sessionManager, leafEntry.parentId ?? null),
        reason: 'assistant_error',
        errorMessage,
      });
    }
  }

  const danglingToolCallRepairLeafId = resolveDanglingToolCallRepairLeafId(sessionManager);
  if (danglingToolCallRepairLeafId !== undefined) {
    return buildTranscriptTailRecoveryPlan({
      targetEntryId: danglingToolCallRepairLeafId,
      reason: 'dangling_tool_call',
    });
  }

  return null;
}

export function repairLiveSessionTranscriptTail(sessionId: string): {
  recoverable: boolean;
  repaired: boolean;
  reason: TranscriptTailRecoveryReason | null;
  summary?: string;
} {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  const sessionManager = entry.session.sessionManager as Partial<Pick<SessionManager, 'getBranch' | 'getEntry' | 'branch' | 'branchWithSummary' | 'resetLeaf' | 'buildSessionContext'>> | undefined;
  if (!sessionManager
    || typeof sessionManager.getBranch !== 'function'
    || typeof sessionManager.getEntry !== 'function') {
    return {
      recoverable: false,
      repaired: false,
      reason: null,
    };
  }

  const plan = resolveTranscriptTailRecoveryPlan(sessionManager as Pick<SessionManager, 'getBranch' | 'getEntry'>);
  if (!plan) {
    return {
      recoverable: false,
      repaired: false,
      reason: null,
    };
  }

  if (typeof sessionManager.resetLeaf !== 'function'
    || typeof sessionManager.buildSessionContext !== 'function'
    || (plan.targetEntryId !== null
      && typeof sessionManager.branch !== 'function'
      && typeof sessionManager.branchWithSummary !== 'function')) {
    return {
      recoverable: true,
      repaired: false,
      reason: plan.reason,
      summary: plan.summary,
    };
  }

  if (plan.targetEntryId === null) {
    sessionManager.resetLeaf();
  } else if (typeof sessionManager.branchWithSummary === 'function') {
    sessionManager.branchWithSummary(plan.targetEntryId, plan.summary, plan.details);
  } else if (typeof sessionManager.branch === 'function') {
    sessionManager.branch(plan.targetEntryId);
  }

  entry.session.state.messages = sessionManager.buildSessionContext().messages;
  entry.currentTurnError = null;
  broadcastSnapshot(entry);
  clearContextUsageTimer(entry);
  broadcastContextUsage(entry, true);
  publishSessionMetaChanged(sessionId);

  return {
    recoverable: true,
    repaired: true,
    reason: plan.reason,
    summary: plan.summary,
  };
}

async function runPromptOnLiveEntry(
  entry: LiveEntry,
  text: string,
  behavior: 'steer' | 'followUp' | undefined,
  images?: PromptImageAttachment[],
): Promise<void> {
  const { session } = entry;
  const hasImages = Boolean(images && images.length > 0);

  if (behavior === undefined) {
    repairLiveSessionTranscriptTail(entry.sessionId);
  }

  const runPrompt = async (allowImages: boolean): Promise<void> => {
    if (behavior === 'steer') {
      await (allowImages && hasImages ? session.steer(text, images) : session.steer(text));
      broadcastQueueState(entry, true);
      return;
    }

    if (behavior === 'followUp') {
      await (allowImages && hasImages ? session.followUp(text, images) : session.followUp(text));
      broadcastQueueState(entry, true);
      return;
    }

    await (allowImages && hasImages ? session.prompt(text, { images }) : session.prompt(text));
  };

  try {
    await runPrompt(true);
  } catch (error) {
    if (!hasImages || !isLikelyUnsupportedImageInputError(error)) {
      throw error;
    }

    await runPrompt(false);
  }
}

export async function promptSession(
  sessionId: string,
  text: string,
  behavior?: 'steer' | 'followUp',
  images?: PromptImageAttachment[],
  _surfaceId?: string,
): Promise<void> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  // Prompt submission should survive quick navigation between conversations.
  // Keep surface-gated control for takeover/abort actions, but let an already
  // clicked send continue even if this surface disconnects a moment later.
  await runPromptOnLiveEntry(entry, text, resolvePromptBehavior(entry, behavior), images);
}

export async function submitPromptSession(
  sessionId: string,
  text: string,
  behavior?: 'steer' | 'followUp',
  images?: PromptImageAttachment[],
  _surfaceId?: string,
): Promise<{ acceptedAs: 'started' | 'queued'; completion: Promise<void> }> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);

  const normalizedBehavior = resolvePromptBehavior(entry, behavior);
  if (normalizedBehavior === 'steer' || normalizedBehavior === 'followUp') {
    await runPromptOnLiveEntry(entry, text, normalizedBehavior, images);
    return {
      acceptedAs: 'queued',
      completion: Promise.resolve(),
    };
  }

  let settled = false;
  let unsubscribe: (() => void) | null = null;
  const accepted = new Promise<void>((resolve, reject) => {
    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      unsubscribe?.();
      unsubscribe = null;
      handler();
    };

    unsubscribe = entry.session.subscribe((event) => {
      if (event.type === 'message_start' && event.message.role === 'user') {
        finish(resolve);
        return;
      }

      if (event.type === 'agent_start' || event.type === 'agent_end' || event.type === 'turn_end') {
        finish(resolve);
        return;
      }

      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const errorMessage = getAssistantErrorDisplayMessage(event.message);
        if (errorMessage) {
          finish(() => reject(new Error(errorMessage)));
        }
      }
    });
  });

  const completion = runPromptOnLiveEntry(entry, text, normalizedBehavior, images);
  void completion
    .finally(() => {
      if (!settled) {
        settled = true;
        unsubscribe?.();
        unsubscribe = null;
      }
    })
    .catch(() => {
      // The caller observes prompt-start failures through the race below, and
      // accepted prompts expose their eventual failure through the transcript.
      // Do not let the detached completion cleanup promise become an unhandled
      // rejection and take down the companion dev host.
    });

  await Promise.race([accepted, completion]);
  return {
    acceptedAs: 'started',
    completion,
  };
}

export async function executeSessionBash(
  sessionId: string,
  command: string,
  options: { excludeFromContext?: boolean } = {},
): Promise<unknown> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    throw new Error('command required');
  }
  if (entry.session.isBashRunning) {
    throw new Error('A bash command is already running.');
  }

  const toolCallId = `user-bash-${sessionId}-${Date.now()}-${++syntheticBashExecutionCounter}`;
  const startedAtMs = Date.now();
  const eventArgs: Record<string, unknown> = {
    command: normalizedCommand,
    displayMode: 'terminal',
    ...(options.excludeFromContext ? { excludeFromContext: true } : {}),
  };

  broadcast(entry, { type: 'tool_start', toolCallId, toolName: 'bash', args: eventArgs });

  let streamedOutput = '';
  try {
    const result = await entry.session.executeBash(
      normalizedCommand,
      (chunk) => {
        if (!chunk) {
          return;
        }

        streamedOutput += chunk;
        broadcast(entry, { type: 'tool_update', toolCallId, partialResult: chunk });
      },
      { excludeFromContext: options.excludeFromContext === true },
    );

    const bashResult = result as {
      output?: unknown;
      exitCode?: unknown;
      cancelled?: unknown;
      truncated?: unknown;
      fullOutputPath?: unknown;
    };
    const details = {
      displayMode: 'terminal',
      ...(typeof bashResult.exitCode === 'number' ? { exitCode: bashResult.exitCode } : {}),
      ...(bashResult.cancelled === true ? { cancelled: true } : {}),
      ...(bashResult.truncated === true ? { truncated: true } : {}),
      ...(typeof bashResult.fullOutputPath === 'string' && bashResult.fullOutputPath.trim().length > 0
        ? { fullOutputPath: bashResult.fullOutputPath }
        : {}),
      ...(options.excludeFromContext ? { excludeFromContext: true } : {}),
    };
    const output = typeof bashResult.output === 'string' ? bashResult.output : streamedOutput;

    broadcast(entry, {
      type: 'tool_end',
      toolCallId,
      toolName: 'bash',
      isError: false,
      durationMs: Date.now() - startedAtMs,
      output,
      ...(Object.keys(details).length > 0 ? { details } : {}),
    });

    if (!entry.session.isStreaming) {
      if (!entry.session.sessionName?.trim() && isPlaceholderConversationTitle(entry.title)) {
        const fallbackTitle = buildFallbackTitleFromContent([{ type: 'text', text: normalizedCommand }]);
        if (fallbackTitle) {
          entry.title = fallbackTitle;
          broadcastTitle(entry);
        }
      }

      try {
        const stats = entry.session.getSessionStats();
        broadcast(entry, { type: 'stats_update', tokens: stats.tokens, cost: stats.cost });
      } catch {
        // ignore stats errors for bash-only updates
      }

      clearContextUsageTimer(entry);
      broadcastContextUsage(entry, true);
      broadcastSnapshot(entry);
      publishSessionMetaChanged(entry.sessionId);
    }

    return result;
  } catch (error) {
    const details = {
      displayMode: 'terminal',
      ...(options.excludeFromContext ? { excludeFromContext: true } : {}),
    };
    broadcast(entry, {
      type: 'tool_end',
      toolCallId,
      toolName: 'bash',
      isError: true,
      durationMs: Date.now() - startedAtMs,
      output: error instanceof Error ? error.message : String(error),
      ...(details ? { details } : {}),
    });
    throw error;
  }
}

export async function restoreQueuedMessage(
  sessionId: string,
  behavior: 'steer' | 'followUp',
  index: number,
  previewId?: string,
): Promise<{ text: string; images: PromptImageAttachment[] }> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Queued message index must be a non-negative integer');
  }

  const visibleQueue = (behavior === 'steer'
    ? entry.session.getSteeringMessages()
    : entry.session.getFollowUpMessages()) as string[];
  const internalAgent = entry.session.agent as unknown as InternalAgentQueues;
  const internalQueue = resolveInternalQueuedMessages(behavior === 'steer'
    ? internalAgent.steeringQueue
    : internalAgent.followUpQueue);

  if (!Array.isArray(internalQueue) || isVisibleQueueFallbackPreviewId(behavior, previewId)) {
    if (index >= visibleQueue.length) {
      throw new Error('Queued prompt changed before it could be restored. Try again.');
    }

    const previews = visibleQueue.map((text, previewIndex) => createVisibleQueueFallbackPreview(behavior, previewIndex, text));
    if (previewId && previews[index]?.id !== previewId) {
      throw new Error('Queued prompt changed before it could be restored. Try again.');
    }

    const cleared = entry.session.clearQueue();
    const restoreQueue = behavior === 'steer' ? cleared.steering : cleared.followUp;
    const restoredText = restoreQueue[index] ?? visibleQueue[index] ?? '';
    const remainingSteering = behavior === 'steer'
      ? cleared.steering.filter((_, queueIndex) => queueIndex !== index)
      : cleared.steering;
    const remainingFollowUp = behavior === 'followUp'
      ? cleared.followUp.filter((_, queueIndex) => queueIndex !== index)
      : cleared.followUp;

    for (const queuedText of remainingSteering) {
      await entry.session.steer(queuedText);
    }
    for (const queuedText of remainingFollowUp) {
      await entry.session.followUp(queuedText);
    }

    return { text: restoredText, images: [] };
  }

  const removed = removeQueuedUserMessage(internalQueue, { index, previewId });
  if (!removed) {
    throw new Error('Queued prompt changed before it could be restored. Try again.');
  }

  const fallbackText = visibleQueue[index] ?? '';
  if (index < visibleQueue.length) {
    visibleQueue.splice(index, 1);
  }

  const restored = extractQueuedPromptContent(removed.message, fallbackText);
  broadcastQueueState(entry, true);
  return restored;
}

export async function cancelQueuedPrompt(
  sessionId: string,
  behavior: 'steer' | 'followUp',
  previewId: string,
): Promise<QueuedPromptPreview> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  const normalizedPreviewId = previewId.trim();
  if (!normalizedPreviewId) {
    throw new Error('Queued prompt id is required');
  }

  const visibleQueue = (behavior === 'steer'
    ? entry.session.getSteeringMessages()
    : entry.session.getFollowUpMessages()) as string[];
  const internalAgent = entry.session.agent as unknown as InternalAgentQueues;
  const queueContainer = behavior === 'steer'
    ? internalAgent.steeringQueue
    : internalAgent.followUpQueue;
  const internalQueue = resolveInternalQueuedMessages(queueContainer);
  const previews = readQueuedPromptPreviews(behavior, [...visibleQueue], queueContainer);
  const previewIndex = previews.findIndex((preview) => preview.id === normalizedPreviewId);
  if (previewIndex < 0) {
    throw new Error('Queued prompt changed before it could be cancelled. Try again.');
  }

  const cancelledPreview = previews[previewIndex] as QueuedPromptPreview;

  if (!Array.isArray(internalQueue) || isVisibleQueueFallbackPreviewId(behavior, normalizedPreviewId)) {
    if (typeof entry.session.clearQueue !== 'function') {
      throw new Error('Queued prompt changed before it could be cancelled. Try again.');
    }

    const cleared = entry.session.clearQueue();
    const remainingSteering = behavior === 'steer'
      ? cleared.steering.filter((_, queueIndex) => queueIndex !== previewIndex)
      : cleared.steering;
    const remainingFollowUp = behavior === 'followUp'
      ? cleared.followUp.filter((_, queueIndex) => queueIndex !== previewIndex)
      : cleared.followUp;

    for (const queuedText of remainingSteering) {
      await entry.session.steer(queuedText);
    }
    for (const queuedText of remainingFollowUp) {
      await entry.session.followUp(queuedText);
    }

    broadcastQueueState(entry, true);
    return cancelledPreview;
  }

  const removed = removeQueuedUserMessage(internalQueue, {
    index: previewIndex,
    previewId: normalizedPreviewId,
  });
  if (!removed) {
    throw new Error('Queued prompt changed before it could be cancelled. Try again.');
  }

  if (previewIndex < visibleQueue.length) {
    visibleQueue.splice(previewIndex, 1);
  }

  broadcastQueueState(entry, true);
  return cancelledPreview;
}

export async function compactSession(sessionId: string, customInstructions?: string) {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  const result = await entry.session.compact(customInstructions);
  entry.lastCompactionSummaryTitle = resolveCompactionSummaryTitle({ mode: 'manual' });
  broadcastSnapshot(entry);
  clearContextUsageTimer(entry);
  broadcastContextUsage(entry, true);
  publishSessionMetaChanged(sessionId);
  return result;
}

export async function reloadSessionResources(sessionId: string): Promise<void> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  await entry.session.reload();
}

export async function exportSessionHtml(sessionId: string, outputPath?: string): Promise<string> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  return entry.session.exportToHtml(outputPath);
}

export function renameSession(sessionId: string, name: string): void {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  entry.autoTitleRequested = true;
  applySessionTitle(entry, name);
  void syncDurableConversationRun(entry, entry.lastDurableRunState ?? (entry.session.isStreaming ? 'running' : 'waiting'), {
    force: true,
  });
}

export async function updateLiveSessionModelPreferences(
  sessionId: string,
  input: ConversationModelPreferenceInput,
  availableModels?: ReturnType<typeof getAvailableModelObjects>,
): Promise<ConversationModelPreferenceState> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);

  const models = availableModels ?? getAvailableModelObjects();
  const next = await applyConversationModelPreferencesToLiveSession(
    entry.session,
    input,
    {
      currentModel: entry.session.model?.id ?? '',
      currentThinkingLevel: entry.session.thinkingLevel ?? '',
      currentServiceTier: readSavedModelPreferences(SETTINGS_FILE, models).currentServiceTier,
    },
    models,
  );

  applyLiveSessionServiceTier(entry.session, next.currentServiceTier);
  publishSessionMetaChanged(sessionId);
  return next;
}

/** Abort the current agent run. */
export async function abortSession(sessionId: string): Promise<void> {
  const entry = registry.get(sessionId);
  if (entry) await entry.session.abort();
}

/** Fork a session at a given message entry ID. */
export async function branchSession(
  sessionId: string,
  entryId: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{ newSessionId: string; sessionFile: string }> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);

  // Safe while streaming: Pi only persists completed messages on message_end, so the
  // session file is already a stable snapshot of the conversation before the active turn.
  const sourceSessionFile = entry.session.sessionFile;
  if (!sourceSessionFile) {
    throw new Error('Cannot branch a live session without a session file.');
  }

  const sourceManager = SessionManager.open(sourceSessionFile, undefined, entry.cwd);
  if (!sourceManager.getEntry(entryId)) {
    throw new Error(`Session entry not found: ${entryId}`);
  }

  const branchedSessionFile = sourceManager.createBranchedSession(entryId);
  if (!branchedSessionFile) {
    throw new Error('Unable to create a branched session file.');
  }

  const resumed = await resumeSession(branchedSessionFile, {
    ...options,
    cwdOverride: entry.cwd,
  });
  return { newSessionId: resumed.id, sessionFile: branchedSessionFile };
}

export async function forkSession(
  sessionId: string,
  entryId: string,
  options: LiveSessionLoaderOptions & { preserveSource?: boolean; beforeEntry?: boolean } = {},
): Promise<{ newSessionId: string; sessionFile: string }> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);

  const {
    preserveSource,
    beforeEntry,
    ...loaderOptions
  } = options;

  if (entry.session.isStreaming && !preserveSource) {
    throw new Error('Cannot replace a running conversation while forking. Keep the source conversation open instead.');
  }

  // Safe while streaming: Pi only persists completed messages on message_end, so the
  // session file is already a stable snapshot of the conversation before the active turn.
  const sourceSessionFile = entry.session.sessionFile;
  if (!sourceSessionFile) {
    throw new Error('Cannot fork a live session without a session file.');
  }

  const sourceManager = SessionManager.open(sourceSessionFile, undefined, entry.cwd);
  const sourceEntry = sourceManager.getEntry(entryId);
  if (!sourceEntry) {
    throw new Error(`Session entry not found: ${entryId}`);
  }

  if (beforeEntry && !sourceEntry.parentId) {
    const created = await createSession(entry.cwd, {
      ...loaderOptions,
      initialModel: loaderOptions.initialModel === undefined ? entry.session.model?.id ?? null : loaderOptions.initialModel,
      initialThinkingLevel: loaderOptions.initialThinkingLevel === undefined
        ? entry.session.thinkingLevel ?? null
        : loaderOptions.initialThinkingLevel,
      initialServiceTier: loaderOptions.initialServiceTier === undefined
        ? buildConversationServiceTierPreferenceInput(resolveConversationPreferenceStateForSession(entry.session.sessionManager, getAvailableModelObjects()))
        : loaderOptions.initialServiceTier,
    });

    if (!preserveSource) {
      destroySession(sessionId);
    }

    return { newSessionId: created.id, sessionFile: created.sessionFile };
  }

  const targetEntryId = beforeEntry ? sourceEntry.parentId : entryId;
  if (!targetEntryId) {
    throw new Error(`Session entry not found: ${entryId}`);
  }

  const forkedSessionFile = sourceManager.createBranchedSession(targetEntryId);
  if (!forkedSessionFile) {
    throw new Error('Unable to create a forked session file.');
  }

  const resumed = await resumeSession(forkedSessionFile, {
    ...loaderOptions,
    cwdOverride: entry.cwd,
  });

  if (!preserveSource) {
    destroySession(sessionId);
  }

  return { newSessionId: resumed.id, sessionFile: forkedSessionFile };
}

export function resolveLastCompletedConversationEntryId(sessionFile: string): string | null {
  const lines = readFileSync(sessionFile, 'utf-8').split(/\r?\n/);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const rawLine = lines[index]?.trim();
    if (!rawLine) {
      continue;
    }

    try {
      const entry = JSON.parse(rawLine) as {
        type?: string;
        id?: string;
        message?: { role?: string };
      };
      if (entry.type !== 'message') {
        continue;
      }
      if (entry.message?.role !== 'user' && entry.message?.role !== 'assistant') {
        continue;
      }
      const entryId = entry.id?.trim();
      if (entryId) {
        return entryId;
      }
    } catch {
      continue;
    }
  }

  return null;
}

interface StableForkBranchEntry {
  id?: string;
  parentId?: string | null;
  type?: string;
  display?: boolean;
  message?: {
    role?: string;
    content?: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
}

function isHiddenCustomMessageEntry(entry: StableForkBranchEntry | undefined): boolean {
  return entry?.type === 'custom_message' && entry.display === false;
}

function getStableForkBranchEntries(sessionFile: string): StableForkBranchEntry[] {
  try {
    return readFileSync(sessionFile, 'utf-8')
      .split(/\r?\n/)
      .flatMap((line): StableForkBranchEntry[] => {
        const rawLine = line.trim();
        if (!rawLine) {
          return [];
        }

        try {
          const entry = JSON.parse(rawLine) as StableForkBranchEntry;
          return typeof entry.id === 'string' && entry.id.trim().length > 0
            ? [{
                ...entry,
                id: entry.id.trim(),
                parentId: typeof entry.parentId === 'string' ? entry.parentId.trim() : entry.parentId ?? null,
              }]
            : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function isStableCompletedBranchEntry(entry: StableForkBranchEntry | undefined): boolean {
  if (!entry) {
    return false;
  }

  if (entry.type === 'custom_message') {
    return entry.display === true;
  }

  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    return true;
  }

  if (entry.type !== 'message') {
    return false;
  }

  if (entry.message?.role !== 'assistant') {
    return false;
  }

  return entry.message.stopReason !== 'toolUse';
}

export function resolveStableForkEntryId(
  sessionFile: string,
  options: { activeTurnInProgress?: boolean } = {},
): string | null {
  const branch = getStableForkBranchEntries(sessionFile);
  if (branch.length === 0) {
    return null;
  }

  if (!options.activeTurnInProgress) {
    return branch[branch.length - 1]?.id?.trim() || null;
  }

  const branchById = new Map(
    branch
      .filter((entry): entry is StableForkBranchEntry & { id: string } => typeof entry.id === 'string' && entry.id.trim().length > 0)
      .map((entry) => [entry.id.trim(), entry]),
  );

  let latestUserIndex = -1;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === 'message' && entry.message?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }

  if (latestUserIndex >= 0) {
    const latestUserEntry = branch[latestUserIndex];
    const hasStableCompletedEntryAfterLatestUser = branch
      .slice(latestUserIndex + 1)
      .some((entry) => isStableCompletedBranchEntry(entry));

    if (!hasStableCompletedEntryAfterLatestUser) {
      let current: StableForkBranchEntry | undefined = latestUserEntry?.parentId ? branchById.get(latestUserEntry.parentId) : undefined;
      while (current && isHiddenCustomMessageEntry(current)) {
        current = current.parentId ? branchById.get(current.parentId) : undefined;
      }
      return current?.id?.trim() || null;
    }
  }

  let current: StableForkBranchEntry | undefined = branch[branch.length - 1];
  while (current && isHiddenCustomMessageEntry(current)) {
    current = current.parentId ? branchById.get(current.parentId) : undefined;
  }

  return current?.id?.trim() || null;
}

function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .flatMap((part) => (
      part
      && typeof part === 'object'
      && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string'
        ? [(part as { text: string }).text]
        : []
    ))
    .join('\n')
    .trim();
}

function formatParallelQuotedSection(text: string): string {
  return text
    .split('\n')
    .map((line) => line.length > 0 ? `> ${line}` : '>')
    .join('\n');
}

function buildParallelImportedContent(
  job: Pick<ParallelPromptJob, 'prompt' | 'childConversationId' | 'resultText' | 'error' | 'imageCount' | 'attachmentRefs' | 'touchedFiles' | 'parentTouchedFiles' | 'overlapFiles' | 'sideEffects'>,
): string {
  const attachmentRefs = Array.isArray(job.attachmentRefs) ? job.attachmentRefs : [];
  const touchedFiles = Array.isArray(job.touchedFiles) ? job.touchedFiles : [];
  const parentTouchedFiles = Array.isArray(job.parentTouchedFiles) ? job.parentTouchedFiles : [];
  const overlapFiles = Array.isArray(job.overlapFiles) ? job.overlapFiles : [];
  const sideEffects = Array.isArray(job.sideEffects) ? job.sideEffects : [];
  const childHref = `/conversations/${encodeURIComponent(job.childConversationId)}`;
  const promptText = job.prompt.trim().length > 0 ? job.prompt.trim() : '(image-only prompt)';
  const sections = [
    '### Parallel response',
    '',
    `[Open side thread](${childHref})`,
    '',
  ];

  const metadata: string[] = [];
  if (job.imageCount > 0) {
    metadata.push(`- Images: ${job.imageCount}`);
  }
  if (attachmentRefs.length > 0) {
    metadata.push('- Attachments:', ...attachmentRefs.map((attachmentRef) => `  - ${attachmentRef}`));
  }
  if (touchedFiles.length > 0) {
    metadata.push('- Touched files:', ...touchedFiles.map((path) => `  - \`${path}\``));
  }
  if (parentTouchedFiles.length > 0) {
    metadata.push('- Parent thread touched:', ...parentTouchedFiles.map((path) => `  - \`${path}\``));
  }
  if (metadata.length > 0) {
    sections.push('**Metadata**', '', ...metadata, '');
  }

  if (overlapFiles.length > 0) {
    sections.push(
      '**Potential overlap**',
      '',
      'These files changed in the worktree while this side thread was running and may need a manual conflict check.',
      '',
      ...overlapFiles.map((path) => `- \`${path}\``),
      '',
    );
  }

  if (sideEffects.length > 0) {
    sections.push('**Side effects**', '', ...sideEffects.map((summary) => `- ${summary}`), '');
  }

  sections.push('**Prompt**', '', formatParallelQuotedSection(promptText), '');

  if (job.error?.trim()) {
    sections.push('**Status**', '', 'Failed', '');
    sections.push('**Error**', '', job.error.trim());
  } else {
    sections.push('**Reply**', '', job.resultText?.trim() || '(No text reply. Open the side thread for the full result.)');
  }

  return sections.join('\n');
}

export async function summarizeAndForkSession(
  sessionId: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{ newSessionId: string; sessionFile: string }> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  const sourceSessionFile = entry.session.sessionFile;
  if (!sourceSessionFile) {
    throw new Error('Cannot summarize and fork a live session without a session file.');
  }

  const duplicated = entry.session.isStreaming
    ? await (async () => {
      const lastCompletedEntryId = resolveLastCompletedConversationEntryId(sourceSessionFile);
      if (!lastCompletedEntryId) {
        throw new Error('No completed conversation turn is ready to summarize and fork yet.');
      }

      const sourceManager = SessionManager.open(sourceSessionFile, undefined, entry.cwd);
      const forkedSessionFile = sourceManager.createBranchedSession(lastCompletedEntryId);
      if (!forkedSessionFile) {
        throw new Error('Unable to create a summary fork from the latest completed turn.');
      }

      const resumed = await resumeSession(forkedSessionFile, {
        ...options,
        cwdOverride: entry.cwd,
      });
      return { id: resumed.id, sessionFile: forkedSessionFile };
    })()
    : await createSessionFromExisting(sourceSessionFile, entry.cwd, options);

  void compactSession(duplicated.id).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    logWarn('summary fork compaction failed', {
      sourceConversationId: sessionId,
      conversationId: duplicated.id,
      sessionFile: duplicated.sessionFile,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : message,
    });

    try {
      await appendVisibleCustomMessage(
        duplicated.id,
        'system_notice',
        `Summarize & New could not compact this copy automatically: ${message}`,
      );
    } catch {
      // Ignore best-effort failure surfacing.
    }
  });

  return { newSessionId: duplicated.id, sessionFile: duplicated.sessionFile };
}

/** Cleanly dispose a live session. */
export function destroySession(sessionId: string): void {
  pendingConversationWorkingDirectoryChanges.delete(sessionId);
  const entry = registry.get(sessionId);
  if (!entry) return;
  clearContextUsageTimer(entry);
  void syncDurableConversationRun(entry, entry.session.isStreaming ? 'interrupted' : 'waiting', {
    force: true,
    ...(entry.session.isStreaming ? { lastError: 'Live session disposed while a response was active.' } : {}),
  });
  entry.session.dispose();
  registry.delete(sessionId);
  publishSessionMetaChanged(sessionId);
}
