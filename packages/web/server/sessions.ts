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
import { readSessionContextUsageFromFile, type SessionContextUsageSnapshot } from './sessionContextUsage.js';

export const DEFAULT_SESSIONS_DIR = join(homedir(), '.local/state/personal-agent/pi-agent/sessions');
export const SESSIONS_DIR = DEFAULT_SESSIONS_DIR;
export const DEFAULT_SESSIONS_INDEX_FILE = join(homedir(), '.local/state/personal-agent/pi-agent/session-meta-index.json');
export const SESSIONS_INDEX_FILE = DEFAULT_SESSIONS_INDEX_FILE;

// ── Raw JSONL types ────────────────────────────────────────────────────────────

interface RawSessionRecord {
  type: 'session';
  id: string;
  timestamp: string;
  cwd: string;
  version?: number;
}

interface RawModelChange {
  type: 'model_change';
  provider?: string;
  modelId?: string;
}

interface RawSessionInfo {
  type: 'session_info';
  name?: string;
}

interface RawContentBlock {
  type: 'text' | 'thinking' | 'toolCall' | 'image';
  text?: string;
  thinking?: string;
  // toolCall
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  // image
  data?: string;
  mimeType?: string;
  mediaType?: string;
}

type RawMessageContent = string | RawContentBlock[];

interface RawMessage {
  type: 'message';
  id: string;
  parentId: string | null;
  timestamp: string;
  message: {
    role: 'user' | 'assistant' | 'toolResult';
    content: RawMessageContent;
    toolCallId?: string;
    toolName?: string;
    details?: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
}

type RawLine = RawSessionRecord | RawModelChange | RawSessionInfo | RawMessage | { type: string };

// ── Public types ───────────────────────────────────────────────────────────────

export interface SessionMeta {
  id: string;
  file: string;          // absolute path
  timestamp: string;
  cwd: string;
  cwdSlug: string;       // directory name without leading/trailing --
  model: string;
  title: string;         // session display name or derived fallback title
  messageCount: number;
  isRunning?: boolean;
}

export interface SessionDetail {
  meta: SessionMeta;
  blocks: DisplayBlock[];
  contextUsage: SessionContextUsageSnapshot | null;
}

interface DisplayImage {
  alt: string;
  src?: string;
  mimeType?: string;
}

export type DisplayBlock =
  | { type: 'user';     id: string; ts: string; text: string; images?: DisplayImage[] }
  | { type: 'text';     id: string; ts: string; text: string }
  | { type: 'thinking'; id: string; ts: string; text: string }
  | { type: 'tool_use'; id: string; ts: string; tool: string; input: Record<string, unknown>; output: string; durationMs?: number; toolCallId: string; details?: unknown }
  | { type: 'image';    id: string; ts: string; alt: string; src?: string; mimeType?: string; width?: number; height?: number; caption?: string }
  | { type: 'error';    id: string; ts: string; tool?: string; message: string };

interface CachedSessionMeta {
  signature: string;
  meta: SessionMeta;
}

interface PersistentSessionIndexEntry {
  filePath: string;
  signature: string;
  meta: SessionMeta;
}

interface PersistentSessionIndexDocument {
  version: 1;
  sessionsDir: string;
  entries: PersistentSessionIndexEntry[];
}

const sessionMetaCache = new Map<string, CachedSessionMeta>();
let sessionFileById = new Map<string, string>();
let loadedPersistentIndexKey: string | null = null;
let persistedIndexJson: string | null = null;

// ── Parsing ────────────────────────────────────────────────────────────────────

function resolveSessionsDir(): string {
  return process.env.PA_SESSIONS_DIR ?? DEFAULT_SESSIONS_DIR;
}

function resolveSessionsIndexFile(): string {
  const sessionsDir = resolveSessionsDir();
  return process.env.PA_SESSIONS_INDEX_FILE ?? join(dirname(sessionsDir), 'session-meta-index.json');
}

function parseJsonLine(rawLine: string): RawLine | null {
  try {
    return JSON.parse(rawLine) as RawLine;
  } catch {
    return null;
  }
}

function parseJsonl(filePath: string): RawLine[] {
  const raw = readFileSync(filePath, 'utf-8');
  const lines: RawLine[] = [];

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

export interface DisplayMessageEntryLike {
  id: string;
  timestamp: string | number;
  message: {
    role: string;
    content: unknown;
    toolCallId?: string;
    toolName?: string;
    details?: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
}

function normalizeContent(content: unknown): RawContentBlock[] {
  if (Array.isArray(content)) return content as RawContentBlock[];
  if (typeof content === 'string' && content.length > 0) return [{ type: 'text', text: content }];
  return [];
}

function normalizeTimestamp(timestamp: string | number | undefined): string {
  if (typeof timestamp === 'string' && timestamp.trim()) {
    return timestamp;
  }
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }
  return new Date(0).toISOString();
}

function imageMimeType(block: RawContentBlock): string | undefined {
  return block.mimeType ?? block.mediaType;
}

function imageSrc(block: RawContentBlock): string | undefined {
  const mimeType = imageMimeType(block);
  if (!mimeType || !block.data) return undefined;
  return `data:${mimeType};base64,${block.data}`;
}

function extractUserContent(content: unknown): { text: string; images: DisplayImage[] } {
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

export function getAssistantErrorDisplayMessage(message: {
  stopReason?: string;
  errorMessage?: string;
}): string | null {
  if (message.stopReason !== 'error') {
    return null;
  }

  const errorMessage = message.errorMessage?.trim();
  return errorMessage && errorMessage.length > 0
    ? errorMessage
    : 'The model returned an error before completing its response.';
}

export function buildDisplayBlocksFromEntries(messages: DisplayMessageEntryLike[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  const toolCallIndex = new Map<string, number>();

  for (const [messageIndex, msg] of messages.entries()) {
    const { role, content, toolCallId, toolName, details } = msg.message;
    const ts = normalizeTimestamp(msg.timestamp);
    const contentBlocks = normalizeContent(content);
    const errorMessage = getAssistantErrorDisplayMessage(msg.message);
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

      if (errorMessage) {
        blocks.push({
          type: 'error',
          id: `${baseId}-e${blocks.length}`,
          ts,
          message: errorMessage,
        });
      }
      continue;
    }

    if (role === 'toolResult' && toolCallId) {
      const idx = toolCallIndex.get(toolCallId);
      if (idx !== undefined) {
        const existing = blocks[idx] as DisplayBlock & { type: 'tool_use' };
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
          type: 'image' as const,
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

function extractTitleFromMessage(message: RawMessage['message']): string | null {
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

function normalizeSessionName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return null;
  }

  const normalized = name.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function slugToCwd(slug: string): string {
  // slug: --Users-patrickc.lee-personal-personal-agent-- → /Users/patrickc.lee/personal/personal-agent
  return slug
    .replace(/^--/, '')
    .replace(/--$/, '')
    .replace(/-/g, '/');
}

function getFileSignature(filePath: string): string | null {
  try {
    const stats = statSync(filePath);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}

function readSessionMetaFromFile(filePath: string, cwdSlug: string): SessionMeta | null {
  const raw = readFileSync(filePath, 'utf-8');
  let sessionRecord: RawSessionRecord | null = null;
  let model = 'unknown';
  let fallbackTitle: string | null = null;
  let namedTitle: string | null = null;
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
      sessionRecord = line as RawSessionRecord;
      continue;
    }

    if (line.type === 'model_change' && model === 'unknown') {
      model = (line as RawModelChange).modelId ?? 'unknown';
      continue;
    }

    if (line.type === 'session_info') {
      sawSessionInfo = true;
      namedTitle = normalizeSessionName((line as RawSessionInfo).name);
      continue;
    }

    if (line.type !== 'message') {
      continue;
    }

    const message = line as RawMessage;
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

function serializePersistentSessionIndex(document: PersistentSessionIndexDocument): string {
  return JSON.stringify(document);
}

function buildPersistentSessionIndexDocument(sessionsDir: string): PersistentSessionIndexDocument {
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

function loadPersistentSessionIndexEntry(value: unknown): PersistentSessionIndexEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Partial<PersistentSessionIndexEntry>;
  const meta = entry.meta as Partial<SessionMeta> | undefined;
  if (typeof entry.filePath !== 'string' || typeof entry.signature !== 'string' || !meta) {
    return null;
  }
  if (
    typeof meta.id !== 'string'
    || typeof meta.timestamp !== 'string'
    || typeof meta.cwd !== 'string'
    || typeof meta.cwdSlug !== 'string'
    || typeof meta.model !== 'string'
    || typeof meta.title !== 'string'
    || typeof meta.messageCount !== 'number'
  ) {
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

function ensurePersistentIndexLoaded(): void {
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

    const parsed = JSON.parse(raw) as Partial<PersistentSessionIndexDocument>;
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
  } catch {
    sessionMetaCache.clear();
    sessionFileById.clear();
    persistedIndexJson = null;
  }
}

function persistSessionIndex(): void {
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
  } catch {
    // Ignore persistence failures; the in-memory cache still helps.
  }
}

function resolveSessionFileCwdSlug(filePath: string): string {
  const sessionsDir = resolveSessionsDir();
  return dirname(filePath) === sessionsDir ? '' : basename(dirname(filePath));
}

function listSessionFiles(sessionsDir: string): Array<{ filePath: string; cwdSlug: string }> {
  const files: Array<{ filePath: string; cwdSlug: string }> = [];

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
    } catch {
      continue;
    }
  }

  return files;
}

function readCachedSessionMeta(filePath: string, cwdSlug: string): SessionMeta | null {
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

function scanSessionMetas(): SessionMeta[] {
  ensurePersistentIndexLoaded();

  const sessionsDir = resolveSessionsDir();
  if (!existsSync(sessionsDir)) {
    sessionMetaCache.clear();
    sessionFileById.clear();
    persistSessionIndex();
    return [];
  }

  const metas: SessionMeta[] = [];
  const seenFiles = new Set<string>();
  const nextSessionFileById = new Map<string, string>();

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

function resolveSessionMeta(sessionId: string): SessionMeta | null {
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

export function clearSessionCaches(): void {
  sessionMetaCache.clear();
  sessionFileById.clear();
  loadedPersistentIndexKey = null;
  persistedIndexJson = null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function listSessions(): SessionMeta[] {
  return scanSessionMetas();
}

export function readSessionMetaByFile(filePath: string): SessionMeta | null {
  return readCachedSessionMeta(filePath, resolveSessionFileCwdSlug(filePath));
}

export function readSessionBlocks(sessionId: string): SessionDetail | null {
  const meta = resolveSessionMeta(sessionId);
  if (!meta) return null;

  const lines = parseJsonl(meta.file);
  const messages = lines.filter(l => l.type === 'message') as RawMessage[];

  return {
    meta,
    blocks: buildDisplayBlocksFromEntries(messages),
    contextUsage: readSessionContextUsageFromFile(meta.file),
  };
}
