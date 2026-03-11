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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readSessionContextUsageFromFile } from './sessionContextUsage.js';
export const SESSIONS_DIR = join(homedir(), '.local/state/personal-agent/pi-agent/sessions');
// ── Parsing ────────────────────────────────────────────────────────────────────
function parseJsonl(filePath) {
    const raw = readFileSync(filePath, 'utf-8');
    return raw
        .split('\n')
        .filter(l => l.trim())
        .flatMap(l => { try {
        return [JSON.parse(l)];
    }
    catch {
        return [];
    } });
}
function normalizeContent(content) {
    if (Array.isArray(content))
        return content;
    if (typeof content === 'string' && content.length > 0)
        return [{ type: 'text', text: content }];
    return [];
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
function extractTitle(lines) {
    for (const line of lines) {
        if (line.type !== 'message')
            continue;
        const msg = line.message;
        if (msg.role !== 'user')
            continue;
        const { text, images } = extractUserContent(msg.content);
        if (text) {
            return text.slice(0, 80).replace(/\n/g, ' ').trim();
        }
        if (images.length > 0) {
            return images.length === 1 ? '(image attachment)' : `(${images.length} image attachments)`;
        }
    }
    return '(untitled)';
}
function slugToCwd(slug) {
    // slug: --Users-patrickc.lee-personal-personal-agent-- → /Users/patrickc.lee/personal/personal-agent
    return slug
        .replace(/^--/, '')
        .replace(/--$/, '')
        .replace(/-/g, '/');
}
// ── Public API ─────────────────────────────────────────────────────────────────
export function listSessions() {
    if (!existsSync(SESSIONS_DIR))
        return [];
    const metas = [];
    for (const dirName of readdirSync(SESSIONS_DIR)) {
        const dirPath = join(SESSIONS_DIR, dirName);
        let files;
        try {
            files = readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
        }
        catch {
            continue;
        }
        for (const fileName of files) {
            const filePath = join(dirPath, fileName);
            try {
                const lines = parseJsonl(filePath);
                const sessionRec = lines.find(l => l.type === 'session');
                if (!sessionRec)
                    continue;
                const modelRec = lines.find(l => l.type === 'model_change');
                const messageLines = lines.filter(l => l.type === 'message');
                metas.push({
                    id: sessionRec.id,
                    file: filePath,
                    timestamp: sessionRec.timestamp,
                    cwd: sessionRec.cwd ?? slugToCwd(dirName),
                    cwdSlug: dirName,
                    model: modelRec?.modelId ?? 'unknown',
                    title: extractTitle(lines),
                    messageCount: messageLines.length,
                });
            }
            catch {
                continue;
            }
        }
    }
    // Most-recent first
    metas.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return metas;
}
export function readSessionBlocks(sessionId) {
    const metas = listSessions();
    const meta = metas.find(m => m.id === sessionId);
    if (!meta)
        return null;
    const lines = parseJsonl(meta.file);
    const messages = lines.filter(l => l.type === 'message');
    const blocks = [];
    const toolCallIndex = new Map(); // toolCallId → index in blocks
    for (const msg of messages) {
        const { role, content, toolCallId, toolName } = msg.message;
        const ts = msg.timestamp;
        const contentBlocks = normalizeContent(content);
        if (role === 'user') {
            const { text, images } = extractUserContent(content);
            if (text || images.length > 0) {
                blocks.push({
                    type: 'user',
                    id: msg.id,
                    ts,
                    text,
                    ...(images.length > 0 ? { images } : {}),
                });
            }
        }
        else if (role === 'assistant') {
            for (const block of contentBlocks) {
                if (block.type === 'thinking' && block.thinking?.trim()) {
                    blocks.push({ type: 'thinking', id: `${msg.id}-t${blocks.length}`, ts, text: block.thinking });
                }
                else if (block.type === 'text' && block.text?.trim()) {
                    blocks.push({ type: 'text', id: `${msg.id}-x${blocks.length}`, ts, text: block.text });
                }
                else if (block.type === 'toolCall' && block.id) {
                    const idx = blocks.length;
                    toolCallIndex.set(block.id, idx);
                    blocks.push({
                        type: 'tool_use',
                        id: `${msg.id}-c${blocks.length}`,
                        ts,
                        tool: block.name ?? 'unknown',
                        input: block.arguments ?? {},
                        output: '',
                        toolCallId: block.id,
                    });
                }
            }
        }
        else if (role === 'toolResult' && toolCallId) {
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
                blocks[idx] = { ...existing, output: resultText, durationMs: duration };
            }
            const resultImages = contentBlocks
                .filter((block) => block.type === 'image')
                .map((block, imageIndex) => ({
                type: 'image',
                id: `${msg.id}-i${imageIndex}`,
                ts,
                alt: toolName ? `${toolName} image result` : 'Tool image result',
                src: imageSrc(block),
                mimeType: imageMimeType(block),
                caption: toolName,
            }));
            blocks.push(...resultImages);
        }
    }
    return {
        meta,
        blocks,
        contextUsage: readSessionContextUsageFromFile(meta.file),
    };
}
