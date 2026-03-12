/**
 * Live Pi session registry.
 * Wraps @mariozechner/pi-coding-agent SDK sessions in-process and
 * exposes a pub/sub SSE event layer for the web server.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  AgentSession,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSessionEvent,
  type ExtensionFactory,
} from '@mariozechner/pi-coding-agent';
import { invalidateAppTopics, publishAppEvent } from './appEvents.js';
import { buildDisplayBlocksFromEntries, type DisplayBlock } from './sessions.js';
import { estimateContextUsageSegments } from './sessionContextUsage.js';

const AGENT_DIR = join(homedir(), '.local/state/personal-agent/pi-agent');
const SESSIONS_DIR = join(AGENT_DIR, 'sessions');

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
  | { type: 'snapshot';        blocks: DisplayBlock[] }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'user_message';    block: Extract<DisplayBlock, { type: 'user' }> }
  | { type: 'queue_state';     steering: string[]; followUp: string[] }
  | { type: 'text_delta';      delta: string }
  | { type: 'thinking_delta';  delta: string }
  | { type: 'tool_start';      toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_update';     toolCallId: string; partialResult: unknown }
  | { type: 'tool_end';        toolCallId: string; toolName: string; isError: boolean; durationMs: number; output: string }
  | { type: 'title_update';    title: string }
  | { type: 'context_usage';   usage: LiveContextUsage | null }
  | { type: 'stats_update';    tokens: { input: number; output: number; total: number }; cost: number }
  | { type: 'error';           message: string };

export interface PromptImageAttachment {
  type: 'image';
  data: string;
  mimeType: string;
}

// ── Internal entry ────────────────────────────────────────────────────────────

interface LiveEntry {
  sessionId: string;
  session: AgentSession;
  cwd: string;
  listeners: Set<(e: SseEvent) => void>;
  title: string;
  sentTitle: boolean;
  lastContextUsageJson: string | null;
  lastQueueStateJson: string | null;
  contextUsageTimer?: ReturnType<typeof setTimeout>;
}

export const registry = new Map<string, LiveEntry>();
const toolTimings = new Map<string, number>(); // toolCallId → start ms

// ── Auth / model helpers ──────────────────────────────────────────────────────

function makeAuth() {
  return AuthStorage.create(join(AGENT_DIR, 'auth.json'));
}

function makeRegistry(auth: AuthStorage) {
  return new ModelRegistry(auth);
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

function resolveEntryTitle(entry: LiveEntry): string {
  if (entry.title.trim()) {
    return entry.title;
  }

  const firstUser = getSessionMessages(entry.session).find((message) => message.role === 'user');
  if (!firstUser) {
    return '';
  }

  const { text, imageCount } = summarizeUserMessageContent(firstUser.content);
  return formatConversationTitle(text, imageCount);
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

function buildLiveSnapshotBlocks(session: AgentSession): DisplayBlock[] {
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
    },
  })));
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

function wireSession(id: string, session: AgentSession, cwd: string) {
  const entry: LiveEntry = {
    sessionId: id,
    session,
    cwd,
    listeners: new Set(),
    title: '',
    sentTitle: false,
    lastContextUsageJson: null,
    lastQueueStateJson: null,
  };
  registry.set(id, entry);
  invalidateAppTopics('sessions');

  session.subscribe((event: AgentSessionEvent) => {
    // Extract title from first user message
    if (!entry.sentTitle && event.type === 'turn_end') {
      const title = resolveEntryTitle(entry);
      if (title) {
        entry.title = title;
        entry.sentTitle = true;
        broadcastTitle(entry);
      }
    }

    if (event.type === 'agent_start' || event.type === 'message_update' || event.type === 'tool_execution_start' || event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      scheduleContextUsage(entry);
    }

    if (event.type === 'message_start' && event.message.role === 'user') {
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
      return null;
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
      const result = event.result as { content?: Array<{ type: string; text?: string }> } | undefined;
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
      };
    }

    default:
      return null;
  }
}

function broadcast(entry: LiveEntry, event: SseEvent) {
  for (const fn of entry.listeners) fn(event);
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

async function makeLoader(cwd: string, extensionFactories: ExtensionFactory[] = []) {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: AGENT_DIR,
    extensionFactories,
  });
  await loader.reload();
  return loader;
}

/** Create a brand-new Pi session. */
export async function createSession(
  cwd: string,
  options: { extensionFactories?: ExtensionFactory[] } = {},
): Promise<{ id: string; sessionFile: string }> {
  const auth         = makeAuth();
  const resourceLoader = await makeLoader(cwd, options.extensionFactories);
  const { session }  = await createAgentSession({
    cwd,
    agentDir:      AGENT_DIR,
    authStorage:   auth,
    modelRegistry: makeRegistry(auth),
    resourceLoader,
    sessionManager: SessionManager.create(cwd, resolvePersistentSessionDir(cwd)),
  });

  patchSessionManagerPersistence(session.sessionManager);
  ensureSessionFileExists(session.sessionManager);

  const id = session.sessionId;
  wireSession(id, session, cwd);
  return { id, sessionFile: session.sessionFile ?? '' };
}

/** Resume an existing session file into a live session. */
export async function resumeSession(
  sessionFile: string,
  options: { extensionFactories?: ExtensionFactory[] } = {},
): Promise<{ id: string }> {
  // Don't re-create if already live
  for (const [id, e] of registry.entries()) {
    if (e.session.sessionFile === sessionFile) return { id };
  }

  const auth = makeAuth();
  const sessionManager = SessionManager.open(sessionFile);
  const cwd = sessionManager.getCwd();
  const resourceLoader = await makeLoader(cwd, options.extensionFactories);
  const { session } = await createAgentSession({
    cwd,
    agentDir: AGENT_DIR,
    authStorage: auth,
    modelRegistry: makeRegistry(auth),
    resourceLoader,
    sessionManager,
  });

  patchSessionManagerPersistence(session.sessionManager);

  const id = session.sessionId;
  wireSession(id, session, cwd);
  return { id };
}

/** Subscribe to SSE events for a live session. Returns unsubscribe fn or null if not live. */
export function subscribe(
  sessionId: string,
  listener: (e: SseEvent) => void,
): (() => void) | null {
  const entry = registry.get(sessionId);
  if (!entry) return null;
  entry.listeners.add(listener);

  listener({ type: 'snapshot', blocks: buildLiveSnapshotBlocks(entry.session) });
  const title = resolveEntryTitle(entry);
  if (title) {
    listener({ type: 'title_update', title });
  }
  listener({ type: 'context_usage', usage: readContextUsagePayload(entry.session) });
  listener({ type: 'queue_state', ...readQueueState(entry.session) });
  if (entry.session.isStreaming) {
    listener({ type: 'agent_start' });
  }

  return () => entry.listeners.delete(listener);
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

export async function compactSession(sessionId: string, customInstructions?: string) {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  return entry.session.compact(customInstructions);
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
  entry.session.setSessionName(name);
  invalidateAppTopics('sessions');
}

/** Abort the current agent run. */
export async function abortSession(sessionId: string): Promise<void> {
  const entry = registry.get(sessionId);
  if (entry) await entry.session.abort();
}

/** Fork a session at a given message entry ID. */
export async function forkSession(
  sessionId: string,
  entryId: string,
  options: { preserveSource?: boolean; extensionFactories?: ExtensionFactory[] } = {},
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
    registry.set(newId, entry);
    invalidateAppTopics('sessions');

    return { newSessionId: newId, sessionFile: newFile };
  }

  const sourceSessionFile = entry.session.sessionFile;
  if (!sourceSessionFile) {
    throw new Error('Cannot fork a live session without a session file.');
  }

  const auth = makeAuth();
  const resourceLoader = await makeLoader(entry.cwd, options.extensionFactories);
  let forkedSession: AgentSession | null = null;

  try {
    const { session } = await createAgentSession({
      cwd: entry.cwd,
      agentDir: AGENT_DIR,
      authStorage: auth,
      modelRegistry: makeRegistry(auth),
      resourceLoader,
      sessionManager: SessionManager.open(sourceSessionFile),
    });

    forkedSession = session;
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
  entry.session.dispose();
  registry.delete(sessionId);
  invalidateAppTopics('sessions');
}
