/**
 * Live Pi session registry.
 * Wraps @mariozechner/pi-coding-agent SDK sessions in-process and
 * exposes a pub/sub SSE event layer for the web server.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { AuthStorage, DefaultResourceLoader, ModelRegistry, SessionManager, createAgentSession, } from '@mariozechner/pi-coding-agent';
import { invalidateAppTopics, publishAppEvent } from './appEvents.js';
import { generateConversationTitle, hasAssistantTitleSourceMessage, } from './conversationAutoTitle.js';
import { syncWebLiveConversationRun } from './conversationRuns.js';
import { buildDisplayBlocksFromEntries, getAssistantErrorDisplayMessage, readSessionBlocksByFile, readSessionMetaByFile, } from './sessions.js';
import { estimateContextUsageSegments } from './sessionContextUsage.js';
const AGENT_DIR = join(homedir(), '.local/state/personal-agent/pi-agent');
const SETTINGS_FILE = join(AGENT_DIR, 'settings.json');
const SESSIONS_DIR = join(AGENT_DIR, 'sessions');
export function resolvePersistentSessionDir(cwd) {
    const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
    return join(SESSIONS_DIR, safePath);
}
export const registry = new Map();
const toolTimings = new Map(); // toolCallId → start ms
// ── Auth / model helpers ──────────────────────────────────────────────────────
function makeAuth() {
    return AuthStorage.create(join(AGENT_DIR, 'auth.json'));
}
function makeRegistry(auth) {
    return new ModelRegistry(auth);
}
const SESSION_MANAGER_PERSISTENCE_PATCH = Symbol('pa.session-manager-persistence-patch');
export function patchSessionManagerPersistence(sessionManager) {
    const manager = sessionManager;
    if (manager[SESSION_MANAGER_PERSISTENCE_PATCH]) {
        return;
    }
    if (typeof manager._rewriteFile !== 'function') {
        return;
    }
    const rewriteFile = manager._rewriteFile.bind(manager);
    manager._persist = (entry) => {
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
export function ensureSessionFileExists(sessionManager) {
    const manager = sessionManager;
    if (!manager.persist || !manager.sessionFile || typeof manager._rewriteFile !== 'function') {
        return;
    }
    if (existsSync(manager.sessionFile) && manager.flushed) {
        return;
    }
    manager._rewriteFile();
    manager.flushed = true;
}
function summarizeUserMessageContent(content) {
    const blocks = Array.isArray(content)
        ? content
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
function formatConversationTitle(text, imageCount) {
    return text.trim().replace(/\n/g, ' ').slice(0, 80)
        || (imageCount === 1 ? '(image attachment)' : imageCount > 1 ? `(${imageCount} image attachments)` : '');
}
function getSessionMessages(session) {
    const stateMessages = session.state?.messages;
    if (Array.isArray(stateMessages)) {
        return stateMessages;
    }
    const agentMessages = session.agent?.state?.messages;
    return Array.isArray(agentMessages) ? agentMessages : [];
}
function buildFallbackTitleFromContent(content) {
    const { text, imageCount } = summarizeUserMessageContent(content);
    return formatConversationTitle(text, imageCount);
}
function resolveStableSessionTitle(session) {
    const sessionName = session.sessionName?.trim();
    if (sessionName) {
        return sessionName;
    }
    const sessionFile = session.sessionFile?.trim();
    if (sessionFile) {
        const persistedTitle = readSessionMetaByFile(sessionFile)?.title?.trim();
        if (persistedTitle) {
            return persistedTitle;
        }
    }
    const firstUser = getSessionMessages(session).find((message) => message.role === 'user');
    if (!firstUser) {
        return '';
    }
    return buildFallbackTitleFromContent(firstUser.content);
}
function resolveEntryTitle(entry) {
    const sessionName = entry.session.sessionName?.trim();
    if (sessionName) {
        return sessionName;
    }
    return entry.title.trim();
}
function isLikelyUnsupportedImageInputError(error) {
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
function readContextUsagePayload(session) {
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
    }
    catch {
        return null;
    }
}
function readQueueState(session) {
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
function removeQueuedUserMessage(queue, index) {
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
function extractQueuedPromptContent(message, fallbackText) {
    const textParts = [];
    const images = [];
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const part of content) {
        if (!part || typeof part !== 'object') {
            continue;
        }
        if (part.type === 'text' && typeof part.text === 'string') {
            textParts.push(part.text);
            continue;
        }
        if (part.type === 'image'
            && typeof part.data === 'string'
            && typeof part.mimeType === 'string') {
            const name = typeof part.name === 'string'
                ? part.name
                : undefined;
            images.push({
                type: 'image',
                data: part.data,
                mimeType: part.mimeType,
                ...(name ? { name } : {}),
            });
        }
    }
    return {
        text: textParts.join('') || fallbackText,
        images,
    };
}
function buildUserMessageBlock(message) {
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
function buildLiveStateBlocks(session) {
    const state = session.state;
    const messages = state.messages.slice();
    const streamMessage = state.streamMessage;
    if (streamMessage) {
        messages.push(streamMessage);
    }
    return buildDisplayBlocksFromEntries(messages.map((message, index) => ({
        id: `live-${index}`,
        timestamp: message.timestamp ?? index,
        message: {
            role: message.role ?? 'unknown',
            content: message.content,
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            details: message.details,
            stopReason: message.stopReason,
            errorMessage: message.errorMessage,
            summary: message.summary,
            tokensBefore: message.tokensBefore,
            fromId: message.fromId,
        },
    })));
}
function fingerprintDisplayBlock(block) {
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
// Live session state only contains the currently-kept context window after compaction.
// Merge it with the persisted snapshot so reconnects/navigation preserve any durable-only blocks while
// still converging on the compacted view once summaries are present.
function mergeConversationHistoryBlocks(persistedBlocks, liveBlocks) {
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
    return [...persistedBlocks, ...liveBlocks];
}
function buildLiveSnapshotBlocks(entry) {
    const liveBlocks = buildLiveStateBlocks(entry.session);
    const sessionFile = entry.session.sessionFile?.trim();
    if (!sessionFile || !existsSync(sessionFile)) {
        return liveBlocks;
    }
    const persistedBlocks = readSessionBlocksByFile(sessionFile)?.blocks ?? [];
    if (persistedBlocks.length === 0) {
        return liveBlocks;
    }
    // session.state.messages is the *current context window*, not a chronological display transcript.
    // After compaction it can reorder blocks as: summary → pre-compaction tail → post-compaction tail.
    // For idle live sessions we should render the durable transcript from disk exactly as persisted.
    if (!entry.session.isStreaming) {
        return persistedBlocks;
    }
    return mergeConversationHistoryBlocks(persistedBlocks, liveBlocks);
}
function broadcastSnapshot(entry) {
    broadcast(entry, { type: 'snapshot', blocks: buildLiveSnapshotBlocks(entry) });
}
function broadcastTitle(entry) {
    const title = resolveEntryTitle(entry);
    if (!title) {
        return;
    }
    entry.title = title;
    broadcast(entry, { type: 'title_update', title });
    publishAppEvent({ type: 'live_title', sessionId: entry.sessionId, title });
    invalidateAppTopics('sessions');
}
function applySessionTitle(entry, title) {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
        return;
    }
    entry.session.setSessionName(normalizedTitle);
    entry.title = normalizedTitle;
    broadcastTitle(entry);
}
function resolveLiveSessionProfile() {
    const profile = process.env.PERSONAL_AGENT_ACTIVE_PROFILE ?? process.env.PERSONAL_AGENT_PROFILE;
    const normalized = profile?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
}
async function syncDurableConversationRun(entry, state, input = {}) {
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[${new Date().toISOString()}] [web] [error] conversation durable run sync failed sessionId=${entry.sessionId} state=${state} message=${message}`);
    }
}
function maybeAutoTitleConversation(entry) {
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
function broadcastContextUsage(entry, force = false) {
    const usage = readContextUsagePayload(entry.session);
    const nextJson = JSON.stringify(usage);
    if (!force && entry.lastContextUsageJson === nextJson) {
        return;
    }
    entry.lastContextUsageJson = nextJson;
    broadcast(entry, { type: 'context_usage', usage });
}
function broadcastQueueState(entry, force = false) {
    const queueState = readQueueState(entry.session);
    const nextJson = JSON.stringify(queueState);
    if (!force && entry.lastQueueStateJson === nextJson) {
        return;
    }
    entry.lastQueueStateJson = nextJson;
    broadcast(entry, { type: 'queue_state', ...queueState });
}
function scheduleContextUsage(entry, delayMs = 400) {
    if (entry.contextUsageTimer) {
        return;
    }
    entry.contextUsageTimer = setTimeout(() => {
        entry.contextUsageTimer = undefined;
        broadcastContextUsage(entry);
    }, delayMs);
}
function clearContextUsageTimer(entry) {
    if (!entry.contextUsageTimer) {
        return;
    }
    clearTimeout(entry.contextUsageTimer);
    entry.contextUsageTimer = undefined;
}
// ── Event wiring ──────────────────────────────────────────────────────────────
function wireSession(id, session, cwd, options = {}) {
    const entry = {
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
    session.subscribe((event) => {
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
            if (!entry.session.sessionName?.trim() && !entry.title.trim()) {
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
            }
            catch { /* ignore */ }
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
export function toSse(event) {
    switch (event.type) {
        case 'agent_start': return { type: 'agent_start' };
        case 'agent_end': return { type: 'agent_end' };
        case 'turn_end': return { type: 'turn_end' };
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
                details: result?.details,
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
        id: m.id,
        name: m.name ?? m.id,
        context: m.contextWindow ?? 128_000,
        provider: m.provider ?? '',
    }));
}
export async function inspectAvailableTools(cwd, options = {}) {
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
            parameters: tool.parameters,
            active: activeToolSet.has(tool.name),
        }))
            .sort((left, right) => {
            if (left.active !== right.active) {
                return left.active ? -1 : 1;
            }
            return left.name.localeCompare(right.name);
        });
        return {
            cwd,
            activeTools,
            tools,
        };
    }
    finally {
        session.dispose();
    }
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
export function getSessionContextUsage(sessionId) {
    const entry = registry.get(sessionId);
    if (!entry)
        return null;
    return readContextUsagePayload(entry.session);
}
async function makeLoader(cwd, options = {}) {
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
export async function createSession(cwd, options = {}) {
    const auth = makeAuth();
    const resourceLoader = await makeLoader(cwd, options);
    const { session } = await createAgentSession({
        cwd,
        agentDir: AGENT_DIR,
        authStorage: auth,
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
/** Create a new live session in a different cwd from an existing session file. */
export async function createSessionFromExisting(sessionFile, cwd, options = {}) {
    const auth = makeAuth();
    const resourceLoader = await makeLoader(cwd, options);
    const { session } = await createAgentSession({
        cwd,
        agentDir: AGENT_DIR,
        authStorage: auth,
        modelRegistry: makeRegistry(auth),
        resourceLoader,
        sessionManager: SessionManager.forkFrom(sessionFile, cwd, resolvePersistentSessionDir(cwd)),
    });
    patchSessionManagerPersistence(session.sessionManager);
    ensureSessionFileExists(session.sessionManager);
    const id = session.sessionId;
    wireSession(id, session, cwd);
    return { id, sessionFile: session.sessionFile ?? '' };
}
/** Resume an existing session file into a live session. */
export async function resumeSession(sessionFile, options = {}) {
    // Don't re-create if already live
    for (const [id, e] of registry.entries()) {
        if (e.session.sessionFile === sessionFile)
            return { id };
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
    patchSessionManagerPersistence(session.sessionManager);
    const id = session.sessionId;
    wireSession(id, session, cwd, {
        autoTitleRequested: Boolean(session.sessionName?.trim()),
    });
    return { id };
}
/** Subscribe to SSE events for a live session. Returns unsubscribe fn or null if not live. */
export function subscribe(sessionId, listener) {
    const entry = registry.get(sessionId);
    if (!entry)
        return null;
    entry.listeners.add(listener);
    listener({ type: 'snapshot', blocks: buildLiveSnapshotBlocks(entry) });
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
export async function queuePromptContext(sessionId, customType, content) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
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
export async function promptSession(sessionId, text, behavior, images) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
    const { session } = entry;
    const hasImages = Boolean(images && images.length > 0);
    const runPrompt = async (allowImages) => {
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
    }
    catch (error) {
        if (!hasImages || !isLikelyUnsupportedImageInputError(error)) {
            throw error;
        }
        await runPrompt(false);
    }
}
export function restoreQueuedMessage(sessionId, behavior, index) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
    if (!Number.isInteger(index) || index < 0) {
        throw new Error('Queued message index must be a non-negative integer');
    }
    const visibleQueue = (behavior === 'steer'
        ? entry.session.getSteeringMessages()
        : entry.session.getFollowUpMessages());
    if (index >= visibleQueue.length) {
        throw new Error('Queued message not found');
    }
    const [fallbackText] = visibleQueue.splice(index, 1);
    const internalAgent = entry.session.agent;
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
export async function compactSession(sessionId, customInstructions) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
    const result = await entry.session.compact(customInstructions);
    broadcastSnapshot(entry);
    clearContextUsageTimer(entry);
    broadcastContextUsage(entry, true);
    invalidateAppTopics('sessions');
    return result;
}
export async function reloadSessionResources(sessionId) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
    await entry.session.reload();
}
export async function exportSessionHtml(sessionId, outputPath) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
    return entry.session.exportToHtml(outputPath);
}
export function renameSession(sessionId, name) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
    entry.autoTitleRequested = true;
    applySessionTitle(entry, name);
    void syncDurableConversationRun(entry, entry.lastDurableRunState ?? (entry.session.isStreaming ? 'running' : 'waiting'), {
        force: true,
    });
}
/** Abort the current agent run. */
export async function abortSession(sessionId) {
    const entry = registry.get(sessionId);
    if (entry)
        await entry.session.abort();
}
/** Fork a session at a given message entry ID. */
export async function branchSession(sessionId, entryId, options = {}) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
    if (entry.session.isStreaming)
        throw new Error('Cannot branch while a response is running. Use stop first.');
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
export async function forkSession(sessionId, entryId, options = {}) {
    const entry = registry.get(sessionId);
    if (!entry)
        throw new Error(`Session ${sessionId} is not live`);
    if (entry.session.isStreaming)
        throw new Error('Cannot fork while a response is running. Use stop first.');
    if (!options.preserveSource) {
        const { cancelled } = await entry.session.fork(entryId);
        if (cancelled)
            throw new Error('Fork cancelled');
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
    let forkedSession = null;
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
        if (cancelled)
            throw new Error('Fork cancelled');
        ensureSessionFileExists(forkedSession.sessionManager);
        const newId = forkedSession.sessionId;
        const newFile = forkedSession.sessionFile ?? '';
        wireSession(newId, forkedSession, entry.cwd);
        return { newSessionId: newId, sessionFile: newFile };
    }
    catch (error) {
        forkedSession?.dispose();
        throw error;
    }
}
/** Cleanly dispose a live session. */
export function destroySession(sessionId) {
    const entry = registry.get(sessionId);
    if (!entry)
        return;
    clearContextUsageTimer(entry);
    void syncDurableConversationRun(entry, entry.session.isStreaming ? 'interrupted' : 'waiting', {
        force: true,
        ...(entry.session.isStreaming ? { lastError: 'Live session disposed while a response was active.' } : {}),
    });
    entry.session.dispose();
    registry.delete(sessionId);
    invalidateAppTopics('sessions');
}
