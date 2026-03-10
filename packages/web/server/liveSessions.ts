/**
 * Live Pi session registry.
 * Wraps @mariozechner/pi-coding-agent SDK sessions in-process and
 * exposes a pub/sub SSE event layer for the web server.
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  AgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSessionEvent,
} from '@mariozechner/pi-coding-agent';

const AGENT_DIR = join(homedir(), '.local/state/personal-agent/pi-agent');
const SESSIONS_DIR = join(AGENT_DIR, 'sessions');

// ── SSE event types sent to clients ──────────────────────────────────────────

export type SseEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'text_delta';      delta: string }
  | { type: 'thinking_delta';  delta: string }
  | { type: 'tool_start';      toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_update';     toolCallId: string; partialResult: unknown }
  | { type: 'tool_end';        toolCallId: string; toolName: string; isError: boolean; durationMs: number }
  | { type: 'error';           message: string };

// ── Internal entry ────────────────────────────────────────────────────────────

interface LiveEntry {
  session:    AgentSession;
  cwd:        string;
  listeners:  Set<(e: SseEvent) => void>;
}

const registry    = new Map<string, LiveEntry>();
const toolTimings = new Map<string, number>(); // toolCallId → start ms

// ── Auth / model helpers ──────────────────────────────────────────────────────

function makeAuth() {
  return AuthStorage.create(join(AGENT_DIR, 'auth.json'));
}

function makeRegistry(auth: AuthStorage) {
  return new ModelRegistry(auth);
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireSession(id: string, session: AgentSession, cwd: string) {
  const entry: LiveEntry = { session, cwd, listeners: new Set() };
  registry.set(id, entry);

  session.subscribe((event: AgentSessionEvent) => {
    const sse = toSse(event);
    if (sse) broadcast(entry, sse);
  });

  return entry;
}

function toSse(event: AgentSessionEvent): SseEvent | null {
  switch (event.type) {
    case 'agent_start': return { type: 'agent_start' };
    case 'agent_end':   return { type: 'agent_end' };
    case 'turn_end':    return { type: 'turn_end' };

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
      return {
        type: 'tool_end',
        toolCallId: event.toolCallId,
        toolName:   event.toolName,
        isError:    event.isError,
        durationMs: Date.now() - start,
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
  return Array.from(registry.entries()).map(([id, e]) => ({
    id,
    cwd:        e.cwd,
    sessionFile: e.session.sessionFile ?? '',
    isStreaming: e.session.isStreaming,
  }));
}

/** Create a brand-new Pi session. */
export async function createSession(cwd: string): Promise<{ id: string; sessionFile: string }> {
  const auth = makeAuth();
  const { session } = await createAgentSession({
    cwd,
    agentDir: AGENT_DIR,
    authStorage:   auth,
    modelRegistry: makeRegistry(auth),
    sessionManager: SessionManager.create(cwd, SESSIONS_DIR),
  });

  const id = session.sessionId;
  wireSession(id, session, cwd);
  return { id, sessionFile: session.sessionFile ?? '' };
}

/** Resume an existing session file into a live session. */
export async function resumeSession(sessionFile: string): Promise<{ id: string }> {
  // Don't re-create if already live
  for (const [id, e] of registry.entries()) {
    if (e.session.sessionFile === sessionFile) return { id };
  }

  const auth = makeAuth();
  const { session } = await createAgentSession({
    agentDir: AGENT_DIR,
    authStorage:    auth,
    modelRegistry:  makeRegistry(auth),
    sessionManager: SessionManager.open(sessionFile),
  });

  // Derive cwd from the session file directory name (best-effort)
  const derivedCwd = sessionFile.replace(/[/\\][^/\\]+$/, '') ?? process.cwd();
  const id = session.sessionId;
  wireSession(id, session, derivedCwd);
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
  return () => entry.listeners.delete(listener);
}

/** Send a prompt to a live session. */
export async function promptSession(
  sessionId: string,
  text: string,
  behavior?: 'steer' | 'followUp',
): Promise<void> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);
  const { session } = entry;

  if (behavior === 'steer')     return session.steer(text);
  if (behavior === 'followUp')  return session.followUp(text);
  return session.prompt(text);
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
): Promise<{ newSessionId: string; sessionFile: string }> {
  const entry = registry.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} is not live`);

  const { cancelled } = await entry.session.fork(entryId);
  if (cancelled) throw new Error('Fork cancelled');

  // fork() creates a new session file and switches the current session to it
  const newId   = entry.session.sessionId;
  const newFile = entry.session.sessionFile ?? '';

  // Re-register under the new ID
  registry.delete(sessionId);
  registry.set(newId, entry);

  return { newSessionId: newId, sessionFile: newFile };
}

/** Cleanly dispose a live session. */
export function destroySession(sessionId: string): void {
  const entry = registry.get(sessionId);
  if (!entry) return;
  entry.session.dispose();
  registry.delete(sessionId);
}
