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

import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

import { type SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent';
import { getDurableSessionsDir, getPiAgentRuntimeDir } from '@personal-agent/core';

import { persistAppTelemetryEvent } from '../traces/appTelemetry.js';
import { readSessionContextUsageFromEntries, type SessionContextUsageSnapshot } from './sessionContextUsage.js';
import { normalizeTranscriptToolName } from './toolNames.js';

const DEFAULT_SESSIONS_DIR = getDurableSessionsDir();
export const SESSIONS_DIR = DEFAULT_SESSIONS_DIR;
const DEFAULT_SESSIONS_INDEX_FILE = join(getPiAgentRuntimeDir(), 'session-meta-index.json');
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
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  provider?: string;
  modelId?: string;
}

interface RawThinkingLevelChange {
  type: 'thinking_level_change';
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  thinkingLevel?: string;
}

interface RawSessionInfo {
  type: 'session_info';
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  name?: string;
}

interface RawCustomEntry {
  type: 'custom';
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  customType?: string;
  data?: unknown;
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
  details?: unknown;
}

interface RawBranchSummary {
  type: 'branch_summary';
  id: string;
  parentId: string | null;
  timestamp: string | number;
  summary: string;
  fromId: string;
}

type RawLine =
  | RawSessionRecord
  | RawModelChange
  | RawThinkingLevelChange
  | RawSessionInfo
  | RawCustomEntry
  | RawMessage
  | RawCustomMessage
  | RawCompaction
  | RawBranchSummary;
type RawDisplayLine = RawMessage | RawCustomMessage | RawCompaction | RawBranchSummary;

interface TailScanDisplayEntrySummary {
  kind: 'display';
  id: string;
  parentId: string | null;
  visibleBlockCount: number;
  hiddenRoot: boolean;
  displayEntry: DisplayMessageEntryLike;
}

interface TailScanLineageSummary {
  kind: 'lineage';
  id: string;
  parentId: string | null;
}

type TailScanEntrySummary = TailScanDisplayEntrySummary | TailScanLineageSummary;

// ── Public types ───────────────────────────────────────────────────────────────

export interface SessionMeta {
  id: string;
  file: string; // absolute path
  timestamp: string;
  cwd: string;
  workspaceCwd?: string | null;
  cwdSlug: string; // directory name without leading/trailing --
  model: string;
  title: string; // session display name or derived fallback title
  messageCount: number;
  isRunning?: boolean;
  isLive?: boolean;
  lastActivityAt?: string;
  parentSessionFile?: string;
  parentSessionId?: string;
  sourceRunId?: string;
}

export const CONVERSATION_WORKSPACE_METADATA_CUSTOM_TYPE = 'personal_agent_conversation_workspace';
export const CONVERSATION_WORKSPACE_CHANGE_CUSTOM_TYPE = 'conversation_workspace_change';

interface ConversationWorkspaceMetadata {
  cwd?: string;
  workspaceCwd?: string | null;
}

interface LegacyToolWorkspaceMetadata {
  cwd: string;
  workspaceCwd: string;
}

export interface SessionDetail {
  meta: SessionMeta;
  blocks: DisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  contextUsage: SessionContextUsageSnapshot | null;
  signature?: string;
}

export interface SessionDetailAppendOnlyResponse {
  appendOnly: true;
  meta: SessionMeta;
  blocks: DisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  contextUsage: SessionContextUsageSnapshot | null;
  signature: string | null;
}

export interface SessionDetailReadTelemetry {
  cache: 'hit' | 'miss';
  loader: 'fast-tail' | 'full';
  durationMs: number;
  requestedTailBlocks?: number;
  totalBlocks: number;
  blockOffset: number;
  contextUsageIncluded: boolean;
  /** True when a cache miss was caused by file modification (not just append). */
  modificationDetected?: boolean;
}

interface DisplayImage {
  alt: string;
  src?: string;
  mimeType?: string;
  caption?: string;
  deferred?: boolean;
}

export type DisplayBlock =
  | { type: 'user'; id: string; ts: string; text: string; images?: DisplayImage[] }
  | { type: 'text'; id: string; ts: string; text: string }
  | { type: 'context'; id: string; ts: string; text: string; customType?: string }
  | { type: 'summary'; id: string; ts: string; kind: 'compaction' | 'branch' | 'related'; title: string; text: string; detail?: string }
  | { type: 'thinking'; id: string; ts: string; text: string }
  | {
      type: 'tool_use';
      id: string;
      ts: string;
      tool: string;
      input: Record<string, unknown>;
      output: string;
      durationMs?: number;
      toolCallId: string;
      details?: unknown;
      outputDeferred?: boolean;
    }
  | {
      type: 'image';
      id: string;
      ts: string;
      alt: string;
      src?: string;
      mimeType?: string;
      width?: number;
      height?: number;
      caption?: string;
      deferred?: boolean;
    }
  | { type: 'error'; id: string; ts: string; tool?: string; message: string };

interface CachedSessionMeta {
  signature: string;
  meta: SessionMeta;
}

interface CachedSessionDetail {
  signature: string;
  contentHash: string;
  detail: SessionDetail;
}

interface CachedSessionSearchText {
  signature: string;
  text: string;
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

const MAX_SESSION_META_CACHE_ENTRIES = 500;
const MAX_SESSION_SEARCH_TEXT_CACHE_ENTRIES = 500;

/**
 * Simple LRU map that evicts the oldest entry when `maxSize` is exceeded.
 * Uses insertion-order semantics of Map — get() re-inserts to mark as recently used.
 */
class LRUMap<K, V> extends Map<K, V> {
  constructor(private readonly maxSize: number) {
    super();
  }

  get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      // Promote to most-recently-used by re-inserting
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): this {
    if (super.has(key)) {
      super.delete(key);
    }
    super.set(key, value);
    if (this.size > this.maxSize) {
      const firstKey = this.keys().next().value;
      if (firstKey !== undefined) {
        super.delete(firstKey);
      }
    }
    return this;
  }
}

const sessionMetaCache = new LRUMap<string, CachedSessionMeta>(MAX_SESSION_META_CACHE_ENTRIES);
const sessionDetailCache = new Map<string, CachedSessionDetail>();
const sessionSearchTextCache = new LRUMap<string, CachedSessionSearchText>(MAX_SESSION_SEARCH_TEXT_CACHE_ENTRIES);
let sessionFileById = new Map<string, string>();
let loadedPersistentIndexKey: string | null = null;
let persistedIndexJson: string | null = null;

const MAX_SESSION_DETAIL_CACHE_ENTRIES = 24;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/;

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

function isRawDisplayLine(line: RawLine): line is RawDisplayLine {
  return line.type === 'message' || line.type === 'custom_message' || line.type === 'compaction' || line.type === 'branch_summary';
}

const SESSION_SUMMARY_SANITIZE_PATTERN = /"(content|data|text|thinking|summary|errorMessage)":"((?:\\.|[^"\\])*)"/g;
const SESSION_SEARCH_SANITIZE_PATTERN = /"(data|thinking)":"((?:\\.|[^"\\])*)"/g;
const REVERSE_READ_CHUNK_BYTES = 64 * 1024;

function sanitizeSessionLineForSummary(rawLine: string): string {
  return rawLine.replace(SESSION_SUMMARY_SANITIZE_PATTERN, (_match, field: string, value: string) => {
    if (field === 'data') {
      return `"${field}":""`;
    }

    return `"${field}":"${value.length > 0 ? 'x' : ''}"`;
  });
}

function sanitizeSessionLineForSearch(rawLine: string): string {
  return rawLine.replace(SESSION_SEARCH_SANITIZE_PATTERN, (_match, field: string) => `"${field}":""`);
}

function readFileLinesReverse(filePath: string, visit: (line: string) => boolean | void): void {
  const stats = statSync(filePath);
  if (stats.size <= 0) {
    return;
  }

  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(REVERSE_READ_CHUNK_BYTES);
  let position = stats.size;
  let remainder = '';

  try {
    while (position > 0) {
      const readLength = Math.min(REVERSE_READ_CHUNK_BYTES, position);
      position -= readLength;
      readSync(fd, buffer, 0, readLength, position);
      const chunk = buffer.toString('utf-8', 0, readLength);
      const combined = chunk + remainder;
      const lines = combined.split('\n');
      remainder = lines.shift() ?? '';

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (visit(lines[index]?.replace(/\r$/, '') ?? '') === false) {
          return;
        }
      }
    }

    if (remainder.length > 0) {
      visit(remainder.replace(/\r$/, ''));
    }
  } finally {
    closeSync(fd);
  }
}

function buildDisplayMessageEntryFromRawLine(line: RawDisplayLine): DisplayMessageEntryLike {
  if (line.type === 'message') {
    return {
      id: line.id,
      parentId: line.parentId,
      timestamp: line.timestamp,
      message: line.message,
    };
  }

  if (line.type === 'custom_message') {
    return {
      id: line.id,
      parentId: line.parentId,
      timestamp: line.timestamp,
      message: {
        role: 'custom',
        content: line.content,
        details: line.details,
        customType: line.customType,
        display: line.display,
      },
    };
  }

  if (line.type === 'compaction') {
    return {
      id: line.id,
      parentId: line.parentId,
      timestamp: line.timestamp,
      message: {
        role: 'compactionSummary',
        summary: line.summary,
        tokensBefore: line.tokensBefore,
        details: line.details,
      },
    };
  }

  return {
    id: line.id,
    parentId: line.parentId,
    timestamp: line.timestamp,
    message: {
      role: 'branchSummary',
      summary: line.summary,
      fromId: line.fromId,
    },
  };
}

function summarizeTailScanEntry(rawLine: string): TailScanEntrySummary | null {
  const sanitizedLine = sanitizeSessionLineForSummary(rawLine);
  const parsed = parseJsonLine(sanitizedLine) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const id = 'id' in parsed && typeof parsed.id === 'string' ? parsed.id : null;
  const parentId = 'parentId' in parsed && (typeof parsed.parentId === 'string' || parsed.parentId === null) ? parsed.parentId : undefined;

  if (!id || parentId === undefined) {
    return null;
  }

  if (!isRawDisplayLine(parsed as RawLine)) {
    return {
      kind: 'lineage',
      id,
      parentId,
    };
  }

  const displayEntry = buildDisplayMessageEntryFromRawLine(parsed as RawDisplayLine);
  const visibleBlockCount = buildDisplayBlocksFromEntries([displayEntry]).length;
  const hiddenRoot = shouldHideTranscriptDescendants(displayEntry.message);

  return {
    kind: 'display',
    id,
    parentId,
    visibleBlockCount,
    hiddenRoot,
    displayEntry,
  };
}

function tryReadSessionTailBlocksByFile(filePath: string, meta: SessionMeta, tailBlocks: number): SessionDetail | null {
  const branchDisplayEntries: TailScanDisplayEntrySummary[] = [];
  let pendingEntryId: string | null | undefined;

  try {
    readFileLinesReverse(filePath, (rawLine) => {
      if (!rawLine.trim()) {
        return;
      }

      const summary = summarizeTailScanEntry(rawLine);
      if (!summary) {
        return;
      }

      if (pendingEntryId === undefined) {
        pendingEntryId = summary.id;
      }

      if (summary.id !== pendingEntryId) {
        return;
      }

      pendingEntryId = summary.parentId;

      if (summary.kind === 'display') {
        branchDisplayEntries.push(summary);
      }

      return pendingEntryId !== null;
    });
  } catch {
    return null;
  }

  const chronologicalDisplayEntries = branchDisplayEntries.slice().reverse();
  const hiddenEntryIds = collectHiddenTranscriptEntryIds(chronologicalDisplayEntries.map((entry) => entry.displayEntry));
  const visibleEntries = chronologicalDisplayEntries.filter((entry) => !hiddenEntryIds.has(entry.id));
  const totalBlocks = visibleEntries.reduce((sum, entry) => sum + entry.visibleBlockCount, 0);
  const tailBlockLimit = Math.min(tailBlocks, totalBlocks);

  const retained: TailScanDisplayEntrySummary[] = [];
  let retainedVisibleBlockCount = 0;

  for (let index = visibleEntries.length - 1; index >= 0; index -= 1) {
    const entry = visibleEntries[index];
    if (!entry) {
      continue;
    }

    retained.unshift(entry);
    retainedVisibleBlockCount += entry.visibleBlockCount;

    if (retainedVisibleBlockCount >= tailBlockLimit) {
      break;
    }
  }

  const droppedVisibleBlockCount = Math.max(0, totalBlocks - retainedVisibleBlockCount);
  const retainedIds = new Set(retained.map((entry) => entry.id));
  const retainedRawLines = new Map<string, string>();

  try {
    readFileLinesReverse(filePath, (rawLine) => {
      if (!rawLine.trim()) {
        return retainedIds.size > 0;
      }

      const sanitizedLine = sanitizeSessionLineForSummary(rawLine);
      const parsed = parseJsonLine(sanitizedLine) as unknown;
      if (!parsed || typeof parsed !== 'object' || !('id' in parsed && typeof parsed.id === 'string')) {
        return retainedIds.size > 0;
      }

      const id = parsed.id;
      if (!retainedIds.has(id)) {
        return retainedIds.size > 0;
      }

      retainedRawLines.set(id, rawLine);
      retainedIds.delete(id);
      return retainedIds.size > 0;
    });
  } catch {
    return null;
  }

  const detailEntries = retained
    .map((entry) => retainedRawLines.get(entry.id))
    .filter((line): line is string => typeof line === 'string')
    .map((line) => parseJsonLine(line))
    .filter((entry): entry is RawDisplayLine => entry !== null && isRawDisplayLine(entry))
    .map((entry) => buildDisplayMessageEntryFromRawLine(entry));

  const rebasedBlocks = rebaseDisplayBlockIds(buildDisplayBlocksFromEntries(detailEntries), droppedVisibleBlockCount);
  const blocksWithAssets = decorateSessionAssetUrls(rebasedBlocks, meta.id);
  const blocks =
    droppedVisibleBlockCount > 0 ? deferHeavyBlockContent(blocksWithAssets, droppedVisibleBlockCount, totalBlocks) : blocksWithAssets;

  return {
    meta,
    blocks,
    blockOffset: droppedVisibleBlockCount,
    totalBlocks,
    contextUsage: null,
  };
}

export interface DisplayMessageEntryLike {
  id: string;
  parentId?: string | null;
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
    command?: string;
    output?: string;
    exitCode?: number;
    cancelled?: boolean;
    truncated?: boolean;
    fullOutputPath?: string;
    excludeFromContext?: boolean;
  };
}

function normalizeContent(content: unknown): RawContentBlock[] {
  if (Array.isArray(content)) return content as RawContentBlock[];
  if (typeof content === 'string' && content.length > 0) return [{ type: 'text', text: content }];
  return [];
}

function normalizeTimestamp(timestamp: string | number | undefined): string {
  if (typeof timestamp === 'string' && timestamp.trim()) {
    const normalized = timestamp.trim();
    const match = normalized.match(ISO_TIMESTAMP_PATTERN);
    const parsed = match && hasValidIsoDateParts(match) ? Date.parse(normalized) : Number.NaN;
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
  }
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
  }
  return new Date(0).toISOString();
}

function hasValidIsoDateParts(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millisecond
  );
}

function imageMimeType(block: RawContentBlock): string | undefined {
  const mimeType = block.mimeType ?? block.mediaType;
  if (typeof mimeType !== 'string') {
    return undefined;
  }

  const normalized = mimeType.trim();
  return normalized.toLowerCase().startsWith('image/') ? normalized : undefined;
}

function normalizeBase64ImageData(data: unknown): string | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }

  const normalized = data.trim();
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return undefined;
  }

  const decoded = Buffer.from(normalized, 'base64');
  return decoded.length > 0 ? normalized : undefined;
}

function imageSrc(block: RawContentBlock): string | undefined {
  const mimeType = imageMimeType(block);
  const data = normalizeBase64ImageData(block.data);
  if (!mimeType || !data) return undefined;
  return `data:${mimeType};base64,${data}`;
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
    .flatMap((block) => {
      const src = imageSrc(block);
      const mimeType = imageMimeType(block);
      if (!src || !mimeType) {
        return [];
      }

      return [
        {
          alt: typeof block.name === 'string' && block.name.trim().length > 0 ? `Attached image: ${block.name.trim()}` : 'Attached image',
          src,
          mimeType,
          ...(typeof block.name === 'string' && block.name.trim().length > 0 ? { caption: block.name.trim() } : {}),
        },
      ];
    });
  return { text, images };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveProviderCompactionLabel(details: unknown): string | undefined {
  if (!isRecord(details)) {
    return undefined;
  }

  const nativeDetails = isRecord(details.nativeCompaction) ? details.nativeCompaction : details;
  if (!isRecord(nativeDetails) || nativeDetails.provider !== 'openai-responses-compact') {
    return undefined;
  }

  const modelKey = typeof nativeDetails.modelKey === 'string' ? nativeDetails.modelKey.trim() : '';
  if (modelKey.startsWith('openai-codex:')) {
    return 'Codex compaction';
  }
  if (modelKey.startsWith('openai:')) {
    return 'OpenAI compaction';
  }

  return 'Provider compaction';
}

function resolveCompactionSummarySupplement(details: unknown): string | undefined {
  const label = resolveProviderCompactionLabel(details);
  return label ? `This used ${label} under the hood. Pi kept the text summary for display and portability.` : undefined;
}

export function getAssistantErrorDisplayMessage(message: { stopReason?: string; errorMessage?: string }): string | null {
  if (message.stopReason !== 'error') {
    return null;
  }

  const errorMessage = message.errorMessage?.trim();
  return errorMessage && errorMessage.length > 0 ? errorMessage : 'The model returned an error before completing its response.';
}

const RELATED_THREADS_CONTEXT_CUSTOM_TYPE = 'related_threads_context';
const RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE = 'related_conversation_pointers';
const GOAL_CONTINUATION_CUSTOM_TYPE = 'goal-continuation';

function isInjectedContextMessage(message: DisplayMessageEntryLike['message']): boolean {
  return (
    message.role === 'custom' &&
    (message.customType === 'referenced_context' ||
      message.customType === CONVERSATION_WORKSPACE_CHANGE_CUSTOM_TYPE ||
      message.customType === GOAL_CONTINUATION_CUSTOM_TYPE)
  );
}

function formatRelatedThreadsSummaryText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  const firstConversationIndex = normalized.search(/^Conversation\s+\d+\s+—\s+/m);
  const displayText = firstConversationIndex >= 0 ? normalized.slice(firstConversationIndex).trim() : normalized;

  return displayText
    .replace(/^Conversation\s+(\d+)\s+—\s+(.+)$/gm, '### Conversation $1 — $2')
    .replace(/^Workspace:\s*(.+)$/gm, '- Workspace: `$1`')
    .replace(/^Created:\s*(.+)$/gm, '- Created: $1');
}

function resolveRelatedThreadsSummaryDetail(text: string): string {
  const conversationCount = (text.match(/^#{0,3}\s*Conversation\s+\d+\s+—\s+/gm) ?? []).length;
  if (conversationCount <= 0) {
    return 'Selected conversations were summarized and injected before this prompt so this thread could start with reused context.';
  }

  return `${conversationCount} selected conversation${conversationCount === 1 ? '' : 's'} ${
    conversationCount === 1 ? 'was' : 'were'
  } summarized and injected before this prompt so this thread could start with reused context.`;
}

function formatRelatedConversationPointersText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function resolveRelatedConversationPointersDetail(text: string): string {
  const pointerCount = (text.match(/^\d+\.\s+/gm) ?? []).length;
  if (pointerCount <= 0) {
    return 'Related conversation pointers were offered before this prompt. Inspect a conversation before relying on its details.';
  }

  return `${pointerCount} related conversation pointer${pointerCount === 1 ? '' : 's'} ${
    pointerCount === 1 ? 'was' : 'were'
  } offered before this prompt. Inspect a conversation before relying on its details.`;
}

function normalizeSearchSegment(text: string, maxLength = 360): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : normalized;
}

function extractSearchTextFromMessage(message: { role: string; content?: unknown }): string {
  if (message.role === 'user') {
    return extractUserContent(message.content).text;
  }

  if (message.role !== 'assistant') {
    return '';
  }

  return normalizeContent(message.content)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

function appendSessionSearchSegment(segments: string[], segment: string, remaining: number): number {
  if (remaining <= 0) {
    return 0;
  }

  const normalizedSegment = normalizeSearchSegment(segment);
  if (!normalizedSegment) {
    return remaining;
  }

  const limitedSegment =
    normalizedSegment.length > remaining ? `${normalizedSegment.slice(0, Math.max(0, remaining - 1)).trimEnd()}…` : normalizedSegment;

  if (!limitedSegment) {
    return remaining;
  }

  segments.push(limitedSegment);
  return Math.max(0, remaining - limitedSegment.length - 1);
}

function buildSessionSearchText(entries: SessionEntry[], maxCharacters: number): string {
  const segments: string[] = [];
  let remaining = Math.max(0, maxCharacters);

  for (let index = entries.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.type !== 'message') {
      continue;
    }

    remaining = appendSessionSearchSegment(segments, extractSearchTextFromMessage(entry.message), remaining);
  }

  return segments.reverse().join('\n');
}

function shouldHideTranscriptDescendants(_message: DisplayMessageEntryLike['message']): boolean {
  // Transcript transparency rule: persisted transcript entries should remain visible in the chat.
  // Legacy hidden-turn markers may still exist in old session files, but the reader must not
  // hide them or their descendants.
  return false;
}

function collectHiddenTranscriptEntryIds(messages: DisplayMessageEntryLike[]): Set<string> {
  const hiddenRoots = new Set(messages.filter((message) => shouldHideTranscriptDescendants(message.message)).map((message) => message.id));
  if (hiddenRoots.size === 0) {
    return new Set();
  }

  const parentById = new Map(messages.map((message) => [message.id, message.parentId ?? null] as const));
  const messageById = new Map(messages.map((message) => [message.id, message.message] as const));
  const hiddenById = new Map<string, boolean>();

  const isHidden = (id: string | undefined): boolean => {
    if (!id) {
      return false;
    }
    if (hiddenById.has(id)) {
      return hiddenById.get(id) ?? false;
    }

    const message = messageById.get(id);
    if (message?.role === 'user') {
      hiddenById.set(id, false);
      return false;
    }

    if (hiddenRoots.has(id)) {
      hiddenById.set(id, true);
      return true;
    }

    const parentId = parentById.get(id) ?? null;
    const hidden = parentId ? isHidden(parentId) : false;
    hiddenById.set(id, hidden);
    return hidden;
  };

  return new Set(messages.filter((message) => isHidden(message.id)).map((message) => message.id));
}

function buildDisplayBlocksInternal(messages: DisplayMessageEntryLike[], entryAnchorIndexById?: Map<string, number>): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  const toolCallIndex = new Map<string, number>();
  const hiddenTranscriptEntryIds = collectHiddenTranscriptEntryIds(messages);

  for (const [messageIndex, msg] of messages.entries()) {
    const { role, content, toolCallId, toolName, details, summary } = msg.message;
    const ts = normalizeTimestamp(msg.timestamp);
    const contentBlocks = normalizeContent(content);
    const errorMessage = getAssistantErrorDisplayMessage(msg.message);
    const baseId = msg.id || `msg-${messageIndex}`;
    if (hiddenTranscriptEntryIds.has(baseId)) {
      continue;
    }
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
        const detail = role === 'compactionSummary' ? resolveCompactionSummarySupplement(details) : undefined;
        recordAnchor();
        blocks.push({
          type: 'summary',
          id: baseId,
          ts,
          kind: role === 'compactionSummary' ? 'compaction' : 'branch',
          title: role === 'compactionSummary' ? 'Compaction summary' : 'Branch summary',
          text: normalizedSummary,
          ...(detail ? { detail } : {}),
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

    if (role === 'custom' && msg.message.customType === RELATED_THREADS_CONTEXT_CUSTOM_TYPE) {
      const relatedSummaryText = formatRelatedThreadsSummaryText(
        contentBlocks
          .flatMap((block) =>
            block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0 ? [block.text.trim()] : [],
          )
          .join('\n\n'),
      );
      if (relatedSummaryText) {
        recordAnchor();
        blocks.push({
          type: 'summary',
          id: baseId,
          ts,
          kind: 'related',
          title: 'Reused thread summaries',
          text: relatedSummaryText,
          detail: resolveRelatedThreadsSummaryDetail(relatedSummaryText),
        });
      }
      continue;
    }

    if (role === 'custom' && msg.message.customType === RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE) {
      const pointerText = formatRelatedConversationPointersText(
        contentBlocks
          .flatMap((block) =>
            block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0 ? [block.text.trim()] : [],
          )
          .join('\n\n'),
      );
      if (pointerText) {
        recordAnchor();
        blocks.push({
          type: 'summary',
          id: baseId,
          ts,
          kind: 'related',
          title: 'Related conversation pointers',
          text: pointerText,
          detail: resolveRelatedConversationPointersDetail(pointerText),
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
            ...(typeof block.name === 'string' && block.name.trim().length > 0 ? { caption: block.name.trim() } : {}),
          });
        }
      }
      continue;
    }

    if (role === 'custom' && msg.message.display === false) {
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
            alt: 'Custom transcript image',
            src,
            mimeType,
            ...(typeof block.name === 'string' && block.name.trim().length > 0 ? { caption: block.name.trim() } : {}),
          });
        }
      }
      continue;
    }

    if (role === 'bashExecution') {
      const commandText = typeof msg.message.command === 'string' ? msg.message.command : '';
      const outputText = typeof msg.message.output === 'string' ? msg.message.output : '';
      const bashDetails = {
        displayMode: 'terminal',
        ...(typeof msg.message.exitCode === 'number' ? { exitCode: msg.message.exitCode } : {}),
        ...(msg.message.cancelled === true ? { cancelled: true } : {}),
        ...(msg.message.truncated === true ? { truncated: true } : {}),
        ...(typeof msg.message.fullOutputPath === 'string' && msg.message.fullOutputPath.trim().length > 0
          ? { fullOutputPath: msg.message.fullOutputPath }
          : {}),
        ...(msg.message.excludeFromContext === true ? { excludeFromContext: true } : {}),
      };

      recordAnchor();
      blocks.push({
        type: 'tool_use',
        id: `${baseId}-c${blocks.length}`,
        ts,
        tool: 'bash',
        input: { command: commandText },
        output: outputText.slice(0, 8000),
        toolCallId: baseId,
        ...(Object.keys(bashDetails).length > 0 ? { details: bashDetails } : {}),
      });
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
            tool: normalizeTranscriptToolName(block.name ?? 'unknown'),
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
      const resultText = contentBlocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
        .slice(0, 8000);

      if (idx !== undefined) {
        const existing = blocks[idx] as DisplayBlock & { type: 'tool_use' };
        const startMs = new Date(existing.ts).getTime();
        const endMs = new Date(ts).getTime();
        const duration = endMs > startMs ? endMs - startMs : undefined;
        blocks[idx] = { ...existing, output: resultText, durationMs: duration, details };
      } else if (resultText) {
        recordAnchor();
        blocks.push({
          type: 'tool_use',
          id: `${baseId}-c${blocks.length}`,
          ts,
          tool: normalizeTranscriptToolName(toolName ?? 'unknown'),
          input: {},
          output: resultText,
          toolCallId,
          ...(details ? { details } : {}),
        });
      }

      let resultImageIndex = 0;
      const resultImages = contentBlocks
        .filter((block) => block.type === 'image')
        .flatMap((block) => {
          const src = imageSrc(block);
          const mimeType = imageMimeType(block);
          if (!src || !mimeType) {
            return [];
          }

          const imageIndex = resultImageIndex;
          resultImageIndex += 1;
          return [
            {
              type: 'image' as const,
              id: `${baseId}-i${imageIndex}`,
              ts,
              alt: toolName ? `${toolName} image result` : 'Tool image result',
              src,
              mimeType,
              caption: toolName,
            },
          ];
        });
      blocks.push(...resultImages);
    }
  }

  return blocks;
}

export function buildDisplayBlocksFromEntries(messages: DisplayMessageEntryLike[]): DisplayBlock[] {
  return buildDisplayBlocksInternal(messages);
}

function buildSessionUserImagePath(sessionId: string, blockId: string, imageIndex: number): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/blocks/${encodeURIComponent(blockId)}/images/${imageIndex}`;
}

function rewriteIndexedBlockId(blockId: string, kind: 'm' | 't' | 'x' | 'c' | 'e' | 'i', absoluteIndex: number): string {
  return blockId.replace(new RegExp(`-${kind}\\d+$`), `-${kind}${absoluteIndex}`);
}

function rebaseDisplayBlockIds(blocks: DisplayBlock[], blockOffset: number): DisplayBlock[] {
  if (blockOffset <= 0) {
    return blocks;
  }

  return blocks.map((block, index) => {
    const absoluteIndex = blockOffset + index;

    switch (block.type) {
      case 'context':
        return { ...block, id: rewriteIndexedBlockId(block.id, 'm', absoluteIndex) };
      case 'thinking':
        return { ...block, id: rewriteIndexedBlockId(block.id, 't', absoluteIndex) };
      case 'text':
        return { ...block, id: rewriteIndexedBlockId(block.id, 'x', absoluteIndex) };
      case 'tool_use':
        return { ...block, id: rewriteIndexedBlockId(block.id, 'c', absoluteIndex) };
      case 'error':
        return { ...block, id: rewriteIndexedBlockId(block.id, 'e', absoluteIndex) };
      case 'image':
        return block.alt === 'Injected context image' ? { ...block, id: rewriteIndexedBlockId(block.id, 'i', absoluteIndex) } : block;
      default:
        return block;
    }
  });
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
        images: block.images.map((image) => (image.src ? { ...image, src: undefined, deferred: true } : image)),
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
  // slug: --Users-user-personal-personal-agent-- → /Users/user/personal/personal-agent
  return slug.replace(/^--/, '').replace(/--$/, '').replace(/-/g, '/');
}

function getFileSignature(filePath: string): string | null {
  try {
    const stats = statSync(filePath);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}

/** Parse file size from a signature string (size:mtime). Returns null on invalid input. */
function parseSignatureSize(signature: string): number | null {
  const colon = signature.indexOf(':');
  if (colon <= 0) return null;
  const size = Number(signature.slice(0, colon));
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

/** Compute a sha256 hex hash of a file's first byteCount bytes. */
function computeFilePrefixHash(filePath: string, byteCount: number): string | null {
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(Math.min(byteCount, 64 * 1024));
    const fd = openSync(filePath, 'r');
    try {
      let remaining = byteCount;
      while (remaining > 0) {
        const chunkSize = Math.min(remaining, 64 * 1024);
        const bytesRead = readSync(fd, buffer, 0, chunkSize, null);
        if (bytesRead <= 0) break;
        hash.update(buffer.subarray(0, bytesRead));
        remaining -= bytesRead;
      }
    } finally {
      closeSync(fd);
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/** Compute a sha256 hex hash of an entire file. */
function computeFileContentHash(filePath: string): string | null {
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    const fd = openSync(filePath, 'r');
    try {
      let bytesRead: number;
      while ((bytesRead = readSync(fd, buffer, 0, 64 * 1024, null)) > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } finally {
      closeSync(fd);
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isNeutralChatWorkspaceCwd(cwd: string): boolean {
  const normalized = cwd.trim();
  if (!normalized) {
    return false;
  }

  const chatWorkspacesRoot = join(getPiAgentRuntimeDir(), 'chat-workspaces');
  return normalized === chatWorkspacesRoot || normalized.startsWith(`${chatWorkspacesRoot}${sep}`);
}

function normalizeWorkspaceCwdValue(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readConversationWorkspaceMetadata(line: RawCustomEntry): ConversationWorkspaceMetadata | null {
  if (line.customType !== CONVERSATION_WORKSPACE_METADATA_CUSTOM_TYPE || !line.data || typeof line.data !== 'object') {
    return null;
  }

  const data = line.data as Record<string, unknown>;
  const cwd = typeof data.cwd === 'string' && data.cwd.trim().length > 0 ? data.cwd.trim() : undefined;
  const workspaceCwd = normalizeWorkspaceCwdValue(data.workspaceCwd);

  if (cwd === undefined && workspaceCwd === undefined) {
    return null;
  }

  return {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(workspaceCwd !== undefined ? { workspaceCwd } : {}),
  };
}

function readLegacyToolWorkspaceMetadata(line: RawMessage): LegacyToolWorkspaceMetadata | null {
  if (line.message.role !== 'toolResult' || line.message.toolName !== 'change_working_directory') {
    return null;
  }

  const details = line.message.details;
  if (!details || typeof details !== 'object') {
    return null;
  }

  const data = details as Record<string, unknown>;
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  const queued = data.queued === true;
  const cwd = typeof data.cwd === 'string' && data.cwd.trim().length > 0 ? data.cwd.trim() : '';
  if (action !== 'queue' || !queued || !cwd) {
    return null;
  }

  return { cwd, workspaceCwd: cwd };
}

function readCurrentSessionLeafId(filePath: string): string | null {
  try {
    let leafId: string | null = null;
    for (const rawLine of readFileSync(filePath, 'utf-8').split('\n')) {
      if (!rawLine.trim()) {
        continue;
      }

      const line = parseJsonLine(rawLine);
      if (!line || line.type === 'session') {
        continue;
      }

      const id = typeof line.id === 'string' && line.id.trim().length > 0 ? line.id.trim() : null;
      if (id) {
        leafId = id;
      }
    }
    return leafId;
  } catch {
    return null;
  }
}

export function appendConversationWorkspaceMetadata(input: {
  sessionFile: string;
  cwd?: string;
  workspaceCwd?: string | null;
  previousCwd?: string;
  previousWorkspaceCwd?: string | null;
  visibleMessage?: boolean;
}): void {
  const cwd = input.cwd?.trim();
  const workspaceCwd = input.workspaceCwd === null ? null : input.workspaceCwd?.trim();
  const timestamp = new Date().toISOString();
  const metadataId = randomUUID();
  const metadataParentId = readCurrentSessionLeafId(input.sessionFile);

  appendFileSync(
    input.sessionFile,
    `${JSON.stringify({
      type: 'custom',
      id: metadataId,
      parentId: metadataParentId,
      timestamp,
      customType: CONVERSATION_WORKSPACE_METADATA_CUSTOM_TYPE,
      data: {
        ...(cwd ? { cwd } : {}),
        ...(input.workspaceCwd !== undefined ? { workspaceCwd: workspaceCwd || null } : {}),
      },
    })}\n`,
    'utf-8',
  );

  if (!input.visibleMessage) {
    return;
  }

  const previousLabel =
    input.previousWorkspaceCwd === null ? 'Chats' : input.previousCwd?.trim() || input.previousWorkspaceCwd?.trim() || 'previous workspace';
  const nextLabel = input.workspaceCwd === null ? 'Chats' : cwd || workspaceCwd || 'new workspace';

  appendFileSync(
    input.sessionFile,
    `${JSON.stringify({
      type: 'custom_message',
      id: randomUUID(),
      parentId: metadataId,
      timestamp,
      customType: CONVERSATION_WORKSPACE_CHANGE_CUSTOM_TYPE,
      content: `Working directory changed from ${previousLabel} to ${nextLabel}.`,
      display: true,
      details: {
        ...(input.previousCwd ? { previousCwd: input.previousCwd } : {}),
        ...(input.previousWorkspaceCwd !== undefined ? { previousWorkspaceCwd: input.previousWorkspaceCwd } : {}),
        ...(cwd ? { cwd } : {}),
        ...(input.workspaceCwd !== undefined ? { workspaceCwd: workspaceCwd || null } : {}),
      },
    })}\n`,
    'utf-8',
  );
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
  let workspaceMetadata: ConversationWorkspaceMetadata | null = null;
  let legacyToolWorkspaceMetadata: LegacyToolWorkspaceMetadata | null = null;

  for (const rawLine of raw.split('\n')) {
    if (!rawLine.trim()) {
      continue;
    }

    const line = parseJsonLine(rawLine);
    if (!line) {
      continue;
    }

    if (line.type === 'session') {
      if (!sessionRecord) {
        sessionRecord = line as RawSessionRecord;
      }
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

    if (line.type === 'custom') {
      workspaceMetadata = readConversationWorkspaceMetadata(line as RawCustomEntry) ?? workspaceMetadata;
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
    legacyToolWorkspaceMetadata = readLegacyToolWorkspaceMetadata(message) ?? legacyToolWorkspaceMetadata;

    if (fallbackTitle === null) {
      fallbackTitle = extractTitleFromMessage(message.message);
    }
  }

  if (!sessionRecord) {
    return null;
  }

  const parentSessionFile = normalizeOptionalPath(sessionRecord.parentSession);
  const sourceRunId = readSourceRunIdFromSessionFilePath(filePath);
  const headerCwd = sessionRecord.cwd ?? slugToCwd(cwdSlug);
  const inferredLegacyWorkspaceMetadata =
    workspaceMetadata?.workspaceCwd === null && legacyToolWorkspaceMetadata ? legacyToolWorkspaceMetadata : null;
  const cwd = inferredLegacyWorkspaceMetadata?.cwd ?? workspaceMetadata?.cwd ?? headerCwd;
  const workspaceCwd =
    inferredLegacyWorkspaceMetadata?.workspaceCwd ??
    (workspaceMetadata && 'workspaceCwd' in workspaceMetadata
      ? workspaceMetadata.workspaceCwd === null
        ? isNeutralChatWorkspaceCwd(cwd)
          ? null
          : undefined
        : workspaceMetadata.workspaceCwd
      : isNeutralChatWorkspaceCwd(cwd)
        ? null
        : undefined);

  return {
    id: sessionRecord.id,
    file: filePath,
    timestamp: sessionRecord.timestamp,
    cwd,
    ...(workspaceCwd !== undefined ? { workspaceCwd } : {}),
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
    typeof meta.id !== 'string' ||
    typeof meta.timestamp !== 'string' ||
    typeof meta.cwd !== 'string' ||
    typeof meta.cwdSlug !== 'string' ||
    typeof meta.model !== 'string' ||
    typeof meta.title !== 'string' ||
    typeof meta.messageCount !== 'number'
  ) {
    return null;
  }

  const workspaceCwd = Object.prototype.hasOwnProperty.call(meta, 'workspaceCwd')
    ? meta.workspaceCwd === null
      ? null
      : typeof meta.workspaceCwd === 'string' && meta.workspaceCwd.trim().length > 0
        ? meta.workspaceCwd.trim()
        : undefined
    : undefined;

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
      ...(workspaceCwd !== undefined ? { workspaceCwd } : {}),
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

let lastScanTime = 0;
const SCAN_THROTTLE_MS = 500;

function scanSessionMetas(): SessionMeta[] {
  const now = Date.now();
  if (now - lastScanTime < SCAN_THROTTLE_MS) {
    // Return the most recent cached result from sessionMetaCache
    ensurePersistentIndexLoaded();
    const cached: SessionMeta[] = [];
    for (const [, entry] of sessionMetaCache) {
      cached.push(entry.meta);
    }
    cached.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    return cached;
  }
  lastScanTime = now;

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
  sessionDetailCache.clear();
  sessionSearchTextCache.clear();
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
        parentId: entry.parentId,
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
        parentId: entry.parentId,
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
          details: (entry as { details?: unknown }).details,
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

// ── Public API ─────────────────────────────────────────────────────────────────

export function listSessions(): SessionMeta[] {
  return scanSessionMetas();
}

export function readSessionMeta(sessionId: string): SessionMeta | null {
  return resolveSessionMeta(sessionId);
}

function readSessionIdFromSessionRecord(filePath: string): string | null {
  let fd: number | null = null;

  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(4096);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead <= 0) {
      return null;
    }

    const firstLine = buffer.subarray(0, bytesRead).toString('utf-8').split(/\r?\n/, 1)[0]?.trim();
    if (!firstLine) {
      return null;
    }

    const parsed = parseJsonLine(firstLine);
    if (!parsed || parsed.type !== 'session') {
      return null;
    }

    const sessionId = parsed.id?.trim();
    return sessionId && sessionId.length > 0 ? sessionId : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

export function readKnownSessionIdByFilePath(filePath: string): string | null {
  ensurePersistentIndexLoaded();

  const cachedSessionId = sessionMetaCache.get(filePath)?.meta.id?.trim();
  if (cachedSessionId) {
    return cachedSessionId;
  }

  if (!existsSync(filePath)) {
    return null;
  }

  return readSessionIdFromSessionRecord(filePath) ?? readSessionMetaByFile(filePath)?.id ?? null;
}

function readSessionSearchTextByFile(filePath: string, maxCharacters: number): string | null {
  const normalizedMaxCharacters = Math.max(0, maxCharacters);
  const cacheKey = `${filePath}:${normalizedMaxCharacters}`;
  const signature = getFileSignature(filePath);
  if (!signature) {
    sessionSearchTextCache.delete(cacheKey);
    return null;
  }

  const cached = sessionSearchTextCache.get(cacheKey);
  if (cached && cached.signature === signature) {
    return cached.text;
  }

  try {
    const segments: string[] = [];
    let remaining = normalizedMaxCharacters;

    // @ts-ignore TS7030 — false positive; all paths in this callback are valid
    readFileLinesReverse(filePath, (rawLine) => {
      if (remaining <= 0) {
        return false;
      }

      if (!rawLine.trim()) {
        return;
      }

      const parsed = parseJsonLine(sanitizeSessionLineForSearch(rawLine));
      if (!parsed || parsed.type !== 'message') {
        return;
      }

      remaining = appendSessionSearchSegment(segments, extractSearchTextFromMessage(parsed.message), remaining);
      if (remaining <= 0) {
        return false;
      }
    });

    const text = segments.reverse().join('\n');
    sessionSearchTextCache.set(cacheKey, { signature, text });
    return text;
  } catch {
    sessionSearchTextCache.delete(cacheKey);
  }
  return null;
}

export function readSessionSearchText(sessionId: string, maxCharacters = 12_000): string | null {
  const meta = resolveSessionMeta(sessionId);
  if (!meta) {
    return null;
  }

  const indexedText = readSessionSearchTextByFile(meta.file, maxCharacters);
  if (indexedText !== null) {
    return indexedText;
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
  if (!Number.isSafeInteger(tailBlocks) || typeof tailBlocks !== 'number' || tailBlocks <= 0) {
    return null;
  }

  return Math.min(tailBlocks, totalBlocks);
}

function normalizeTailBlockRequest(tailBlocks: number | undefined): number | undefined {
  return typeof tailBlocks === 'number' && Number.isSafeInteger(tailBlocks) && tailBlocks > 0 ? Math.min(1000, tailBlocks) : undefined;
}

function buildSessionDetailCacheKey(filePath: string, tailBlocks?: number): string {
  return `${filePath}::${tailBlocks ?? 'all'}`;
}

function trimSessionDetailCache(): void {
  while (sessionDetailCache.size > MAX_SESSION_DETAIL_CACHE_ENTRIES) {
    const oldestKey = sessionDetailCache.keys().next().value;
    if (!oldestKey) {
      break;
    }

    sessionDetailCache.delete(oldestKey);
  }
}

export function readSessionBlocksByFileWithTelemetry(
  filePath: string,
  options?: { tailBlocks?: number },
): { detail: SessionDetail | null; telemetry: SessionDetailReadTelemetry | null } {
  const startedAt = process.hrtime.bigint();
  const signature = getFileSignature(filePath);
  if (!signature) {
    return { detail: null, telemetry: null };
  }

  const requestedTailBlocks = normalizeTailBlockRequest(options?.tailBlocks);
  const cacheKey = buildSessionDetailCacheKey(filePath, requestedTailBlocks);
  const cachedDetail = sessionDetailCache.get(cacheKey);

  // ── Cache hit ────────────────────────────────────────────────────────────────
  if (cachedDetail?.signature === signature) {
    sessionDetailCache.delete(cacheKey);
    sessionDetailCache.set(cacheKey, cachedDetail);
    return {
      detail: cachedDetail.detail.signature === signature ? cachedDetail.detail : { ...cachedDetail.detail, signature },
      telemetry: {
        cache: 'hit',
        loader: cachedDetail.detail.contextUsage === null && typeof requestedTailBlocks === 'number' ? 'fast-tail' : 'full',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        ...(typeof requestedTailBlocks === 'number' ? { requestedTailBlocks } : {}),
        totalBlocks: cachedDetail.detail.totalBlocks,
        blockOffset: cachedDetail.detail.blockOffset,
        contextUsageIncluded: cachedDetail.detail.contextUsage !== null,
      },
    };
  }

  // ── Cache miss — detect modification ─────────────────────────────────────────
  let telemetryModificationDetected = false;
  if (cachedDetail?.contentHash) {
    const oldSize = parseSignatureSize(cachedDetail.signature);
    const newSize = parseSignatureSize(signature);
    if (oldSize !== null && newSize !== null) {
      if (newSize < oldSize) {
        // File was truncated (shorter than before) — definite modification.
        telemetryModificationDetected = true;
      } else if (newSize === oldSize) {
        // Same size but mtime changed — content was rewritten in place.
        telemetryModificationDetected = true;
      } else {
        // File grew — verify prefix integrity via content hash.
        const prefixHash = computeFilePrefixHash(filePath, oldSize);
        if (prefixHash !== null && prefixHash !== cachedDetail.contentHash) {
          telemetryModificationDetected = true;
        }
      }

      if (telemetryModificationDetected) {
        persistAppTelemetryEvent({
          source: 'server',
          category: 'session_integrity',
          name: 'prompt_cache_miss',
          metadata: {
            filePath,
            oldSignature: cachedDetail.signature,
            newSignature: signature,
            oldSize,
            newSize,
            oldMtime: Number(cachedDetail.signature.split(':')[1] ?? 0),
            newMtime: Number(signature.split(':')[1] ?? 0),
            cacheLoader: typeof requestedTailBlocks === 'number' ? 'fast-tail' : 'full',
          },
        });
      }
    }
  }

  const meta = readCachedSessionMeta(filePath, resolveSessionFileCwdSlug(filePath));
  if (!meta) return { detail: null, telemetry: null };

  const fastTailDetail =
    typeof requestedTailBlocks === 'number' && requestedTailBlocks > 0
      ? tryReadSessionTailBlocksByFile(meta.file, meta, requestedTailBlocks)
      : null;
  if (fastTailDetail) {
    const contentHash = computeFileContentHash(filePath) ?? '';
    const detail = {
      ...fastTailDetail,
      signature,
    } satisfies SessionDetail;
    sessionDetailCache.set(cacheKey, { signature, contentHash, detail });
    trimSessionDetailCache();
    return {
      detail,
      telemetry: {
        cache: 'miss',
        loader: 'fast-tail',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        ...(typeof requestedTailBlocks === 'number' ? { requestedTailBlocks } : {}),
        totalBlocks: detail.totalBlocks,
        blockOffset: detail.blockOffset,
        contextUsageIncluded: false,
        ...(telemetryModificationDetected ? { modificationDetected: true } : {}),
      },
    };
  }

  const manager = SessionManager.open(meta.file);
  const branchEntries = buildDisplayMessageEntriesFromSessionEntries(manager.getBranch());
  const allBlocks = decorateSessionAssetUrls(buildDisplayBlocksFromEntries(branchEntries), meta.id);
  const totalBlocks = allBlocks.length;
  const tailBlockLimit = resolveTailBlockLimit(requestedTailBlocks, totalBlocks);
  const blockOffset = tailBlockLimit === null ? 0 : Math.max(0, totalBlocks - tailBlockLimit);
  const slicedBlocks = blockOffset > 0 ? allBlocks.slice(blockOffset) : allBlocks;
  const blocks = blockOffset > 0 ? deferHeavyBlockContent(slicedBlocks, blockOffset, totalBlocks) : slicedBlocks;

  const contentHash = computeFileContentHash(filePath) ?? '';
  const detail = {
    meta,
    blocks,
    blockOffset,
    totalBlocks,
    contextUsage: readSessionContextUsageFromEntries(manager.getEntries()),
    signature,
  } satisfies SessionDetail;

  sessionDetailCache.set(cacheKey, { signature, contentHash, detail });
  trimSessionDetailCache();
  return {
    detail,
    telemetry: {
      cache: 'miss',
      loader: 'full',
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      ...(typeof requestedTailBlocks === 'number' ? { requestedTailBlocks } : {}),
      totalBlocks: detail.totalBlocks,
      blockOffset: detail.blockOffset,
      contextUsageIncluded: true,
      ...(telemetryModificationDetected ? { modificationDetected: true } : {}),
    },
  };
}

function normalizeKnownBlockId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function buildAppendOnlySessionDetailResponse(input: {
  detail: SessionDetail;
  knownBlockOffset?: number;
  knownTotalBlocks?: number;
  knownLastBlockId?: string;
}): SessionDetailAppendOnlyResponse | null {
  const knownBlockOffset =
    Number.isSafeInteger(input.knownBlockOffset) && typeof input.knownBlockOffset === 'number' ? Math.max(0, input.knownBlockOffset) : null;
  const knownTotalBlocks =
    Number.isSafeInteger(input.knownTotalBlocks) && typeof input.knownTotalBlocks === 'number' ? Math.max(0, input.knownTotalBlocks) : null;

  if (knownBlockOffset === null || knownTotalBlocks === null) {
    return null;
  }

  if (input.detail.totalBlocks <= knownTotalBlocks || input.detail.blockOffset < knownBlockOffset) {
    return null;
  }

  if (input.detail.blockOffset < knownTotalBlocks) {
    const knownLastVisibleIndex = knownTotalBlocks - input.detail.blockOffset - 1;
    const currentKnownLastBlock = knownLastVisibleIndex >= 0 ? input.detail.blocks[knownLastVisibleIndex] : undefined;
    const knownLastBlockId = normalizeKnownBlockId(input.knownLastBlockId);
    if (!knownLastBlockId || currentKnownLastBlock?.id !== knownLastBlockId) {
      return null;
    }
  }

  const appendedStartIndex = Math.max(0, knownTotalBlocks - input.detail.blockOffset);
  const appendedBlocks = input.detail.blocks.slice(appendedStartIndex);
  if (appendedBlocks.length === 0) {
    return null;
  }

  return {
    appendOnly: true,
    meta: input.detail.meta,
    blocks: appendedBlocks,
    blockOffset: input.detail.blockOffset,
    totalBlocks: input.detail.totalBlocks,
    contextUsage: input.detail.contextUsage,
    signature: input.detail.signature ?? null,
  };
}

export function readSessionBlocksByFile(filePath: string, options?: { tailBlocks?: number }): SessionDetail | null {
  return readSessionBlocksByFileWithTelemetry(filePath, options).detail;
}

export function readSessionBlocksWithTelemetry(
  sessionId: string,
  options?: { tailBlocks?: number },
): { detail: SessionDetail | null; telemetry: SessionDetailReadTelemetry | null } {
  const meta = resolveSessionMeta(sessionId);
  return meta ? readSessionBlocksByFileWithTelemetry(meta.file, options) : { detail: null, telemetry: null };
}

export function readSessionBlocks(sessionId: string, options?: { tailBlocks?: number }): SessionDetail | null {
  return readSessionBlocksWithTelemetry(sessionId, options).detail;
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
  const data = normalizeBase64ImageData(block.data);
  if (!mimeType || !data) {
    return null;
  }

  return {
    mimeType,
    data: Buffer.from(data, 'base64'),
    fileName: typeof block.name === 'string' && block.name.trim().length > 0 ? block.name.trim() : undefined,
  };
}

function buildSessionImageAssets(
  blocks: RawContentBlock[],
): Array<{ block: RawContentBlock; asset: { mimeType: string; data: Buffer; fileName?: string } }> {
  return blocks.flatMap((block) => {
    if (block.type !== 'image') {
      return [];
    }

    const asset = buildSessionImageAsset(block);
    return asset ? [{ block, asset }] : [];
  });
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

      const image = buildSessionImageAssets(contentBlocks)[imageIndex];
      return image?.asset ?? null;
    }

    if (entry.message.role !== 'toolResult') {
      continue;
    }

    const images = buildSessionImageAssets(contentBlocks);
    for (const [candidateIndex, image] of images.entries()) {
      if (`${entry.id}-i${candidateIndex}` !== blockId) {
        continue;
      }

      return image.asset;
    }
  }

  return null;
}

// ── Goal state ─────────────────────────────────────────────────────────────────

export interface ThreadGoal {
  objective: string;
  status: 'active' | 'paused' | 'complete';
  tasks: Array<{ id: string; description: string; status: 'pending' | 'in_progress' | 'done' | 'blocked' }>;
  stopReason: string | null;
  updatedAt: string | null;
}

const GOAL_STATE_CUSTOM_TYPE = 'conversation-goal';

function normalizeGoalStatus(value: unknown): ThreadGoal['status'] {
  if (typeof value === 'string' && ['active', 'paused', 'complete'].includes(value)) {
    return value as ThreadGoal['status'];
  }
  return 'complete';
}

function normalizeTaskStatus(value: unknown): ThreadGoal['tasks'][number]['status'] {
  if (typeof value === 'string' && ['pending', 'in_progress', 'done', 'blocked'].includes(value)) {
    return value as ThreadGoal['tasks'][number]['status'];
  }
  return 'pending';
}

export function readGoalFromEntries(entries: unknown[]): ThreadGoal | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry) || entry.type !== 'custom' || entry.customType !== GOAL_STATE_CUSTOM_TYPE) {
      continue;
    }
    const data = entry.data;
    if (!isRecord(data) || typeof data.objective !== 'string') {
      continue;
    }
    const status = normalizeGoalStatus(data.status);
    if (!data.objective.trim() || status === 'complete') {
      return null;
    }
    const tasks: ThreadGoal['tasks'] = [];
    if (Array.isArray(data.tasks)) {
      for (const task of data.tasks) {
        if (!isRecord(task) || typeof task.id !== 'string' || typeof task.description !== 'string') {
          continue;
        }
        tasks.push({
          id: task.id,
          description: task.description,
          status: normalizeTaskStatus(task.status),
        });
      }
    }
    return {
      objective: data.objective,
      status,
      tasks,
      stopReason: typeof data.stopReason === 'string' ? data.stopReason : null,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    };
  }
  return null;
}
