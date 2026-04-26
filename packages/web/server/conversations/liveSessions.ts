/**
 * Live Pi session registry.
 * Wraps @mariozechner/pi-coding-agent SDK sessions in-process and
 * exposes a pub/sub SSE event layer for the web server.
 */
import { join, resolve } from 'node:path';
import {
  getDurableSessionsDir,
  getPiAgentRuntimeDir,
} from '@personal-agent/core';
import {
  AgentSession,
  ModelRegistry,
} from '@mariozechner/pi-coding-agent';
import { publishAppEvent } from '../shared/appEvents.js';
import {
  type ConversationModelPreferenceInput,
  type ConversationModelPreferenceState,
} from './conversationModelPreferences.js';
import { normalizeModelContextWindow } from '../models/modelContextWindows.js';
import type { WebLiveConversationRunState } from './conversationRuns.js';
import {
  readSessionBlocksByFile,
  type DisplayBlock,
} from './sessions.js';
import {
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
  type ConversationAutoModeState,
  type ConversationAutoModeStateInput,
} from './conversationAutoMode.js';
import {
  assertLiveSessionSurfaceCanControl,
  buildLiveSessionPresenceState,
  createLiveSessionPresenceHost,
  LiveSessionControlError,
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
  clearPrewarmedLiveSessionLoaders,
  prewarmLiveSessionLoader,
  type LiveSessionLoaderOptions,
} from './liveSessionLoader.js';
import {
  readParallelState,
  writePersistedParallelJobs,
  type ParallelPromptJob,
  type ParallelPromptPreview,
} from './liveSessionParallelJobs.js';
import {
  loadPersistedParallelJobs,
  type ResolveParallelChildSession,
} from './liveSessionParallelReconciliation.js';
import {
  repairDanglingToolCallContext,
  type TranscriptTailRecoveryReason,
} from './liveSessionRecovery.js';
import {
  ensureSessionFileExists,
  patchSessionManagerPersistence,
  resolveLiveSessionFile,
} from './liveSessionPersistence.js';
import {
  buildFallbackTitleFromContent,
  isPlaceholderConversationTitle,
  resolveStableSessionTitle,
} from './liveSessionTitle.js';
import {
  buildConversationServiceTierPreferenceInput,
  resolveConversationPreferenceStateForSession as resolveConversationPreferenceStateForSessionWithSettings,
} from './liveSessionModels.js';
import {
  makeAuth as makeFactoryAuth,
  makeRegistry,
} from './liveSessionFactory.js';
import {
  createLiveSession as createLiveSessionWithCallbacks,
  createLiveSessionFromExisting as createLiveSessionFromExistingWithCallbacks,
  resumeLiveSession as resumeLiveSessionWithCallbacks,
} from './liveSessionCreation.js';
import {
  createLiveSessionHiddenTurnState,
  ensureHiddenTurnState,
  hasQueuedOrActiveHiddenTurn,
  type LiveSessionHiddenTurnState,
} from './liveSessionHiddenTurns.js';
import {
  toSse,
  type LiveContextUsage,
  type LiveContextUsageSegment,
  type SseEvent,
} from './liveSessionEvents.js';
import { handleLiveSessionEvent } from './liveSessionEventHandling.js';
import { executeLiveSessionBash } from './liveSessionBash.js';
import {
  markLiveSessionAutoModeContinueRequested,
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
import {
  broadcastLiveSessionAutoModeState,
  broadcastLiveSessionContextUsage,
  broadcastLiveSessionParallelState,
  broadcastLiveSessionQueueState,
  clearLiveSessionContextUsageTimer,
  readConversationAutoModeState,
  readLiveSessionContextUsage,
  scheduleLiveSessionContextUsage,
} from './liveSessionStateBroadcasts.js';
import { syncLiveSessionDurableRun } from './liveSessionDurableRun.js';
import { requestLiveSessionAutoTitle } from './liveSessionAutoTitleOps.js';
import {
  applyPendingLiveSessionWorkingDirectoryChange,
  requestLiveSessionWorkingDirectoryChange,
  type PendingConversationWorkingDirectoryChange,
} from './liveSessionCwdChange.js';
import {
  finalizeParallelChildLiveSession as finalizeParallelChildLiveSessionWithCallbacks,
  manageParallelPromptJob as manageParallelPromptJobWithCallbacks,
  startParallelPromptSession as startParallelPromptSessionWithCallbacks,
  tryImportReadyParallelJobs as tryImportReadyParallelJobsWithCallbacks,
} from './liveSessionParallelImportOps.js';
import {
  runPromptOnLiveEntry as runPromptOnLiveEntryWithCallbacks,
  submitPromptOnLiveEntry,
} from './liveSessionPromptOps.js';
import {
  branchLiveSession,
  forkLiveSession,
} from './liveSessionBranching.js';
import { repairLiveSessionTranscriptTail as repairLiveSessionTranscriptTailWithCallbacks } from './liveSessionTranscriptRepair.js';
import { summarizeAndForkLiveSession } from './liveSessionSummarizeFork.js';
import { finalizeLiveSessionBashExecution } from './liveSessionBashFinalization.js';
import {
  subscribeLiveSession,
  type LiveSessionSubscriptionListener,
} from './liveSessionSubscription.js';
import {
  compactLiveSession,
  renameLiveSession,
  updateLiveSessionModelPreferences as updateLiveSessionModelPreferencesWithCallbacks,
} from './liveSessionMaintenanceOps.js';
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

// ── Internal entry ────────────────────────────────────────────────────────────

type LiveListener = LiveSessionSubscriptionListener;

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
    contextUsage: readLiveSessionContextUsage(entry.session),
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

async function syncDurableConversationRun(
  entry: LiveEntry,
  state: WebLiveConversationRunState,
  input: { force?: boolean; lastError?: string } = {},
): Promise<void> {
  await syncLiveSessionDurableRun(entry, state, input);
}

function maybeAutoTitleConversation(entry: LiveEntry): void {
  requestLiveSessionAutoTitle({
    entry,
    settingsFile: SETTINGS_FILE,
    isCurrent: () => registry.get(entry.sessionId) === entry,
    applyTitle: (title) => applySessionTitle(entry, title),
  });
}

function broadcastContextUsage(entry: LiveEntry, force = false): void {
  broadcastLiveSessionContextUsage(entry, (event) => broadcast(entry, event), force);
}

function broadcastQueueState(entry: LiveEntry, force = false): void {
  broadcastLiveSessionQueueState(entry, (event) => broadcast(entry, event), force);
}

function broadcastParallelState(entry: LiveEntry, force = false): void {
  broadcastLiveSessionParallelState(entry, (event) => broadcast(entry, event), force);
}

function broadcastAutoModeState(entry: LiveEntry, force = false): void {
  broadcastLiveSessionAutoModeState(entry, (event) => broadcast(entry, event), force);
}

function scheduleContextUsage(entry: LiveEntry, delayMs = 400): void {
  scheduleLiveSessionContextUsage(entry, (event) => broadcast(entry, event), delayMs);
}

function clearContextUsageTimer(entry: LiveEntry): void {
  clearLiveSessionContextUsageTimer(entry);
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

  session.subscribe((event) => handleLiveSessionEvent(entry, event, {
    maybeAutoTitleConversation,
    requestConversationAutoModeContinuationTurn,
    syncDurableConversationRun,
    notifyLifecycleHandlers: notifyEntryLifecycleHandlers,
    applyPendingConversationWorkingDirectoryChange,
    scheduleContextUsage,
    publishSessionMetaChanged,
    broadcastQueueState,
    broadcastTitle,
    broadcastStats: (target, tokens, cost) => broadcast(target, { type: 'stats_update', tokens, cost }),
    clearContextUsageTimer,
    broadcastContextUsage,
    broadcastSnapshot,
    broadcast,
    tryImportReadyParallelJobs,
  }));


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
  return readLiveSessionContextUsage(entry.session);
}

/** Create a brand-new Pi session. */
export async function createSession(
  cwd: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{ id: string; sessionFile: string }> {
  return createLiveSessionWithCallbacks({
    cwd,
    agentDir: AGENT_DIR,
    settingsFile: SETTINGS_FILE,
    options,
    persistentSessionDir: resolvePersistentSessionDir(cwd),
    wireSession,
  });
}

/** Create a new live session in a different cwd from an existing session file. */
export async function createSessionFromExisting(
  sessionFile: string,
  cwd: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{ id: string; sessionFile: string }> {
  return createLiveSessionFromExistingWithCallbacks({
    sessionFile,
    cwd,
    agentDir: AGENT_DIR,
    settingsFile: SETTINGS_FILE,
    options,
    persistentSessionDir: resolvePersistentSessionDir(cwd),
    wireSession,
  });
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
  return requestLiveSessionWorkingDirectoryChange({
    conversationId: input.conversationId,
    cwd: input.cwd,
    continuePrompt: input.continuePrompt,
    loaderOptions,
    registry,
    pendingChanges: pendingConversationWorkingDirectoryChanges,
    resolveSessionFile: (entry) => resolveLiveSessionFile(entry.session, { ensurePersisted: true }) ?? undefined,
  });
}

async function applyPendingConversationWorkingDirectoryChange(entry: LiveEntry): Promise<void> {
  await applyPendingLiveSessionWorkingDirectoryChange({
    entry,
    pendingChanges: pendingConversationWorkingDirectoryChanges,
    resolveSessionFile: (candidate) => resolveLiveSessionFile(candidate.session, { ensurePersisted: true }) ?? undefined,
    createSessionFromExisting,
    promptSession,
    destroySession,
    broadcast,
  });
}

/** Resume an existing session file into a live session. */
export async function resumeSession(
  sessionFile: string,
  options: LiveSessionLoaderOptions & { cwdOverride?: string } = {},
): Promise<{ id: string }> {
  return resumeLiveSessionWithCallbacks({
    sessionFile,
    agentDir: AGENT_DIR,
    settingsFile: SETTINGS_FILE,
    options,
    findLiveSessionByFile: (candidateFile) => {
      for (const [id, entry] of registry.entries()) {
        if (resolveLiveSessionFile(entry.session) === candidateFile) return { id };
      }
      return null;
    },
    wireSession,
  });
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
  return subscribeLiveSession(entry, listener, options, {
    resolveTitle: resolveEntryTitle,
    broadcastPresenceState,
  });
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

async function finalizeParallelChildLiveSession(
  childConversationId: string,
  options: { abortIfRunning?: boolean } = {},
): Promise<'destroyed' | 'preserved' | 'missing'> {
  return finalizeParallelChildLiveSessionWithCallbacks(childConversationId, {
    childEntry: registry.get(childConversationId),
    destroySession,
    abortIfRunning: options.abortIfRunning,
  });
}

async function tryImportReadyParallelJobs(entry: LiveEntry): Promise<void> {
  await tryImportReadyParallelJobsWithCallbacks(entry, {
    hasQueuedOrActiveHiddenTurn,
    persistParallelJobs,
    broadcastParallelState,
    appendParallelImportedMessage,
    finalizeParallelChildLiveSession,
  });
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
  return startParallelPromptSessionWithCallbacks(entry, input, options, {
    createJobId: createParallelPromptJobId,
    createSession,
    forkSession,
    queuePromptContext,
    submitPromptSession,
    resolveDefaultServiceTier: (candidate) => buildConversationServiceTierPreferenceInput(
      resolveConversationPreferenceStateForSession(candidate.session.sessionManager, getAvailableModelObjects()),
    ),
    hasQueuedOrActiveHiddenTurn,
    persistParallelJobs,
    broadcastParallelState,
    getCurrentEntry: () => registry.get(sessionId),
    resolveParallelChildSession,
    tryImportReadyParallelJobs,
  });
}

export async function manageParallelPromptJob(
  sessionId: string,
  input: { jobId: string; action: 'importNow' | 'skip' | 'cancel' },
): Promise<{ ok: true; status: 'imported' | 'queued' | 'skipped' | 'cancelled' }> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }

  return manageParallelPromptJobWithCallbacks(entry, input, {
    persistParallelJobs,
    broadcastParallelState,
    finalizeParallelChildLiveSession,
    tryImportReadyParallelJobs,
  });
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
  return repairLiveSessionTranscriptTailWithCallbacks(entry, {
    broadcastSnapshot,
    clearContextUsageTimer,
    broadcastContextUsage,
    publishSessionMetaChanged: () => publishSessionMetaChanged(sessionId),
  });
}

async function runPromptOnLiveEntry(
  entry: LiveEntry,
  text: string,
  behavior: 'steer' | 'followUp' | undefined,
  images?: PromptImageAttachment[],
): Promise<void> {
  await runPromptOnLiveEntryWithCallbacks(entry, text, behavior, images, {
    repairLiveSessionTranscriptTail,
    broadcastQueueState,
  });
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
  return submitPromptOnLiveEntry(entry, text, normalizedBehavior, images, {
    runPromptOnLiveEntry,
  });
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

  finalizeLiveSessionBashExecution(entry, normalizedCommand, {
    broadcastTitle,
    broadcast,
    clearContextUsageTimer,
    broadcastContextUsage,
    broadcastSnapshot,
    publishSessionMetaChanged,
  });

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
  return compactLiveSession(entry, customInstructions, {
    broadcastSnapshot,
    clearContextUsageTimer,
    broadcastContextUsage,
    publishSessionMetaChanged,
  });
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
  renameLiveSession(entry, name, {
    applySessionTitle,
    syncDurableConversationRun,
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
  return updateLiveSessionModelPreferencesWithCallbacks({
    entry,
    preferences: input,
    availableModels: models,
    settingsFile: SETTINGS_FILE,
    publishSessionMetaChanged,
  });
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
  return branchLiveSession(entry, entryId, options, { resumeSession });
}

export async function forkSession(
  sessionId: string,
  entryId: string,
  options: LiveSessionLoaderOptions & { preserveSource?: boolean; beforeEntry?: boolean } = {},
): Promise<{ newSessionId: string; sessionFile: string }> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  return forkLiveSession(entry, entryId, options, {
    createSession,
    resumeSession,
    destroySession,
    resolveDefaultServiceTier: (candidate) => buildConversationServiceTierPreferenceInput(
      resolveConversationPreferenceStateForSession(candidate.session.sessionManager, getAvailableModelObjects()),
    ),
  });
}

export async function summarizeAndForkSession(
  sessionId: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{ newSessionId: string; sessionFile: string }> {
  const entry = registry.get(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} is not live`);
  }
  return summarizeAndForkLiveSession(entry, options, {
    createSessionFromExisting,
    resumeSession,
    compactSession,
    appendVisibleCustomMessage,
  });
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
