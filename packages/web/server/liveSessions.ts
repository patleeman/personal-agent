/**
 * Live Pi session registry.
 * Wraps @mariozechner/pi-coding-agent SDK sessions in-process and
 * exposes a pub/sub SSE event layer for the web server.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  getPiAgentRuntimeDir,
  getPiAgentStateDir,
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
import { invalidateAppTopics, publishAppEvent } from './appEvents.js';
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

const AGENT_DIR = getPiAgentRuntimeDir();
const SETTINGS_FILE = join(AGENT_DIR, 'settings.json');
const SESSIONS_DIR = join(getPiAgentStateDir(), 'sessions');

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

export type SseEvent =
  | { type: 'snapshot';        blocks: DisplayBlock[]; blockOffset: number; totalBlocks: number }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'user_message';    block: Extract<DisplayBlock, { type: 'user' }> }
  | { type: 'queue_state';     steering: string[]; followUp: string[] }
  | { type: 'text_delta';      delta: string }
  | { type: 'thinking_delta';  delta: string }
  | { type: 'tool_start';      toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_update';     toolCallId: string; partialResult: unknown }
  | { type: 'tool_end';        toolCallId: string; toolName: string; isError: boolean; durationMs: number; output: string; details?: unknown }
  | { type: 'title_update';    title: string }
  | { type: 'context_usage';   usage: LiveContextUsage | null }
  | { type: 'stats_update';    tokens: { input: number; output: number; total: number }; cost: number }
  | { type: 'error';           message: string };

export interface PromptImageAttachment {
  type: 'image';
  data: string;
  mimeType: string;
  name?: string;
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
  lastDurableRunState?: WebLiveConversationRunState;
  contextUsageTimer?: ReturnType<typeof setTimeout>;
}

export const registry = new Map<string, LiveEntry>();
const toolTimings = new Map<string, number>(); // toolCallId → start ms

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

// ── Auth / model helpers ──────────────────────────────────────────────────────

function makeAuth() {
  return AuthStorage.create(join(AGENT_DIR, 'auth.json'));
}

function makeRegistry(auth: AuthStorage) {
  return new ModelRegistry(auth);
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
  isStreaming: boolean,
): 'steer' | 'followUp' | undefined {
  return isStreaming ? behavior : undefined;
}

function readQueueState(session: AgentSession): { steering: string[]; followUp: string[] } {
  const steer = typeof session.getSteeringMessages === 'function'
    ? session.getSteeringMessages()
    : [];
  const followUp = typeof session.getFollowUpMessages === 'function'
    ? session.getFollowUpMessages()
    : [];

  return {
    steering: [...steer],
    followUp: [...followUp],
  };
}

interface InternalQueuedAgentMessage {
  role?: string;
  content?: unknown;
}

interface InternalAgentQueues {
  steeringQueue?: InternalQueuedAgentMessage[];
  followUpQueue?: InternalQueuedAgentMessage[];
}

function removeQueuedUserMessage(
  queue: InternalQueuedAgentMessage[],
  index: number,
): InternalQueuedAgentMessage | undefined {
  let userQueueIndex = 0;

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    if (queue[queueIndex]?.role !== 'user') {
      continue;
    }

    if (userQueueIndex === index) {
      return queue.splice(queueIndex, 1)[0];
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

function buildLiveStateBlocks(session: AgentSession): DisplayBlock[] {
  const state = session.state;
  const messages = state.messages.slice();
  const streamMessage = state.streamMessage;

  if (streamMessage) {
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
    },
  })));
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

function buildLiveSnapshot(entry: LiveEntry, tailBlocks?: number): {
  blocks: DisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
} {
  const liveBlocks = buildLiveStateBlocks(entry.session);
  const sessionFile = entry.session.sessionFile?.trim();
  if (!sessionFile || !existsSync(sessionFile)) {
    return {
      blocks: liveBlocks,
      blockOffset: 0,
      totalBlocks: liveBlocks.length,
    };
  }

  const persisted = readSessionBlocksByFile(sessionFile, { tailBlocks: tailBlocks ?? DEFAULT_LIVE_SNAPSHOT_TAIL_BLOCKS });
  if (!persisted || persisted.blocks.length === 0) {
    return {
      blocks: liveBlocks,
      blockOffset: 0,
      totalBlocks: liveBlocks.length,
    };
  }

  // session.state.messages is the *current context window*, not a chronological display transcript.
  // After compaction it can reorder blocks as: summary → pre-compaction tail → post-compaction tail.
  // For idle live sessions we should render the durable transcript from disk exactly as persisted.
  if (!entry.session.isStreaming) {
    return {
      blocks: persisted.blocks,
      blockOffset: persisted.blockOffset,
      totalBlocks: persisted.totalBlocks,
    };
  }

  const blocks = mergeConversationHistoryBlocks(persisted.blocks, liveBlocks);
  return {
    blocks,
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

function broadcastTitle(entry: LiveEntry): void {
  const title = resolveEntryTitle(entry);
  if (!title) {
    return;
  }

  entry.title = title;
  broadcast(entry, { type: 'title_update', title });
  publishAppEvent({ type: 'live_title', sessionId: entry.sessionId, title });
  invalidateAppTopics('sessions');
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
  };
  registry.set(id, entry);
  invalidateAppTopics('sessions');
  void syncDurableConversationRun(entry, session.isStreaming ? 'running' : 'waiting', { force: true });
  maybeAutoTitleConversation(entry);

  session.subscribe((event: AgentSessionEvent) => {
    if (event.type === 'turn_end') {
      maybeAutoTitleConversation(entry);
      void syncDurableConversationRun(entry, 'waiting');
    }

    if (event.type === 'agent_start' || event.type === 'message_update' || event.type === 'tool_execution_start' || event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      scheduleContextUsage(entry);
    }

    if (event.type === 'agent_start') {
      void syncDurableConversationRun(entry, 'running');
    }

    if (event.type === 'agent_end') {
      void syncDurableConversationRun(entry, 'waiting');
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
      invalidateAppTopics('sessions');
    }

    if (event.type === 'auto_compaction_end' && !event.aborted && event.result) {
      broadcastSnapshot(entry);
      clearContextUsageTimer(entry);
      broadcastContextUsage(entry, true);
      invalidateAppTopics('sessions');
    }

    const sse = toSse(event);
    if (sse) {
      broadcast(entry, sse);
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

    default:
      return null;
  }
}

function broadcast(entry: LiveEntry, event: SseEvent) {
  for (const listener of entry.listeners) {
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
  }));
}

export function getAvailableModels() {
  const auth = makeAuth();
  const registry = makeRegistry(auth);
  return registry.getAvailable().map(m => ({
    id:      m.id,
    name:    m.name ?? m.id,
    context: m.contextWindow ?? 128_000,
    provider: (m as { provider?: string }).provider ?? '',
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
    agentDir: AGENT_DIR,
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

interface LiveSessionLoaderOptions {
  extensionFactories?: ExtensionFactory[];
  additionalExtensionPaths?: string[];
  additionalSkillPaths?: string[];
  additionalPromptTemplatePaths?: string[];
  additionalThemePaths?: string[];
}

async function makeLoader(cwd: string, options: LiveSessionLoaderOptions = {}) {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: AGENT_DIR,
    extensionFactories: options.extensionFactories,
    additionalExtensionPaths: options.additionalExtensionPaths,
    additionalSkillPaths: options.additionalSkillPaths,
    additionalPromptTemplatePaths: options.additionalPromptTemplatePaths,
    additionalThemePaths: options.additionalThemePaths,
  });
  await loader.reload();
  return loader;
}

/** Create a brand-new Pi session. */
export async function createSession(
  cwd: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{ id: string; sessionFile: string }> {
  const auth = makeAuth();
  const resourceLoader = await makeLoader(cwd, options);
  const sessionManager = SessionManager.create(cwd, resolvePersistentSessionDir(cwd));
  const { session } = await createAgentSession({
    cwd,
    agentDir: AGENT_DIR,
    authStorage: auth,
    modelRegistry: makeRegistry(auth),
    resourceLoader,
    sessionManager,
  });

  patchConversationBashTool(session, cwd, session.sessionId, session.sessionFile);
  patchSessionManagerPersistence(session.sessionManager);
  ensureSessionFileExists(session.sessionManager);

  const id = session.sessionId;
  wireSession(id, session, cwd);
  return { id, sessionFile: session.sessionFile ?? '' };
}

/** Create a new live session in a different cwd from an existing session file. */
export async function createSessionFromExisting(
  sessionFile: string,
  cwd: string,
  options: LiveSessionLoaderOptions = {},
): Promise<{ id: string; sessionFile: string }> {
  const auth = makeAuth();
  const resourceLoader = await makeLoader(cwd, options);
  const sessionManager = SessionManager.forkFrom(sessionFile, cwd, resolvePersistentSessionDir(cwd));
  const { session } = await createAgentSession({
    cwd,
    agentDir: AGENT_DIR,
    authStorage: auth,
    modelRegistry: makeRegistry(auth),
    resourceLoader,
    sessionManager,
  });

  patchConversationBashTool(session, cwd, session.sessionId, session.sessionFile);
  patchSessionManagerPersistence(session.sessionManager);
  ensureSessionFileExists(session.sessionManager);

  const id = session.sessionId;
  wireSession(id, session, cwd);
  return { id, sessionFile: session.sessionFile ?? '' };
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
  const sessionManager = SessionManager.open(sessionFile);
  const cwd = sessionManager.getCwd();
  const resourceLoader = await makeLoader(cwd, options);
  const { session } = await createAgentSession({
    cwd,
    agentDir: AGENT_DIR,
    authStorage: auth,
    modelRegistry: makeRegistry(auth),
    resourceLoader,
    sessionManager,
  });

  patchConversationBashTool(session, cwd, session.sessionId, session.sessionFile);
  patchSessionManagerPersistence(session.sessionManager);

  const id = session.sessionId;
  wireSession(id, session, cwd, {
    autoTitleRequested: Boolean(session.sessionName?.trim()),
  });
  return { id };
}

/** Subscribe to SSE events for a live session. Returns unsubscribe fn or null if not live. */
export function subscribe(
  sessionId: string,
  listener: (e: SseEvent) => void,
  options?: { tailBlocks?: number },
): (() => void) | null {
  const entry = registry.get(sessionId);
  if (!entry) return null;

  const subscription: LiveListener = {
    send: listener,
    tailBlocks: options?.tailBlocks,
  };
  entry.listeners.add(subscription);

  listener({ type: 'snapshot', ...buildLiveSnapshot(entry, options?.tailBlocks) });
  const title = resolveEntryTitle(entry);
  if (title) {
    listener({ type: 'title_update', title });
  }
  listener({ type: 'context_usage', usage: readContextUsagePayload(entry.session) });
  listener({ type: 'queue_state', ...readQueueState(entry.session) });
  if (entry.session.isStreaming) {
    listener({ type: 'agent_start' });
  }

  return () => entry.listeners.delete(subscription);
}

/** Queue hidden context for the next turn of a live session. */
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

  await entry.session.sendCustomMessage({
    customType,
    content: message,
    display: false,
    details: undefined,
  }, {
    deliverAs: 'nextTurn',
  });
}

export async function promptSession(
  sessionId: string,
  text: string,
  behavior?: 'steer' | 'followUp',
  images?: PromptImageAttachment[],
): Promise<void> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  const { session } = entry;
  const normalizedBehavior = normalizeQueuedPromptBehavior(behavior, session.isStreaming);
  const hasImages = Boolean(images && images.length > 0);

  const runPrompt = async (allowImages: boolean): Promise<void> => {
    if (normalizedBehavior === 'steer') {
      await (allowImages && hasImages ? session.steer(text, images) : session.steer(text));
      broadcastQueueState(entry, true);
      return;
    }

    if (normalizedBehavior === 'followUp') {
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

export function restoreQueuedMessage(
  sessionId: string,
  behavior: 'steer' | 'followUp',
  index: number,
): { text: string; images: PromptImageAttachment[] } {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Queued message index must be a non-negative integer');
  }

  const visibleQueue = (behavior === 'steer'
    ? entry.session.getSteeringMessages()
    : entry.session.getFollowUpMessages()) as string[];

  if (index >= visibleQueue.length) {
    throw new Error('Queued message not found');
  }

  const [fallbackText] = visibleQueue.splice(index, 1);
  const internalAgent = entry.session.agent as unknown as InternalAgentQueues;
  const internalQueue = behavior === 'steer'
    ? internalAgent.steeringQueue
    : internalAgent.followUpQueue;

  if (!Array.isArray(internalQueue)) {
    visibleQueue.splice(index, 0, fallbackText ?? '');
    throw new Error('Queued message restore is unavailable for this session');
  }

  const removed = removeQueuedUserMessage(internalQueue, index);
  if (!removed) {
    visibleQueue.splice(index, 0, fallbackText ?? '');
    throw new Error('Queued message not found');
  }

  const restored = extractQueuedPromptContent(removed, fallbackText ?? '');
  broadcastQueueState(entry, true);
  return restored;
}

export async function compactSession(sessionId: string, customInstructions?: string) {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  const result = await entry.session.compact(customInstructions);
  broadcastSnapshot(entry);
  clearContextUsageTimer(entry);
  broadcastContextUsage(entry, true);
  invalidateAppTopics('sessions');
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
  if (entry.session.isStreaming) throw new Error('Cannot branch while a response is running. Use stop first.');

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
  if (entry.session.isStreaming) throw new Error('Cannot fork while a response is running. Use stop first.');

  if (!options.preserveSource) {
    const { cancelled } = await entry.session.fork(entryId);
    if (cancelled) throw new Error('Fork cancelled');

    patchSessionManagerPersistence(entry.session.sessionManager);
    ensureSessionFileExists(entry.session.sessionManager);

    // fork() creates a new session file and switches the current session to it
    const newId = entry.session.sessionId;
    const newFile = entry.session.sessionFile ?? '';

    // Re-register under the new ID
    registry.delete(sessionId);
    entry.sessionId = newId;
    entry.lastDurableRunState = undefined;
    registry.set(newId, entry);
    invalidateAppTopics('sessions');
    void syncDurableConversationRun(entry, entry.session.isStreaming ? 'running' : 'waiting', { force: true });

    return { newSessionId: newId, sessionFile: newFile };
  }

  const sourceSessionFile = entry.session.sessionFile;
  if (!sourceSessionFile) {
    throw new Error('Cannot fork a live session without a session file.');
  }

  const auth = makeAuth();
  const resourceLoader = await makeLoader(entry.cwd, options);
  const sessionManager = SessionManager.open(sourceSessionFile);
  let forkedSession: AgentSession | null = null;

  try {
    const { session } = await createAgentSession({
      cwd: entry.cwd,
      agentDir: AGENT_DIR,
      authStorage: auth,
      modelRegistry: makeRegistry(auth),
      resourceLoader,
      sessionManager,
    });

    forkedSession = session;
    patchConversationBashTool(forkedSession, entry.cwd, forkedSession.sessionId, forkedSession.sessionFile);
    patchSessionManagerPersistence(forkedSession.sessionManager);

    const { cancelled } = await forkedSession.fork(entryId);
    if (cancelled) throw new Error('Fork cancelled');

    ensureSessionFileExists(forkedSession.sessionManager);

    const newId = forkedSession.sessionId;
    const newFile = forkedSession.sessionFile ?? '';
    wireSession(newId, forkedSession, entry.cwd);

    return { newSessionId: newId, sessionFile: newFile };
  } catch (error) {
    forkedSession?.dispose();
    throw error;
  }
}

/** Cleanly dispose a live session. */
export function destroySession(sessionId: string): void {
  const entry = registry.get(sessionId);
  if (!entry) return;
  clearContextUsageTimer(entry);
  void syncDurableConversationRun(entry, entry.session.isStreaming ? 'interrupted' : 'waiting', {
    force: true,
    ...(entry.session.isStreaming ? { lastError: 'Live session disposed while a response was active.' } : {}),
  });
  entry.session.dispose();
  registry.delete(sessionId);
  invalidateAppTopics('sessions');
}
