/**
 * Live Pi session registry.
 * Wraps @mariozechner/pi-coding-agent SDK sessions in-process and
 * exposes a pub/sub SSE event layer for the web server.
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { AuthStorage, DefaultResourceLoader, ModelRegistry, SessionManager, createAgentSession, } from '@mariozechner/pi-coding-agent';
const AGENT_DIR = join(homedir(), '.local/state/personal-agent/pi-agent');
const SESSIONS_DIR = join(AGENT_DIR, 'sessions');
const registry = new Map();
const toolTimings = new Map(); // toolCallId → start ms
// ── Auth / model helpers ──────────────────────────────────────────────────────
function makeAuth() {
    return AuthStorage.create(join(AGENT_DIR, 'auth.json'));
}
function makeRegistry(auth) {
    return new ModelRegistry(auth);
}
// ── Event wiring ──────────────────────────────────────────────────────────────
function wireSession(id, session, cwd) {
    const entry = { session, cwd, listeners: new Set(), title: '', sentTitle: false };
    registry.set(id, entry);
    session.subscribe((event) => {
        // Extract title from first user message
        if (!entry.sentTitle && event.type === 'turn_end') {
            const msgs = session.agent.state.messages;
            const firstUser = msgs.find(m => m.role === 'user');
            if (firstUser) {
                const content = firstUser.content;
                const text = Array.isArray(content)
                    ? content.find((c) => c.type === 'text')?.text ?? ''
                    : String(content);
                entry.title = text.trim().replace(/\n/g, ' ').slice(0, 80);
                entry.sentTitle = true;
                broadcast(entry, { type: 'title_update', title: entry.title });
            }
        }
        // Emit stats after agent_end
        if (event.type === 'agent_end') {
            try {
                const stats = session.getSessionStats();
                broadcast(entry, { type: 'stats_update', tokens: stats.tokens, cost: stats.cost });
            }
            catch { /* ignore */ }
        }
        const sse = toSse(event);
        if (sse)
            broadcast(entry, sse);
    });
    return entry;
}
function toSse(event) {
    switch (event.type) {
        case 'agent_start': return { type: 'agent_start' };
        case 'agent_end': return { type: 'agent_end' };
        case 'turn_end': return { type: 'turn_end' };
        case 'message_update': {
            const e = event.assistantMessageEvent;
            if (e.type === 'text_delta')
                return { type: 'text_delta', delta: e.delta };
            if (e.type === 'thinking_delta')
                return { type: 'thinking_delta', delta: e.delta };
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
            const result = event.result;
            const outputText = result?.content
                ?.filter(c => c.type === 'text')
                .map(c => c.text ?? '')
                .join('\n')
                .slice(0, 8000) ?? '';
            return {
                type: 'tool_end',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                isError: event.isError,
                durationMs: Date.now() - start,
                output: outputText,
            };
        }
        default:
            return null;
    }
}
function broadcast(entry, event) {
    for (const fn of entry.listeners)
        fn(event);
}
// ── Public API ────────────────────────────────────────────────────────────────
export function isLive(sessionId) {
    return registry.has(sessionId);
}
export function getLiveSessions() {
    return Array.from(registry.entries()).map(([id, e]) => ({
        id,
        cwd: e.cwd,
        sessionFile: e.session.sessionFile ?? '',
        isStreaming: e.session.isStreaming,
    }));
}
export function getSessionStats(sessionId) {
    const entry = registry.get(sessionId);
    if (!entry)
        return null;
    try {
        return entry.session.getSessionStats();
    }
    catch {
        return null;
    }
}
async function makeLoader(cwd) {
    const loader = new DefaultResourceLoader({ cwd, agentDir: AGENT_DIR });
    await loader.reload();
    return loader;
}
/** Create a brand-new Pi session. */
export async function createSession(cwd) {
    const auth = makeAuth();
    const resourceLoader = await makeLoader(cwd);
    const { session } = await createAgentSession({
        cwd,
        agentDir: AGENT_DIR,
        authStorage: auth,
        modelRegistry: makeRegistry(auth),
        resourceLoader,
        sessionManager: SessionManager.create(cwd, SESSIONS_DIR),
    });
    const id = session.sessionId;
    wireSession(id, session, cwd);
    return { id, sessionFile: session.sessionFile ?? '' };
}
/** Resume an existing session file into a live session. */
export async function resumeSession(sessionFile) {
    // Don't re-create if already live
    for (const [id, e] of registry.entries()) {
        if (e.session.sessionFile === sessionFile)
            return { id };
    }
    const auth = makeAuth();
    // Derive cwd from sessions dir parent — best effort
    const cwd = SESSIONS_DIR;
    const resourceLoader = await makeLoader(cwd);
    const { session } = await createAgentSession({
        cwd,
        agentDir: AGENT_DIR,
        authStorage: auth,
        modelRegistry: makeRegistry(auth),
        resourceLoader,
        sessionManager: SessionManager.open(sessionFile),
    });
    // Derive cwd from the session file directory name (best-effort)
    const derivedCwd = sessionFile.replace(/[/\\][^/\\]+$/, '') ?? process.cwd();
    const id = session.sessionId;
    wireSession(id, session, derivedCwd);
    return { id };
}
/** Subscribe to SSE events for a live session. Returns unsubscribe fn or null if not live. */
export function subscribe(sessionId, listener) {
    const entry = registry.get(sessionId);
    if (!entry)
        return null;
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
}
/** Send a prompt to a live session. */
export async function promptSession(sessionId, text, behavior) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
    const { session } = entry;
    if (behavior === 'steer')
        return session.steer(text);
    if (behavior === 'followUp')
        return session.followUp(text);
    return session.prompt(text);
}
/** Abort the current agent run. */
export async function abortSession(sessionId) {
    const entry = registry.get(sessionId);
    if (entry)
        await entry.session.abort();
}
/** Fork a session at a given message entry ID. */
export async function forkSession(sessionId, entryId) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
    const { cancelled } = await entry.session.fork(entryId);
    if (cancelled)
        throw new Error('Fork cancelled');
    // fork() creates a new session file and switches the current session to it
    const newId = entry.session.sessionId;
    const newFile = entry.session.sessionFile ?? '';
    // Re-register under the new ID
    registry.delete(sessionId);
    registry.set(newId, entry);
    return { newSessionId: newId, sessionFile: newFile };
}
/** Cleanly dispose a live session. */
export function destroySession(sessionId) {
    const entry = registry.get(sessionId);
    if (!entry)
        return;
    entry.session.dispose();
    registry.delete(sessionId);
}
