/**
 * Live Pi session registry.
 * Wraps @mariozechner/pi-coding-agent SDK sessions in-process and
 * exposes a pub/sub SSE event layer for the web server.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  getDurableSessionsDir,
  getPiAgentRuntimeDir,
} from '@personal-agent/core';
import {
  AgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSessionEvent,
} from '@mariozechner/pi-coding-agent';
import { publishAppEvent } from '../shared/appEvents.js';
import {
  applyConversationModelPreferencesToLiveSession,
  type ConversationModelPreferenceInput,
  type ConversationModelPreferenceState,
} from './conversationModelPreferences.js';
import { normalizeModelContextWindow } from '../models/modelContextWindows.js';
import { readSavedModelPreferences } from '../models/modelPreferences.js';
import {
  generateConversationTitle,
  hasAssistantTitleSourceMessage,
} from './conversationAutoTitle.js';
import { syncWebLiveConversationRun, type WebLiveConversationRunState } from './conversationRuns.js';
import {
  getAssistantErrorDisplayMessage,
  readSessionBlocksByFile,
  readSessionMetaByFile,
  type DisplayBlock,
} from './sessions.js';
import { estimateContextUsageSegments } from './sessionContextUsage.js';
import { readGitRepoInfo } from '../workspace/gitStatus.js';
import { logWarn } from '../shared/logging.js';
import {
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
  CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE,
  type ConversationAutoModeState,
  type ConversationAutoModeStateInput,
} from './conversationAutoMode.js';
import {
  assertLiveSessionSurfaceCanControl,
  buildLiveSessionPresenceState,
  createLiveSessionPresenceHost,
  LiveSessionControlError,
  registerLiveSessionSurface,
  removeLiveSessionSurface,
  takeOverLiveSessionSurface,
  type LiveSessionPresenceState,
  type LiveSessionSurfaceType,
  type LiveSessionPresenceHost,
} from './liveSessionPresence.js';
import {
  normalizeQueuedPromptBehavior,
  readQueueState,
  type PromptImageAttachment,
  type QueuedPromptPreview,
} from './liveSessionQueue.js';
import {
  cancelLiveSessionQueuedPrompt,
  restoreLiveSessionQueuedMessage,
} from './liveSessionQueueOperations.js';
import {
  resolveCompactionSummaryTitle,
} from './liveSessionTranscript.js';
import {
  clearPrewarmedLiveSessionLoaders,
  prewarmLiveSessionLoader,
  queuePrewarmLiveSessionLoader,
  type LiveSessionLoaderOptions,
} from './liveSessionLoader.js';
import {
  normalizeParallelPromptList,
  readParallelState,
  writePersistedParallelJobs,
  type ParallelPromptJob,
  type ParallelPromptJobStatus,
  type ParallelPromptPreview,
} from './liveSessionParallelJobs.js';
import {
  loadPersistedParallelJobs,
  readParallelCurrentWorktreeDirtyPaths,
  readParallelJobCompletionFromSessionFile,
  replacePersistedParallelJob,
  type ResolveParallelChildSession,
} from './liveSessionParallelReconciliation.js';
import {
  repairDanglingToolCallContext,
  resolveTranscriptTailRecoveryPlan,
  type TranscriptTailRecoveryReason,
} from './liveSessionRecovery.js';
import {
  ensureSessionFileExists,
  patchSessionManagerPersistence,
  resolveLiveSessionFile,
} from './liveSessionPersistence.js';
import {
  buildParallelImportedContent,
  resolveLastCompletedConversationEntryId,
  resolveStableForkEntryId,
} from './liveSessionForking.js';
import {
  buildFallbackTitleFromContent,
  getSessionMessages,
  isPlaceholderConversationTitle,
  resolveStableSessionTitle,
} from './liveSessionTitle.js';
import {
  applyLiveSessionServiceTier,
  buildConversationServiceTierPreferenceInput,
  repairSessionModelProvider,
  resolveConversationPreferenceStateForSession as resolveConversationPreferenceStateForSessionWithSettings,
} from './liveSessionModels.js';
import {
  createPreparedLiveAgentSession,
  makeAuth as makeFactoryAuth,
  makeRegistry,
} from './liveSessionFactory.js';
import {
  activateNextHiddenTurn,
  clearActiveHiddenTurnAfterTerminalEvent,
  createLiveSessionHiddenTurnState,
  ensureHiddenTurnState,
  hasQueuedOrActiveHiddenTurn,
  shouldExposeHiddenTurnInTranscript,
  shouldSuppressLiveEventForHiddenTurn,
  type LiveSessionHiddenTurnState,
} from './liveSessionHiddenTurns.js';
import {
  toSse,
  type LiveContextUsage,
  type LiveContextUsageSegment,
  type SseEvent,
} from './liveSessionEvents.js';
import { executeLiveSessionBash } from './liveSessionBash.js';
import {
  markLiveSessionAutoModeContinueRequested,
  readLiveSessionAutoModeHostState,
  requestLiveSessionAutoModeContinuationTurn,
  requestLiveSessionAutoModeTurn,
  writeLiveSessionAutoModeHostState,
} from './liveSessionAutoModeOps.js';
import { summarizeSessionFileForPromptWithLiveSession } from './liveSessionSummaries.js';
import {
  inspectAvailableLiveSessionTools,
  type BeforeAgentStartProbeMessage,
} from './liveSessionToolInspection.js';
import { buildLiveSessionSnapshot } from './liveSessionStateSnapshot.js';
export {
  registerLiveSessionLifecycleHandler,
  type LiveSessionLifecycleEvent,
  type LiveSessionLifecycleHandler,
} from './liveSessionLifecycle.js';
import { notifyLiveSessionLifecycleHandlers } from './liveSessionLifecycle.js';

export {
  clearPrewarmedLiveSessionLoaders,
  prewarmLiveSessionLoader,
  type LiveSessionLoaderOptions,
} from './liveSessionLoader.js';

export {
  type ParallelPromptPreview,
} from './liveSessionParallelJobs.js';

export {
  type LiveContextUsage,
  type LiveContextUsageSegment,
  type SseEvent,
  toSse,
} from './liveSessionEvents.js';

export {
  ensureSessionFileExists,
  patchSessionManagerPersistence,
} from './liveSessionPersistence.js';

export {
  isPlaceholderConversationTitle,
  resolveStableSessionTitle,
} from './liveSessionTitle.js';

export {
  resolveLastCompletedConversationEntryId,
  resolveStableForkEntryId,
} from './liveSessionForking.js';

export {
  LiveSessionControlError,
  type LiveSessionPresence,
  type LiveSessionPresenceState,
  type LiveSessionSurfaceType,
} from './liveSessionPresence.js';

export {
  type PromptImageAttachment,
  type QueuedPromptPreview,
} from './liveSessionQueue.js';

const AGENT_DIR = getPiAgentRuntimeDir();
const SETTINGS_FILE = join(AGENT_DIR, 'settings.json');
const SESSIONS_DIR = getDurableSessionsDir();

export function resolvePersistentSessionDir(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  return join(SESSIONS_DIR, safePath);
}

function resolveConversationPreferenceStateForSession(
  sessionManager: Parameters<typeof resolveConversationPreferenceStateForSessionWithSettings>[1],
  availableModels: Parameters<typeof resolveConversationPreferenceStateForSessionWithSettings>[2],
): ReturnType<typeof resolveConversationPreferenceStateForSessionWithSettings> {
  return resolveConversationPreferenceStateForSessionWithSettings(SETTINGS_FILE, sessionManager, availableModels);
}

// ── SSE event types sent to clients ──────────────────────────────────────────

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

interface LiveEntry extends LiveSessionPresenceHost, LiveSessionHiddenTurnState {
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
  pendingAutoModeContinuation?: boolean;
  pendingAutoCompactionReason?: 'overflow' | 'threshold' | null;
  lastCompactionSummaryTitle?: string | null;
  isCompacting?: boolean;
  parallelJobs?: ParallelPromptJob[];
  importingParallelJobs?: boolean;
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

export const registry = new Map<string, LiveEntry>();
const pendingConversationWorkingDirectoryChanges = new Map<string, PendingConversationWorkingDirectoryChange>();

function notifyEntryLifecycleHandlers(entry: LiveEntry, trigger: 'turn_end' | 'auto_compaction_end'): void {
  notifyLiveSessionLifecycleHandlers({
    conversationId: entry.sessionId,
    sessionFile: resolveLiveSessionFile(entry.session, { ensurePersisted: true }),
    title: resolveEntryTitle(entry),
    cwd: entry.cwd,
    trigger,
  });
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

export function listQueuedPromptPreviews(sessionId: string): { steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] } {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  return readQueueState(entry.session);
}

const PARALLEL_RESULT_CUSTOM_TYPE = 'parallel_result';
let parallelPromptJobCounter = 0;

const resolveParallelChildSession: ResolveParallelChildSession = (childConversationId) => {
  const childEntry = registry.get(childConversationId);
  if (!childEntry) {
    return undefined;
  }

  return {
    sessionFile: childEntry.session.sessionFile,
    isStreaming: childEntry.session.isStreaming,
  };
};

function persistParallelJobs(entry: Pick<LiveEntry, 'session' | 'parallelJobs'>): void {
  const sessionFile = entry.session.sessionFile?.trim();
  if (!sessionFile) {
    return;
  }

  writePersistedParallelJobs(sessionFile, Array.isArray(entry.parallelJobs) ? entry.parallelJobs : []);
}

function createParallelPromptJobId(): string {
  parallelPromptJobCounter += 1;
  return `parallel-${parallelPromptJobCounter}`;
}

function broadcastSnapshot(entry: LiveEntry): void {
  ensureHiddenTurnState(entry);
  for (const listener of entry.listeners) {
    listener.send({
      type: 'snapshot',
      ...buildLiveSessionSnapshot(entry, listener.tailBlocks),
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
  ensureHiddenTurnState(entry);

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
    ...buildLiveSessionSnapshot(entry, tailBlocks),
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
    parallelJobs: readParallelState(entry.parallelJobs),
    presence: buildLiveSessionPresenceState(entry),
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
  const jobs = readParallelState(entry.parallelJobs);
  const nextJson = JSON.stringify(jobs);
  if (!force && entry.lastParallelStateJson === nextJson) {
    return;
  }

  entry.lastParallelStateJson = nextJson;
  broadcast(entry, { type: 'parallel_state', jobs });
}

function readConversationAutoModeState(entry: Pick<LiveEntry, 'session'>): ConversationAutoModeState {
  return readLiveSessionAutoModeHostState(entry);
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

function broadcastPresenceState(entry: LiveEntry, options?: { exclude?: LiveListener }): void {
  broadcast(entry, { type: 'presence_state', state: buildLiveSessionPresenceState(entry) }, options);
}

export function ensureSessionSurfaceCanControl(sessionId: string, surfaceId?: string): void {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  assertLiveSessionSurfaceCanControl(entry, surfaceId);
}

export function takeOverSessionControl(sessionId: string, surfaceId: string): LiveSessionPresenceState {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  const takeover = takeOverLiveSessionSurface(entry, surfaceId);
  if (takeover.changed) {
    broadcastPresenceState(entry);
  }

  return takeover.state;
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
    ...createLiveSessionHiddenTurnState(),
    pendingAutoModeContinuation: false,
    pendingAutoCompactionReason: null,
    lastCompactionSummaryTitle: null,
    isCompacting: false,
    parallelJobs: [],
    importingParallelJobs: false,
    ...createLiveSessionPresenceHost(),

  };
  entry.parallelJobs = loadPersistedParallelJobs(entry.session.sessionFile, resolveParallelChildSession);
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
    const activeHiddenTurnCustomType = activateNextHiddenTurn(entry, event);
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
      notifyEntryLifecycleHandlers(entry, 'turn_end');
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
        notifyEntryLifecycleHandlers(entry, 'auto_compaction_end');
      }
    }

    const sse = toSse(event);
    if (sse && !suppressLiveEvent) {
      broadcast(entry, sse);
    }

    clearActiveHiddenTurnAfterTerminalEvent(entry, event);

    if (event.type === 'turn_end' || event.type === 'agent_end') {
      void tryImportReadyParallelJobs(entry);
    }
  });


  return entry;
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
  const auth = makeFactoryAuth(AGENT_DIR);
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
  return inspectAvailableLiveSessionTools({
    cwd,
    agentDir: options.agentDir ?? AGENT_DIR,
    options,
  });
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

/** Create a brand-new Pi session. */
export async function createSession(
  cwd: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{ id: string; sessionFile: string }> {
  const sessionManager = SessionManager.create(cwd, resolvePersistentSessionDir(cwd));
  const { session } = await createPreparedLiveAgentSession({
    cwd,
    agentDir: options.agentDir ?? AGENT_DIR,
    sessionManager,
    settingsFile: SETTINGS_FILE,
    options,
    applyInitialPreferences: true,
  });

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
  const sessionManager = SessionManager.forkFrom(sessionFile, cwd, resolvePersistentSessionDir(cwd));
  const { session } = await createPreparedLiveAgentSession({
    cwd,
    agentDir: options.agentDir ?? AGENT_DIR,
    sessionManager,
    settingsFile: SETTINGS_FILE,
    options,
  });

  const id = session.sessionId;
  wireSession(id, session, cwd);
  queuePrewarmLiveSessionLoader(cwd, options);
  return { id, sessionFile: resolveLiveSessionFile(session) ?? '' };
}

export async function summarizeSessionFileForPrompt(
  sessionFile: string,
  cwd: string,
  prompt: string,
  options: LiveSessionLoaderOptions = {},
): Promise<string> {
  return summarizeSessionFileForPromptWithLiveSession({
    sessionFile,
    cwd,
    prompt,
    agentDir: AGENT_DIR,
    settingsFile: SETTINGS_FILE,
    persistentSessionDir: resolvePersistentSessionDir(cwd),
    options,
  });
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
  const sessionManager = SessionManager.open(sessionFile, undefined, effectiveCwdOverride);
  const cwd = effectiveCwdOverride ?? sessionManager.getCwd();
  const { session } = await createPreparedLiveAgentSession({
    cwd,
    agentDir: loaderOptions.agentDir ?? AGENT_DIR,
    sessionManager,
    settingsFile: SETTINGS_FILE,
    options: loaderOptions,
    ensureSessionFile: false,
  });

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
    ? registerLiveSessionSurface(entry, options.surface)
    : false;

  ensureHiddenTurnState(entry);
  listener({ type: 'snapshot', ...buildLiveSessionSnapshot(entry, options?.tailBlocks) });
  const title = resolveEntryTitle(entry);
  if (title) {
    listener({ type: 'title_update', title });
  }
  listener({ type: 'context_usage', usage: readContextUsagePayload(entry.session) });
  listener({ type: 'queue_state', ...readQueueState(entry.session) });
  listener({ type: 'parallel_state', jobs: readParallelState(entry.parallelJobs) });
  if (options?.surface || (entry.presenceBySurfaceId?.size ?? 0) > 0) {
    listener({ type: 'presence_state', state: buildLiveSessionPresenceState(entry) });
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
    if (options?.surface && removeLiveSessionSurface(entry, options.surface.surfaceId)) {
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

  publishSessionMetaChanged(sessionId);
  try {
    return await requestLiveSessionAutoModeTurn(entry);
  } catch (error) {
    publishSessionMetaChanged(sessionId);
    throw error;
  }
}

export function markConversationAutoModeContinueRequested(sessionId: string): void {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  markLiveSessionAutoModeContinueRequested(entry);
}

export async function requestConversationAutoModeContinuationTurn(sessionId: string): Promise<boolean> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  return requestLiveSessionAutoModeContinuationTurn(entry);
}

export async function setLiveSessionAutoModeState(
  sessionId: string,
  input: ConversationAutoModeStateInput,
): Promise<ConversationAutoModeState> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  const nextState = writeLiveSessionAutoModeHostState(entry, input);
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
      }), resolveParallelChildSession);
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
      }), resolveParallelChildSession);
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

  const { result, normalizedCommand } = await executeLiveSessionBash(entry, command, {
    excludeFromContext: options.excludeFromContext,
    broadcast: (event) => broadcast(entry, event),
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
}

export async function restoreQueuedMessage(
  sessionId: string,
  behavior: 'steer' | 'followUp',
  index: number,
  previewId?: string,
): Promise<{ text: string; images: PromptImageAttachment[] }> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);

  const restored = await restoreLiveSessionQueuedMessage(entry, behavior, index, previewId);
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

  const cancelledPreview = await cancelLiveSessionQueuedPrompt(entry, behavior, previewId);
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
