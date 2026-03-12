/**
 * Pi session JSONL reader → MessageBlock converter
 *
 * Session file format (JSONL):
 *   line 1: { type:'session', id, timestamp, cwd }
 *   line 2: { type:'model_change', modelId, ... }
 *   ...
 *   rest:   { type:'message', id, parentId, timestamp, message: { role, content } }
 *
 * Roles:
 *   user         → content: [{type:'text', text}|{type:'image', data, mimeType}]
 *   assistant    → content: [{type:'thinking', thinking}, {type:'toolCall', id, name, arguments}, {type:'text', text}]
 *   toolResult   → toolCallId, toolName, content: [{type:'text', text}|{type:'image', data, mimeType}]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { readSessionContextUsageFromFile } from './sessionContextUsage.js';
export const DEFAULT_SESSIONS_DIR = join(homedir(), '.local/state/personal-agent/pi-agent/sessions');
export const SESSIONS_DIR = DEFAULT_SESSIONS_DIR;
export const DEFAULT_SESSIONS_INDEX_FILE = join(homedir(), '.local/state/personal-agent/pi-agent/session-meta-index.json');
export const SESSIONS_INDEX_FILE = DEFAULT_SESSIONS_INDEX_FILE;
const sessionMetaCache = new Map();
let sessionFileById = new Map();
let loadedPersistentIndexKey = null;
let persistedIndexJson = null;
// ── Parsing ────────────────────────────────────────────────────────────────────
function resolveSessionsDir() {
    return process.env.PA_SESSIONS_DIR ?? DEFAULT_SESSIONS_DIR;
}
function resolveSessionsIndexFile() {
    const sessionsDir = resolveSessionsDir();
    return process.env.PA_SESSIONS_INDEX_FILE ?? join(dirname(sessionsDir), 'session-meta-index.json');
}
function parseJsonLine(rawLine) {
    try {
        return JSON.parse(rawLine);
    }
    catch {
        return null;
    }
}
function parseJsonl(filePath) {
    const raw = readFileSync(filePath, 'utf-8');
    const lines = [];
    for (const rawLine of raw.split('\n')) {
        if (!rawLine.trim()) {
            continue;
        }
        const line = parseJsonLine(rawLine);
        if (line) {
            lines.push(line);
        }
    }
    return lines;
}
function normalizeContent(content) {
    if (Array.isArray(content))
        return content;
    if (typeof content === 'string' && content.length > 0)
        return [{ type: 'text', text: content }];
    return [];
}
function normalizeTimestamp(timestamp) {
    if (typeof timestamp === 'string' && timestamp.trim()) {
        return timestamp;
    }
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        return new Date(timestamp).toISOString();
    }
    return new Date(0).toISOString();
}
function imageMimeType(block) {
    return block.mimeType ?? block.mediaType;
}
function imageSrc(block) {
    const mimeType = imageMimeType(block);
    if (!mimeType || !block.data)
        return undefined;
    return `data:${mimeType};base64,${block.data}`;
}
function extractUserContent(content) {
    const blocks = normalizeContent(content);
    const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
        .trim();
    const images = blocks
        .filter((block) => block.type === 'image')
        .map((block) => ({
        alt: 'Attached image',
        src: imageSrc(block),
        mimeType: imageMimeType(block),
    }));
    return { text, images };
}
export function buildDisplayBlocksFromEntries(messages) {
    const blocks = [];
    const toolCallIndex = new Map();
    for (const [messageIndex, msg] of messages.entries()) {
        const { role, content, toolCallId, toolName, details } = msg.message;
        const ts = normalizeTimestamp(msg.timestamp);
        const contentBlocks = normalizeContent(content);
        const baseId = msg.id || `msg-${messageIndex}`;
        if (role === 'user') {
            const { text, images } = extractUserContent(content);
            if (text || images.length > 0) {
                blocks.push({
                    type: 'user',
                    id: baseId,
                    ts,
                    text,
                    ...(images.length > 0 ? { images } : {}),
                });
            }
            continue;
        }
        if (role === 'assistant') {
            for (const block of contentBlocks) {
                if (block.type === 'thinking' && block.thinking?.trim()) {
                    blocks.push({ type: 'thinking', id: `${baseId}-t${blocks.length}`, ts, text: block.thinking });
                    continue;
                }
                if (block.type === 'text' && block.text?.trim()) {
                    blocks.push({ type: 'text', id: `${baseId}-x${blocks.length}`, ts, text: block.text });
                    continue;
                }
                if (block.type === 'toolCall' && block.id) {
                    const idx = blocks.length;
                    toolCallIndex.set(block.id, idx);
                    blocks.push({
                        type: 'tool_use',
                        id: `${baseId}-c${blocks.length}`,
                        ts,
                        tool: block.name ?? 'unknown',
                        input: block.arguments ?? {},
                        output: '',
                        toolCallId: block.id,
                    });
                }
            }
            continue;
        }
        if (role === 'toolResult' && toolCallId) {
            const idx = toolCallIndex.get(toolCallId);
            if (idx !== undefined) {
                const existing = blocks[idx];
                const resultText = contentBlocks
                    .filter((block) => block.type === 'text')
                    .map((block) => block.text ?? '')
                    .join('\n')
                    .slice(0, 8000);
                const startMs = new Date(existing.ts).getTime();
                const endMs = new Date(ts).getTime();
                const duration = endMs > startMs ? endMs - startMs : undefined;
                blocks[idx] = { ...existing, output: resultText, durationMs: duration, details };
            }
            const resultImages = contentBlocks
                .filter((block) => block.type === 'image')
                .map((block, imageIndex) => ({
                type: 'image',
                id: `${baseId}-i${imageIndex}`,
                ts,
                alt: toolName ? `${toolName} image result` : 'Tool image result',
                src: imageSrc(block),
                mimeType: imageMimeType(block),
                caption: toolName,
            }));
            blocks.push(...resultImages);
        }
    }
    return blocks;
}
function extractTitleFromMessage(message) {
    if (message.role !== 'user') {
        return null;
    }
    const { text, images } = extractUserContent(message.content);
    if (text) {
        return text.slice(0, 80).replace(/\n/g, ' ').trim();
    }
    if (images.length > 0) {
        return images.length === 1 ? '(image attachment)' : `(${images.length} image attachments)`;
    }
    return null;
}
function normalizeSessionName(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const normalized = name.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}
function slugToCwd(slug) {
    // slug: --Users-patrickc.lee-personal-personal-agent-- → /Users/patrickc.lee/personal/personal-agent
    return slug
        .replace(/^--/, '')
        .replace(/--$/, '')
        .replace(/-/g, '/');
}
function getFileSignature(filePath) {
    try {
        const stats = statSync(filePath);
        return `${stats.size}:${stats.mtimeMs}`;
    }
    catch {
        return null;
    }
}
function readSessionMetaFromFile(filePath, cwdSlug) {
    const raw = readFileSync(filePath, 'utf-8');
    let sessionRecord = null;
    let model = 'unknown';
    let fallbackTitle = null;
    let namedTitle = null;
    let sawSessionInfo = false;
    let messageCount = 0;
    for (const rawLine of raw.split('\n')) {
        if (!rawLine.trim()) {
            continue;
        }
        const line = parseJsonLine(rawLine);
        if (!line) {
            continue;
        }
        if (line.type === 'session') {
            sessionRecord = line;
            continue;
        }
        if (line.type === 'model_change' && model === 'unknown') {
            model = line.modelId ?? 'unknown';
            continue;
        }
        if (line.type === 'session_info') {
            sawSessionInfo = true;
            namedTitle = normalizeSessionName(line.name);
            continue;
        }
        if (line.type !== 'message') {
            continue;
        }
        const message = line;
        messageCount += 1;
        if (fallbackTitle === null) {
            fallbackTitle = extractTitleFromMessage(message.message);
        }
    }
    if (!sessionRecord) {
        return null;
    }
    return {
        id: sessionRecord.id,
        file: filePath,
        timestamp: sessionRecord.timestamp,
        cwd: sessionRecord.cwd ?? slugToCwd(cwdSlug),
        cwdSlug,
        model,
        title: (sawSessionInfo ? namedTitle : null) ?? fallbackTitle ?? 'New Conversation',
        messageCount,
    };
}
function serializePersistentSessionIndex(document) {
    return JSON.stringify(document);
}
function buildPersistentSessionIndexDocument(sessionsDir) {
    const entries = [...sessionMetaCache.entries()]
        .map(([filePath, cached]) => ({
        filePath,
        signature: cached.signature,
        meta: cached.meta,
    }))
        .sort((left, right) => left.filePath.localeCompare(right.filePath));
    return {
        version: 1,
        sessionsDir,
        entries,
    };
}
function loadPersistentSessionIndexEntry(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const entry = value;
    const meta = entry.meta;
    if (typeof entry.filePath !== 'string' || typeof entry.signature !== 'string' || !meta) {
        return null;
    }
    if (typeof meta.id !== 'string'
        || typeof meta.timestamp !== 'string'
        || typeof meta.cwd !== 'string'
        || typeof meta.cwdSlug !== 'string'
        || typeof meta.model !== 'string'
        || typeof meta.title !== 'string'
        || typeof meta.messageCount !== 'number') {
        return null;
    }
    return {
        filePath: entry.filePath,
        signature: entry.signature,
        meta: {
            id: meta.id,
            file: entry.filePath,
            timestamp: meta.timestamp,
            cwd: meta.cwd,
            cwdSlug: meta.cwdSlug,
            model: meta.model,
            title: meta.title,
            messageCount: meta.messageCount,
        },
    };
}
function ensurePersistentIndexLoaded() {
    const sessionsDir = resolveSessionsDir();
    const indexFile = resolveSessionsIndexFile();
    const indexKey = `${sessionsDir}::${indexFile}`;
    if (loadedPersistentIndexKey === indexKey) {
        return;
    }
    sessionMetaCache.clear();
    sessionFileById.clear();
    loadedPersistentIndexKey = indexKey;
    persistedIndexJson = null;
    if (!existsSync(indexFile)) {
        return;
    }
    try {
        const raw = readFileSync(indexFile, 'utf-8').trim();
        if (!raw) {
            return;
        }
        const parsed = JSON.parse(raw);
        if (parsed.version !== 1 || parsed.sessionsDir !== sessionsDir || !Array.isArray(parsed.entries)) {
            return;
        }
        for (const value of parsed.entries) {
            const entry = loadPersistentSessionIndexEntry(value);
            if (!entry) {
                continue;
            }
            sessionMetaCache.set(entry.filePath, {
                signature: entry.signature,
                meta: entry.meta,
            });
            sessionFileById.set(entry.meta.id, entry.filePath);
        }
        persistedIndexJson = serializePersistentSessionIndex(buildPersistentSessionIndexDocument(sessionsDir));
    }
    catch {
        sessionMetaCache.clear();
        sessionFileById.clear();
        persistedIndexJson = null;
    }
}
function persistSessionIndex() {
    const sessionsDir = resolveSessionsDir();
    const indexFile = resolveSessionsIndexFile();
    const nextJson = serializePersistentSessionIndex(buildPersistentSessionIndexDocument(sessionsDir));
    if (nextJson === persistedIndexJson) {
        return;
    }
    try {
        mkdirSync(dirname(indexFile), { recursive: true });
        writeFileSync(indexFile, nextJson);
        persistedIndexJson = nextJson;
    }
    catch {
        // Ignore persistence failures; the in-memory cache still helps.
    }
}
function resolveSessionFileCwdSlug(filePath) {
    const sessionsDir = resolveSessionsDir();
    return dirname(filePath) === sessionsDir ? '' : basename(dirname(filePath));
}
function listSessionFiles(sessionsDir) {
    const files = [];
    for (const entryName of readdirSync(sessionsDir)) {
        const entryPath = join(sessionsDir, entryName);
        try {
            const stats = statSync(entryPath);
            if (stats.isFile()) {
                if (entryName.endsWith('.jsonl')) {
                    files.push({ filePath: entryPath, cwdSlug: '' });
                }
                continue;
            }
            if (!stats.isDirectory()) {
                continue;
            }
            for (const fileName of readdirSync(entryPath)) {
                if (!fileName.endsWith('.jsonl')) {
                    continue;
                }
                files.push({ filePath: join(entryPath, fileName), cwdSlug: entryName });
            }
        }
        catch {
            continue;
        }
    }
    return files;
}
function readCachedSessionMeta(filePath, cwdSlug) {
    const signature = getFileSignature(filePath);
    if (!signature) {
        sessionMetaCache.delete(filePath);
        return null;
    }
    const cached = sessionMetaCache.get(filePath);
    if (cached && cached.signature === signature) {
        return cached.meta;
    }
    const meta = readSessionMetaFromFile(filePath, cwdSlug);
    if (!meta) {
        sessionMetaCache.delete(filePath);
        return null;
    }
    sessionMetaCache.set(filePath, { signature, meta });
    return meta;
}
function scanSessionMetas() {
    ensurePersistentIndexLoaded();
    const sessionsDir = resolveSessionsDir();
    if (!existsSync(sessionsDir)) {
        sessionMetaCache.clear();
        sessionFileById.clear();
        persistSessionIndex();
        return [];
    }
    const metas = [];
    const seenFiles = new Set();
    const nextSessionFileById = new Map();
    for (const { filePath, cwdSlug } of listSessionFiles(sessionsDir)) {
        seenFiles.add(filePath);
        const meta = readCachedSessionMeta(filePath, cwdSlug);
        if (!meta) {
            continue;
        }
        metas.push(meta);
        nextSessionFileById.set(meta.id, filePath);
    }
    for (const filePath of sessionMetaCache.keys()) {
        if (!seenFiles.has(filePath)) {
            sessionMetaCache.delete(filePath);
        }
    }
    sessionFileById = nextSessionFileById;
    metas.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    persistSessionIndex();
    return metas;
}
function resolveSessionMeta(sessionId) {
    ensurePersistentIndexLoaded();
    const cachedFilePath = sessionFileById.get(sessionId);
    if (cachedFilePath) {
        const cachedMeta = readCachedSessionMeta(cachedFilePath, resolveSessionFileCwdSlug(cachedFilePath));
        if (cachedMeta?.id === sessionId) {
            return cachedMeta;
        }
    }
    const metas = scanSessionMetas();
    return metas.find((meta) => meta.id === sessionId) ?? null;
}
export function clearSessionCaches() {
    sessionMetaCache.clear();
    sessionFileById.clear();
    loadedPersistentIndexKey = null;
    persistedIndexJson = null;
}
// ── Public API ─────────────────────────────────────────────────────────────────
export function listSessions() {
    return scanSessionMetas();
}
export function readSessionMetaByFile(filePath) {
    return readCachedSessionMeta(filePath, resolveSessionFileCwdSlug(filePath));
}
export function readSessionBlocks(sessionId) {
    const meta = resolveSessionMeta(sessionId);
    if (!meta)
        return null;
    const lines = parseJsonl(meta.file);
    const messages = lines.filter(l => l.type === 'message');
    return {
        meta,
        blocks: buildDisplayBlocksFromEntries(messages),
        contextUsage: readSessionContextUsageFromFile(meta.file),
    };
}
