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
 *   user         → content: [{type:'text', text}]
 *   assistant    → content: [{type:'thinking', thinking}, {type:'toolCall', id, name, arguments}, {type:'text', text}]
 *   toolResult   → toolCallId, toolName, content: [{type:'text', text}|{type:'image', data}]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
function extractTitle(lines) {
    for (const line of lines) {
        if (line.type !== 'message')
            continue;
        const msg = line.message;
        if (msg.role !== 'user')
            continue;
        for (const block of msg.content) {
            if (block.type === 'text' && block.text?.trim()) {
                return block.text.slice(0, 80).replace(/\n/g, ' ').trim();
            }
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
        const { role, content, toolCallId } = msg.message;
        const ts = msg.timestamp;
        if (role === 'user') {
            const text = content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim();
            if (text)
                blocks.push({ type: 'user', id: msg.id, ts, text });
        }
        else if (role === 'assistant') {
            for (const block of content) {
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
                // Collect only text blocks from result (skip raw image data)
                const resultText = content
                    .filter(b => b.type === 'text')
                    .map(b => b.text ?? '')
                    .join('\n')
                    .slice(0, 8000); // cap at 8k chars
                // Compute rough duration from timestamps
                const startMs = new Date(existing.ts).getTime();
                const endMs = new Date(ts).getTime();
                const duration = endMs > startMs ? endMs - startMs : undefined;
                blocks[idx] = { ...existing, output: resultText, durationMs: duration };
            }
        }
    }
    return { meta, blocks };
}
