/**
 * Live Pi session registry.
 * Wraps @mariozechner/pi-coding-agent SDK sessions in-process and
 * exposes a pub/sub SSE event layer for the web server.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getDurableSessionsDir,
  getPiAgentRuntimeDir,
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
} from '@mariozechner/pi-coding-agent';
import { publishAppEvent } from '../shared/appEvents.js';
import {
  applyConversationModelPreferencesToLiveSession,
  type ConversationModelPreferenceInput,
  type ConversationModelPreferenceState,
} from './conversationModelPreferences.js';
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
  | { type: 'snapshot';        blocks: DisplayBlock[]; blockOffset: number; totalBlocks: number }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'cwd_changed';     newConversationId: string; cwd: string; autoContinued: boolean }
  | { type: 'user_message';    block: Extract<DisplayBlock, { type: 'user' }> }
  | { type: 'queue_state';     steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] }
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
  presenceBySurfaceId?: Map<string, LiveSurfacePresenceRecord>;
  controllerSurfaceId?: string | null;
  controllerAcquiredAt?: string | null;
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
  presence: LiveSessionPresenceState;
  autoModeState: ConversationAutoModeState | null;
  cwdChange: { newConversationId: string; cwd: string; autoContinued: boolean } | null;
}

export type LiveSessionLifecycleHandler = (event: LiveSessionLifecycleEvent) => void | Promise<void>;

export const registry = new Map<string, LiveEntry>();
const toolTimings = new Map<string, number>(); // toolCallId → start ms
const lifecycleHandlers = new Set<LiveSessionLifecycleHandler>();
const pendingConversationWorkingDirectoryChanges = new Map<string, PendingConversationWorkingDirectoryChange>();

export function registerLiveSessionLifecycleHandler(handler: LiveSessionLifecycleHandler): () => void {
  lifecycleHandlers.add(handler);
  return () => lifecycleHandlers.delete(handler);
}

function notifyLiveSessionLifecycleHandlers(entry: LiveEntry, trigger: 'turn_end' | 'auto_compaction_end'): void {
  ensureSessionFileExists(entry.session.sessionManager);
  const event: LiveSessionLifecycleEvent = {
    conversationId: entry.sessionId,
    sessionFile: entry.session.sessionFile?.trim() || undefined,
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
      env: {
        ...context.env,
        PERSONAL_AGENT_SOURCE_CONVERSATION_ID: conversationId,
        ...(sessionFile ? { PERSONAL_AGENT_SOURCE_SESSION_FILE: sessionFile } : {}),
      },
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

  const sessionFile = session.sessionFile?.trim();
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

    return {
      ...usage,
      modelId: session.model?.id,
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
    };
  }

  const persisted = readSessionBlocksByFile(sessionFile, { tailBlocks: tailBlocks ?? DEFAULT_LIVE_SNAPSHOT_TAIL_BLOCKS });
  if (!persisted || persisted.blocks.length === 0) {
    return {
      blocks: applyLatestCompactionSummaryTitle(liveBlocks, entry.lastCompactionSummaryTitle),
      blockOffset: 0,
      totalBlocks: liveBlocks.length,
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
    };
  }

  const blocks = mergeConversationHistoryBlocks(persisted.blocks, liveBlocks);
  return {
    blocks: applyLatestCompactionSummaryTitle(blocks, entry.lastCompactionSummaryTitle),
    blockOffset: persisted.blockOffset,
    totalBlocks: persisted.blockOffset + blocks.length,
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

function shouldSuppressLiveEventForHiddenTurn(entry: LiveEntry, event: AgentSessionEvent): boolean {
  ensureHiddenTurnState(entry);
  if (!entry.activeHiddenTurnCustomType) {
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
    currentTurnError: null,
    pendingHiddenTurnCustomTypes: [],
    activeHiddenTurnCustomType: null,
    pendingAutoModeContinuation: false,
    pendingAutoCompactionReason: null,
    lastCompactionSummaryTitle: null,
    isCompacting: false,
    presenceBySurfaceId: new Map(),
    controllerSurfaceId: null,
    controllerAcquiredAt: null,

  };
  registry.set(id, entry);
  publishSessionMetaChanged(id);
  void syncDurableConversationRun(entry, session.isStreaming ? 'running' : 'waiting', { force: true });
  maybeAutoTitleConversation(entry);

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
    sessionFile: entry.session.sessionFile ?? '',
    title: resolveEntryTitle(entry),
    isStreaming: entry.session.isStreaming,
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
  return getAvailableModelObjects().map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    context: model.contextWindow ?? 128_000,
    provider: (model as { provider?: string }).provider ?? '',
  }));
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

  patchConversationBashTool(session, cwd, session.sessionId, session.sessionFile);
  patchSessionManagerPersistence(session.sessionManager);
  ensureSessionFileExists(session.sessionManager);

  const availableModels = modelRegistry.getAvailable();
  await repairSessionModelProvider(session, availableModels);

  if (options.initialModel !== undefined || options.initialThinkingLevel !== undefined) {
    await applyConversationModelPreferencesToLiveSession(
      session,
      {
        ...(options.initialModel !== undefined ? { model: options.initialModel } : {}),
        ...(options.initialThinkingLevel !== undefined ? { thinkingLevel: options.initialThinkingLevel } : {}),
      },
      {
        currentModel: session.model?.id ?? '',
        currentThinkingLevel: session.thinkingLevel ?? '',
      },
      availableModels,
    );
  }

  const id = session.sessionId;
  wireSession(id, session, cwd);
  queuePrewarmLiveSessionLoader(cwd, options);
  return { id, sessionFile: session.sessionFile ?? '' };
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

  patchConversationBashTool(session, cwd, session.sessionId, session.sessionFile);
  patchSessionManagerPersistence(session.sessionManager);
  ensureSessionFileExists(session.sessionManager);
  await repairSessionModelProvider(session, modelRegistry.getAvailable());

  const id = session.sessionId;
  wireSession(id, session, cwd);
  queuePrewarmLiveSessionLoader(cwd, options);
  return { id, sessionFile: session.sessionFile ?? '' };
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

  if (!entry.session.sessionFile?.trim()) {
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
  ensureSessionFileExists(entry.session.sessionManager);

  const sourceSessionFile = entry.session.sessionFile?.trim();
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
  options: LiveSessionLoaderOptions = {},
): Promise<{ id: string }> {
  // Don't re-create if already live
  for (const [id, e] of registry.entries()) {
    if (e.session.sessionFile === sessionFile) return { id };
  }

  const auth = makeAuth();
  const modelRegistry = makeRegistry(auth);
  const sessionManager = SessionManager.open(sessionFile);
  const cwd = sessionManager.getCwd();
  const resourceLoader = await makeLoader(cwd, options);
  const { session } = await createAgentSession({
    cwd,
    agentDir: options.agentDir ?? AGENT_DIR,
    authStorage: auth,
    modelRegistry,
    resourceLoader,
    sessionManager,
  });

  patchConversationBashTool(session, cwd, session.sessionId, session.sessionFile);
  patchSessionManagerPersistence(session.sessionManager);
  await repairSessionModelProvider(session, modelRegistry.getAvailable());

  const id = session.sessionId;
  wireSession(id, session, cwd, {
    autoTitleRequested: Boolean(session.sessionName?.trim()),
  });
  queuePrewarmLiveSessionLoader(cwd, options);
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
  if (options?.surface || (entry.presenceBySurfaceId?.size ?? 0) > 0) {
    listener({ type: 'presence_state', state: buildPresenceState(entry) });
  }
  if (entry.session.isStreaming && !entry.activeHiddenTurnCustomType) {
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

  if (nextState.enabled) {
    queueMicrotask(() => {
      void Promise.resolve(requestConversationAutoModeTurn(sessionId)).catch((error) => {
        logWarn('conversation auto mode turn request failed', {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      });
    });
  }

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
  publishSessionMetaChanged(sessionId);
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

async function runPromptOnLiveEntry(
  entry: LiveEntry,
  text: string,
  behavior: 'steer' | 'followUp' | undefined,
  images?: PromptImageAttachment[],
): Promise<void> {
  const { session } = entry;
  const hasImages = Boolean(images && images.length > 0);

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
  void completion.finally(() => {
    if (!settled) {
      settled = true;
      unsubscribe?.();
      unsubscribe = null;
    }
  });

  await Promise.race([accepted, completion]);
  return {
    acceptedAs: 'started',
    completion,
  };
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
    },
    models,
  );

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

  const sourceManager = SessionManager.open(sourceSessionFile);
  if (!sourceManager.getEntry(entryId)) {
    throw new Error(`Session entry not found: ${entryId}`);
  }

  const branchedSessionFile = sourceManager.createBranchedSession(entryId);
  if (!branchedSessionFile) {
    throw new Error('Unable to create a branched session file.');
  }

  const resumed = await resumeSession(branchedSessionFile, options);
  return { newSessionId: resumed.id, sessionFile: branchedSessionFile };
}

export async function forkSession(
  sessionId: string,
  entryId: string,
  options: LiveSessionLoaderOptions & { preserveSource?: boolean } = {},
): Promise<{ newSessionId: string; sessionFile: string }> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  if (entry.session.isStreaming && !options.preserveSource) {
    throw new Error('Cannot replace a running conversation while forking. Keep the source conversation open instead.');
  }

  // Safe while streaming: Pi only persists completed messages on message_end, so the
  // session file is already a stable snapshot of the conversation before the active turn.
  const sourceSessionFile = entry.session.sessionFile;
  if (!sourceSessionFile) {
    throw new Error('Cannot fork a live session without a session file.');
  }

  const sourceManager = SessionManager.open(sourceSessionFile);
  if (!sourceManager.getEntry(entryId)) {
    throw new Error(`Session entry not found: ${entryId}`);
  }

  const forkedSessionFile = sourceManager.createBranchedSession(entryId);
  if (!forkedSessionFile) {
    throw new Error('Unable to create a forked session file.');
  }

  const resumed = await resumeSession(forkedSessionFile, options);

  if (!options.preserveSource) {
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

      const sourceManager = SessionManager.open(sourceSessionFile);
      const forkedSessionFile = sourceManager.createBranchedSession(lastCompletedEntryId);
      if (!forkedSessionFile) {
        throw new Error('Unable to create a summary fork from the latest completed turn.');
      }

      const resumed = await resumeSession(forkedSessionFile, options);
      return { id: resumed.id, sessionFile: forkedSessionFile };
    })()
    : await createSessionFromExisting(sourceSessionFile, entry.cwd, options);

  try {
    await compactSession(duplicated.id);
  } catch (error) {
    destroySession(duplicated.id);
    throw error;
  }

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
