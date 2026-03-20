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

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { getPiAgentRuntimeDir, getPiAgentStateDir } from '@personal-agent/core';
import {
  SessionManager,
  type SessionEntry,
} from '@mariozechner/pi-coding-agent';
import {
  readSessionContextUsageFromEntries,
  type SessionContextUsageSnapshot,
} from './sessionContextUsage.js';

export const DEFAULT_SESSIONS_DIR = join(getPiAgentStateDir(), 'sessions');
export const SESSIONS_DIR = DEFAULT_SESSIONS_DIR;
export const DEFAULT_SESSIONS_INDEX_FILE = join(getPiAgentRuntimeDir(), 'session-meta-index.json');
export const SESSIONS_INDEX_FILE = DEFAULT_SESSIONS_INDEX_FILE;

// ── Raw JSONL types ────────────────────────────────────────────────────────────

interface RawSessionRecord {
  type: 'session';
  id: string;
  timestamp: string;
  cwd: string;
  version?: number;
  parentSession?: string;
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

interface RawCustomMessage {
  type: 'custom_message';
  id: string;
  parentId: string | null;
  timestamp: string;
  customType?: string;
  content: RawMessageContent;
  details?: unknown;
  display?: boolean;
}

interface RawCompaction {
  type: 'compaction';
  id: string;
  parentId: string | null;
  timestamp: string | number;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
}

interface RawBranchSummary {
  type: 'branch_summary';
  id: string;
  parentId: string | null;
  timestamp: string | number;
  summary: string;
  fromId: string;
}

type RawLine = RawSessionRecord | RawModelChange | RawSessionInfo | RawMessage | RawCustomMessage | RawCompaction | RawBranchSummary | { type: string };
type PiSessionTreeNode = ReturnType<SessionManager['getTree']>[number];

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
  lastActivityAt?: string;
  parentSessionFile?: string;
  parentSessionId?: string;
  sourceRunId?: string;
}

export interface SessionDetail {
  meta: SessionMeta;
  blocks: DisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  contextUsage: SessionContextUsageSnapshot | null;
}

export interface ConversationTreeNode {
  id: string;
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'summary' | 'error' | 'custom';
  label: string;
  preview: string;
  ts: string;
  blockIndex: number | null;
  active: boolean;
  onActivePath: boolean;
  children: ConversationTreeNode[];
}

export interface ConversationTreeSnapshot {
  leafId: string | null;
  roots: ConversationTreeNode[];
}

interface DisplayImage {
  alt: string;
  src?: string;
  mimeType?: string;
  caption?: string;
  deferred?: boolean;
}

export type DisplayBlock =
  | { type: 'user';     id: string; ts: string; text: string; images?: DisplayImage[] }
  | { type: 'text';     id: string; ts: string; text: string }
  | { type: 'context';  id: string; ts: string; text: string; customType?: string }
  | { type: 'summary';  id: string; ts: string; kind: 'compaction' | 'branch'; title: string; text: string }
  | { type: 'thinking'; id: string; ts: string; text: string }
  | { type: 'tool_use'; id: string; ts: string; tool: string; input: Record<string, unknown>; output: string; durationMs?: number; toolCallId: string; details?: unknown; outputDeferred?: boolean }
  | { type: 'image';    id: string; ts: string; alt: string; src?: string; mimeType?: string; width?: number; height?: number; caption?: string; deferred?: boolean }
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
  if (process.env.PA_SESSIONS_INDEX_FILE) {
    return process.env.PA_SESSIONS_INDEX_FILE;
  }

  if (process.env.PA_SESSIONS_DIR) {
    return join(dirname(process.env.PA_SESSIONS_DIR), 'session-meta-index.json');
  }

  return DEFAULT_SESSIONS_INDEX_FILE;
}

function parseJsonLine(rawLine: string): RawLine | null {
  try {
    return JSON.parse(rawLine) as RawLine;
  } catch {
    return null;
  }
}

export interface DisplayMessageEntryLike {
  id: string;
  timestamp: string | number;
  message: {
    role: string;
    content?: unknown;
    toolCallId?: string;
    toolName?: string;
    details?: unknown;
    stopReason?: string;
    errorMessage?: string;
    summary?: string;
    tokensBefore?: number;
    fromId?: string;
    customType?: string;
    display?: boolean;
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
      alt: typeof block.name === 'string' && block.name.trim().length > 0
        ? `Attached image: ${block.name.trim()}`
        : 'Attached image',
      src: imageSrc(block),
      mimeType: imageMimeType(block),
      ...(typeof block.name === 'string' && block.name.trim().length > 0
        ? { caption: block.name.trim() }
        : {}),
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

function isInjectedContextMessage(message: DisplayMessageEntryLike['message']): boolean {
  return message.role === 'custom' && message.display === true && message.customType === 'referenced_context';
}

function normalizeSearchSegment(text: string, maxLength = 360): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : normalized;
}

function buildSessionSearchText(entries: SessionEntry[], maxCharacters: number): string {
  const segments: string[] = [];
  let remaining = Math.max(0, maxCharacters);

  for (const entry of entries) {
    if (remaining <= 0) {
      break;
    }

    if (entry.type !== 'message') {
      continue;
    }

    let segment = '';
    if (entry.message.role === 'user') {
      segment = extractUserContent(entry.message.content).text;
    } else if (entry.message.role === 'assistant') {
      segment = normalizeContent(entry.message.content)
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n');
    }

    const normalizedSegment = normalizeSearchSegment(segment);
    if (!normalizedSegment) {
      continue;
    }

    const limitedSegment = normalizedSegment.length > remaining
      ? `${normalizedSegment.slice(0, Math.max(0, remaining - 1)).trimEnd()}…`
      : normalizedSegment;

    if (!limitedSegment) {
      continue;
    }

    segments.push(limitedSegment);
    remaining -= limitedSegment.length + 1;
  }

  return segments.join('\n');
}

function summarizeTreeText(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : normalized;
}

function summarizeToolCallArguments(argumentsValue: Record<string, unknown> | undefined): string {
  if (!argumentsValue) {
    return '';
  }

  const command = typeof argumentsValue.command === 'string' ? argumentsValue.command.trim() : '';
  if (command) {
    return summarizeTreeText(command, 100);
  }

  const path = typeof argumentsValue.path === 'string' ? argumentsValue.path.trim() : '';
  if (path) {
    return summarizeTreeText(path, 100);
  }

  const url = typeof argumentsValue.url === 'string' ? argumentsValue.url.trim() : '';
  if (url) {
    return summarizeTreeText(url, 100);
  }

  return summarizeTreeText(JSON.stringify(argumentsValue), 100);
}

function describeConversationTreeMessage(entry: SessionEntry): Omit<ConversationTreeNode, 'blockIndex' | 'active' | 'onActivePath' | 'children'> | null {
  if (entry.type === 'compaction') {
    return {
      id: entry.id,
      kind: 'summary',
      label: 'compact',
      preview: summarizeTreeText(entry.summary, 110) || 'Compaction summary',
      ts: normalizeTimestamp(entry.timestamp),
    };
  }

  if (entry.type === 'branch_summary') {
    return {
      id: entry.id,
      kind: 'summary',
      label: 'branch',
      preview: summarizeTreeText(entry.summary, 110) || 'Branch summary',
      ts: normalizeTimestamp(entry.timestamp),
    };
  }

  if (entry.type !== 'message') {
    return null;
  }

  if (entry.message.role === 'user') {
    const { text, images } = extractUserContent(entry.message.content);
    const attachmentPreview = images.length > 0
      ? images.length === 1
        ? '1 image attachment'
        : `${images.length} image attachments`
      : '';
    const preview = summarizeTreeText(text, 120);

    return {
      id: entry.id,
      kind: 'user',
      label: 'user',
      preview: preview
        ? attachmentPreview ? `${preview} · ${attachmentPreview}` : preview
        : attachmentPreview || '(empty message)',
      ts: normalizeTimestamp(entry.timestamp),
    };
  }

  if (entry.message.role === 'assistant') {
    const contentBlocks = normalizeContent(entry.message.content);
    const textBlock = contentBlocks.find((block) => block.type === 'text' && block.text?.trim());
    if (textBlock?.text) {
      return {
        id: entry.id,
        kind: 'assistant',
        label: 'asst',
        preview: summarizeTreeText(textBlock.text, 120) || '(assistant message)',
        ts: normalizeTimestamp(entry.timestamp),
      };
    }

    const toolBlock = contentBlocks.find((block) => block.type === 'toolCall');
    if (toolBlock) {
      return {
        id: entry.id,
        kind: 'tool',
        label: toolBlock.name?.trim() || 'tool',
        preview: summarizeToolCallArguments(toolBlock.arguments) || '(tool call)',
        ts: normalizeTimestamp(entry.timestamp),
      };
    }

    const thinkingBlock = contentBlocks.find((block) => block.type === 'thinking' && block.thinking?.trim());
    if (thinkingBlock?.thinking) {
      return {
        id: entry.id,
        kind: 'thinking',
        label: 'think',
        preview: summarizeTreeText(thinkingBlock.thinking, 110) || '(thinking)',
        ts: normalizeTimestamp(entry.timestamp),
      };
    }

    const errorMessage = getAssistantErrorDisplayMessage(entry.message);
    if (errorMessage) {
      return {
        id: entry.id,
        kind: 'error',
        label: 'error',
        preview: summarizeTreeText(errorMessage, 110) || 'Assistant error',
        ts: normalizeTimestamp(entry.timestamp),
      };
    }

    return {
      id: entry.id,
      kind: 'assistant',
      label: 'asst',
      preview: '(assistant message)',
      ts: normalizeTimestamp(entry.timestamp),
    };
  }

  return null;
}

function buildDisplayBlocksInternal(
  messages: DisplayMessageEntryLike[],
  entryAnchorIndexById?: Map<string, number>,
): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  const toolCallIndex = new Map<string, number>();

  for (const [messageIndex, msg] of messages.entries()) {
    const { role, content, toolCallId, toolName, details, summary } = msg.message;
    const ts = normalizeTimestamp(msg.timestamp);
    const contentBlocks = normalizeContent(content);
    const errorMessage = getAssistantErrorDisplayMessage(msg.message);
    const baseId = msg.id || `msg-${messageIndex}`;
    let anchorRecorded = false;

    const recordAnchor = () => {
      if (!entryAnchorIndexById || anchorRecorded) {
        return;
      }
      entryAnchorIndexById.set(baseId, blocks.length);
      anchorRecorded = true;
    };

    if (role === 'compactionSummary' || role === 'branchSummary') {
      const normalizedSummary = summary?.trim();
      if (normalizedSummary) {
        recordAnchor();
        blocks.push({
          type: 'summary',
          id: baseId,
          ts,
          kind: role === 'compactionSummary' ? 'compaction' : 'branch',
          title: role === 'compactionSummary' ? 'Compaction summary' : 'Branch summary',
          text: normalizedSummary,
        });
      }
      continue;
    }

    if (role === 'user') {
      const { text, images } = extractUserContent(content);
      if (text || images.length > 0) {
        recordAnchor();
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

    if (isInjectedContextMessage(msg.message)) {
      for (const block of contentBlocks) {
        if (block.type === 'text' && block.text?.trim()) {
          recordAnchor();
          blocks.push({
            type: 'context',
            id: `${baseId}-m${blocks.length}`,
            ts,
            text: block.text,
            ...(msg.message.customType ? { customType: msg.message.customType } : {}),
          });
          continue;
        }

        if (block.type === 'image') {
          const src = imageSrc(block);
          const mimeType = imageMimeType(block);
          if (!src || !mimeType) {
            continue;
          }

          recordAnchor();
          blocks.push({
            type: 'image',
            id: `${baseId}-i${blocks.length}`,
            ts,
            alt: 'Injected context image',
            src,
            mimeType,
            ...(typeof block.name === 'string' && block.name.trim().length > 0
              ? { caption: block.name.trim() }
              : {}),
          });
        }
      }
      continue;
    }

    if (role === 'custom' && msg.message.display === false) {
      continue;
    }

    if (role === 'assistant' || role === 'custom') {
      for (const block of contentBlocks) {
        if (role === 'assistant' && block.type === 'thinking' && block.thinking?.trim()) {
          recordAnchor();
          blocks.push({ type: 'thinking', id: `${baseId}-t${blocks.length}`, ts, text: block.thinking });
          continue;
        }

        if (block.type === 'text' && block.text?.trim()) {
          recordAnchor();
          blocks.push({ type: 'text', id: `${baseId}-x${blocks.length}`, ts, text: block.text });
          continue;
        }

        if (role === 'assistant' && block.type === 'toolCall' && block.id) {
          recordAnchor();
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

      if (role === 'assistant' && errorMessage) {
        recordAnchor();
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

export function buildDisplayBlocksFromEntries(messages: DisplayMessageEntryLike[]): DisplayBlock[] {
  return buildDisplayBlocksInternal(messages);
}

function buildDisplayBlocksWithEntryAnchors(messages: DisplayMessageEntryLike[]): {
  blocks: DisplayBlock[];
  entryAnchorIndexById: Map<string, number>;
} {
  const entryAnchorIndexById = new Map<string, number>();
  const blocks = buildDisplayBlocksInternal(messages, entryAnchorIndexById);
  return { blocks, entryAnchorIndexById };
}

function buildSessionUserImagePath(sessionId: string, blockId: string, imageIndex: number): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/blocks/${encodeURIComponent(blockId)}/images/${imageIndex}`;
}

function buildSessionBlockImagePath(sessionId: string, blockId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/blocks/${encodeURIComponent(blockId)}/image`;
}

function decorateSessionAssetUrls(blocks: DisplayBlock[], sessionId: string): DisplayBlock[] {
  return blocks.map((block) => {
    if (block.type === 'user' && block.images?.length) {
      return {
        ...block,
        images: block.images.map((image, imageIndex) => ({
          ...image,
          src: buildSessionUserImagePath(sessionId, block.id, imageIndex),
        })),
      };
    }

    if (block.type === 'image') {
      return {
        ...block,
        src: buildSessionBlockImagePath(sessionId, block.id),
      };
    }

    return block;
  });
}

const RECENT_HEAVY_CONTENT_BLOCK_COUNT = 80;
const DEFERRED_TOOL_OUTPUT_PREVIEW_LENGTH = 600;

function buildDeferredToolOutputPreview(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length <= DEFERRED_TOOL_OUTPUT_PREVIEW_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, DEFERRED_TOOL_OUTPUT_PREVIEW_LENGTH - 1)).trimEnd()}…`;
}

function deferHeavyBlockContent(blocks: DisplayBlock[], blockOffset: number, totalBlocks: number): DisplayBlock[] {
  return blocks.map((block, index) => {
    const absoluteIndex = blockOffset + index;
    if (absoluteIndex >= Math.max(0, totalBlocks - RECENT_HEAVY_CONTENT_BLOCK_COUNT)) {
      return block;
    }

    if (block.type === 'user' && block.images?.some((image) => image.src)) {
      return {
        ...block,
        images: block.images.map((image) => image.src ? { ...image, src: undefined, deferred: true } : image),
      };
    }

    if (block.type === 'tool_use' && block.output.trim().length > DEFERRED_TOOL_OUTPUT_PREVIEW_LENGTH) {
      return {
        ...block,
        output: buildDeferredToolOutputPreview(block.output),
        outputDeferred: true,
      };
    }

    if (block.type === 'image' && block.src) {
      return {
        ...block,
        src: undefined,
        deferred: true,
      };
    }

    return block;
  });
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

function buildSessionInfoRecord(name: string): string {
  return JSON.stringify({
    type: 'session_info',
    timestamp: new Date().toISOString(),
    name,
  });
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

function normalizeOptionalPath(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function readSourceRunIdFromSessionFilePath(filePath: string): string | undefined {
  const sessionsDir = resolveSessionsDir();
  const relativePath = relative(sessionsDir, filePath).replace(/\\/g, '/');
  const segments = relativePath.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 3 || segments[0] !== '__runs') {
    return undefined;
  }

  return segments[1];
}

function decorateSessionParentIds(metas: SessionMeta[]): SessionMeta[] {
  const sessionIdByFile = new Map(metas.map((meta) => [meta.file, meta.id] as const));

  return metas.map((meta) => {
    const parentSessionFile = normalizeOptionalPath(meta.parentSessionFile);
    const parentSessionId = parentSessionFile ? sessionIdByFile.get(parentSessionFile) : undefined;

    if (meta.parentSessionFile === parentSessionFile && meta.parentSessionId === parentSessionId) {
      return meta;
    }

    return {
      ...meta,
      ...(parentSessionFile ? { parentSessionFile } : {}),
      ...(parentSessionId ? { parentSessionId } : {}),
    };
  });
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

    if (line.type === 'custom_message') {
      if ((line as RawCustomMessage).display) {
        messageCount += 1;
      }
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

  const parentSessionFile = normalizeOptionalPath(sessionRecord.parentSession);
  const sourceRunId = readSourceRunIdFromSessionFilePath(filePath);

  return {
    id: sessionRecord.id,
    file: filePath,
    timestamp: sessionRecord.timestamp,
    cwd: sessionRecord.cwd ?? slugToCwd(cwdSlug),
    cwdSlug,
    model,
    title: (sawSessionInfo ? namedTitle : null) ?? fallbackTitle ?? 'New Conversation',
    messageCount,
    ...(parentSessionFile ? { parentSessionFile } : {}),
    ...(sourceRunId ? { sourceRunId } : {}),
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
  const pendingDirs = [sessionsDir];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop() as string;
    let entryNames: string[];

    try {
      entryNames = readdirSync(currentDir);
    } catch {
      continue;
    }

    for (const entryName of entryNames) {
      const entryPath = join(currentDir, entryName);

      try {
        const stats = statSync(entryPath);
        if (stats.isFile()) {
          if (entryName.endsWith('.jsonl')) {
            files.push({ filePath: entryPath, cwdSlug: resolveSessionFileCwdSlug(entryPath) });
          }
          continue;
        }

        if (stats.isDirectory()) {
          pendingDirs.push(entryPath);
        }
      } catch {
        continue;
      }
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
  const decoratedMetas = decorateSessionParentIds(metas);
  persistSessionIndex();
  return decoratedMetas;
}

function resolveSessionMeta(sessionId: string): SessionMeta | null {
  ensurePersistentIndexLoaded();

  const cachedFilePath = sessionFileById.get(sessionId);
  if (cachedFilePath) {
    const cachedMeta = readSessionMetaByFile(cachedFilePath);
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

export function buildDisplayMessageEntriesFromSessionEntries(entries: SessionEntry[]): DisplayMessageEntryLike[] {
  const displayEntries: DisplayMessageEntryLike[] = [];

  for (const entry of entries) {
    if (entry.type === 'message') {
      displayEntries.push({
        id: entry.id,
        timestamp: entry.timestamp,
        message: entry.message,
      });
      continue;
    }

    if (entry.type === 'custom_message') {
      const customMessage: DisplayMessageEntryLike['message'] = {
        role: 'custom',
        content: entry.content,
        details: entry.details,
        customType: entry.customType,
        display: entry.display,
      };

      displayEntries.push({
        id: entry.id,
        timestamp: entry.timestamp,
        message: customMessage,
      });
      continue;
    }

    if (entry.type === 'compaction') {
      displayEntries.push({
        id: entry.id,
        timestamp: entry.timestamp,
        message: {
          role: 'compactionSummary',
          summary: entry.summary,
          tokensBefore: entry.tokensBefore,
        },
      });
      continue;
    }

    if (entry.type === 'branch_summary') {
      displayEntries.push({
        id: entry.id,
        timestamp: entry.timestamp,
        message: {
          role: 'branchSummary',
          summary: entry.summary,
          fromId: entry.fromId,
        },
      });
    }
  }

  return displayEntries;
}

function buildConversationTreeNodes(
  nodes: PiSessionTreeNode[],
  context: {
    leafId: string | null;
    activePathIds: Set<string>;
    entryAnchorIndexById: Map<string, number>;
  },
): ConversationTreeNode[] {
  const visibleNodes: ConversationTreeNode[] = [];

  for (const node of nodes) {
    const children = buildConversationTreeNodes(node.children, context);
    const described = describeConversationTreeMessage(node.entry);

    if (!described) {
      visibleNodes.push(...children);
      continue;
    }

    visibleNodes.push({
      ...described,
      blockIndex: context.activePathIds.has(node.entry.id)
        ? context.entryAnchorIndexById.get(node.entry.id) ?? null
        : null,
      active: context.leafId === node.entry.id,
      onActivePath: context.activePathIds.has(node.entry.id),
      children,
    });
  }

  return visibleNodes;
}

function buildConversationTreeSnapshotFromFile(filePath: string): ConversationTreeSnapshot {
  const manager = SessionManager.open(filePath);
  const branchEntries = manager.getBranch();
  const leafId = manager.getLeafId();
  const displayEntries = buildDisplayMessageEntriesFromSessionEntries(branchEntries);
  const { entryAnchorIndexById } = buildDisplayBlocksWithEntryAnchors(displayEntries);
  const activePathIds = new Set(branchEntries.map((entry) => entry.id));

  return {
    leafId,
    roots: buildConversationTreeNodes(manager.getTree(), {
      leafId,
      activePathIds,
      entryAnchorIndexById,
    }),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function listSessions(): SessionMeta[] {
  return scanSessionMetas();
}

export function readSessionSearchText(sessionId: string, maxCharacters = 12_000): string | null {
  const meta = resolveSessionMeta(sessionId);
  if (!meta) {
    return null;
  }

  try {
    const manager = SessionManager.open(meta.file);
    return buildSessionSearchText(manager.getBranch(), maxCharacters);
  } catch {
    return null;
  }
}

export function readSessionMetaByFile(filePath: string): SessionMeta | null {
  const meta = readCachedSessionMeta(filePath, resolveSessionFileCwdSlug(filePath));
  if (!meta) {
    return null;
  }

  const parentSessionFile = normalizeOptionalPath(meta.parentSessionFile);
  const parentSessionId = parentSessionFile ? sessionFileById.get(parentSessionFile) : undefined;
  if (meta.parentSessionFile === parentSessionFile && meta.parentSessionId === parentSessionId) {
    return meta;
  }

  return {
    ...meta,
    ...(parentSessionFile ? { parentSessionFile } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
  };
}

export function renameStoredSession(sessionId: string, name: string): SessionMeta {
  const normalizedName = normalizeSessionName(name);
  if (!normalizedName) {
    throw new Error('Conversation title must not be empty.');
  }

  const meta = resolveSessionMeta(sessionId);
  if (!meta) {
    throw new Error(`Conversation ${sessionId} not found.`);
  }

  appendFileSync(meta.file, `${buildSessionInfoRecord(normalizedName)}\n`);

  const updatedMeta = readSessionMetaByFile(meta.file);
  if (!updatedMeta) {
    throw new Error(`Conversation ${sessionId} could not be reloaded after renaming.`);
  }

  persistSessionIndex();
  return updatedMeta;
}

function resolveTailBlockLimit(tailBlocks: number | undefined, totalBlocks: number): number | null {
  if (!Number.isInteger(tailBlocks) || typeof tailBlocks !== 'number' || tailBlocks <= 0) {
    return null;
  }

  return Math.min(tailBlocks, totalBlocks);
}

export function readSessionBlocksByFile(filePath: string, options?: { tailBlocks?: number }): SessionDetail | null {
  const meta = readCachedSessionMeta(filePath, resolveSessionFileCwdSlug(filePath));
  if (!meta) return null;

  const manager = SessionManager.open(meta.file);
  const branchEntries = buildDisplayMessageEntriesFromSessionEntries(manager.getBranch());
  const allBlocks = decorateSessionAssetUrls(buildDisplayBlocksFromEntries(branchEntries), meta.id);
  const totalBlocks = allBlocks.length;
  const tailBlockLimit = resolveTailBlockLimit(options?.tailBlocks, totalBlocks);
  const blockOffset = tailBlockLimit === null ? 0 : Math.max(0, totalBlocks - tailBlockLimit);
  const slicedBlocks = blockOffset > 0 ? allBlocks.slice(blockOffset) : allBlocks;
  const blocks = blockOffset > 0
    ? deferHeavyBlockContent(slicedBlocks, blockOffset, totalBlocks)
    : slicedBlocks;

  return {
    meta,
    blocks,
    blockOffset,
    totalBlocks,
    contextUsage: readSessionContextUsageFromEntries(manager.getEntries()),
  };
}

export function readSessionBlocks(sessionId: string, options?: { tailBlocks?: number }): SessionDetail | null {
  const meta = resolveSessionMeta(sessionId);
  return meta ? readSessionBlocksByFile(meta.file, options) : null;
}

export function readSessionBlock(sessionId: string, blockId: string): DisplayBlock | null {
  const meta = resolveSessionMeta(sessionId);
  if (!meta) {
    return null;
  }

  const manager = SessionManager.open(meta.file);
  const branchEntries = buildDisplayMessageEntriesFromSessionEntries(manager.getBranch());
  const blocks = decorateSessionAssetUrls(buildDisplayBlocksFromEntries(branchEntries), sessionId);
  return blocks.find((block) => block.id === blockId) ?? null;
}

function buildSessionImageAsset(block: RawContentBlock): { mimeType: string; data: Buffer; fileName?: string } | null {
  const mimeType = imageMimeType(block);
  if (!mimeType || !block.data) {
    return null;
  }

  return {
    mimeType,
    data: Buffer.from(block.data, 'base64'),
    fileName: typeof block.name === 'string' && block.name.trim().length > 0 ? block.name.trim() : undefined,
  };
}

export function readSessionImageAsset(
  sessionId: string,
  blockId: string,
  imageIndex?: number,
): { mimeType: string; data: Buffer; fileName?: string } | null {
  const meta = resolveSessionMeta(sessionId);
  if (!meta) {
    return null;
  }

  const manager = SessionManager.open(meta.file);
  for (const entry of manager.getBranch()) {
    if (entry.type !== 'message') {
      continue;
    }

    const contentBlocks = normalizeContent('content' in entry.message ? entry.message.content : undefined);
    if (entry.message.role === 'user' && entry.id === blockId) {
      if (!Number.isInteger(imageIndex) || typeof imageIndex !== 'number' || imageIndex < 0) {
        return null;
      }

      const images = contentBlocks.filter((block) => block.type === 'image');
      const image = images[imageIndex];
      return image ? buildSessionImageAsset(image) : null;
    }

    if (entry.message.role !== 'toolResult') {
      continue;
    }

    const images = contentBlocks.filter((block) => block.type === 'image');
    for (const [candidateIndex, image] of images.entries()) {
      if (`${entry.id}-i${candidateIndex}` !== blockId) {
        continue;
      }

      return buildSessionImageAsset(image);
    }
  }

  return null;
}

export function readSessionTreeByFile(filePath: string): ConversationTreeSnapshot | null {
  const meta = readCachedSessionMeta(filePath, resolveSessionFileCwdSlug(filePath));
  if (!meta) {
    return null;
  }

  return buildConversationTreeSnapshotFromFile(meta.file);
}

export function readSessionTree(sessionId: string): ConversationTreeSnapshot | null {
  const meta = resolveSessionMeta(sessionId);
  return meta ? readSessionTreeByFile(meta.file) : null;
}
