import { sep } from 'node:path';
import {
  listConversationSessionsSnapshot,
  readConversationSessionMeta,
  readConversationSessionSignature,
  resolveConversationSessionFile,
} from './conversationService.js';
import { readConversationSummary } from './conversationSummaries.js';
import { readSessionBlocksByFile, type DisplayBlock } from './sessions.js';

export const CONVERSATION_INSPECT_SCOPE_VALUES = ['all', 'live', 'running', 'archived'] as const;
export const CONVERSATION_INSPECT_ACTION_VALUES = ['list', 'search', 'query', 'diff', 'outline', 'read_window'] as const;
export const CONVERSATION_INSPECT_ORDER_VALUES = ['asc', 'desc'] as const;
export const CONVERSATION_INSPECT_BLOCK_TYPE_VALUES = ['user', 'text', 'context', 'summary', 'tool_use', 'image', 'error'] as const;
export const CONVERSATION_INSPECT_ROLE_VALUES = ['user', 'assistant', 'tool', 'context', 'summary', 'image', 'error'] as const;
export const CONVERSATION_INSPECT_SEARCH_MODE_VALUES = ['phrase', 'allTerms', 'anyTerm'] as const;

export type ConversationInspectScope = (typeof CONVERSATION_INSPECT_SCOPE_VALUES)[number];
export type ConversationInspectAction = (typeof CONVERSATION_INSPECT_ACTION_VALUES)[number];
export type ConversationInspectOrder = (typeof CONVERSATION_INSPECT_ORDER_VALUES)[number];
export type ConversationInspectBlockType = (typeof CONVERSATION_INSPECT_BLOCK_TYPE_VALUES)[number];
export type ConversationInspectRole = (typeof CONVERSATION_INSPECT_ROLE_VALUES)[number];
export type ConversationInspectSearchMode = (typeof CONVERSATION_INSPECT_SEARCH_MODE_VALUES)[number];

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_BLOCK_LIMIT = 20;
const MAX_BLOCK_LIMIT = 200;
const DEFAULT_WINDOW = 4;
const MAX_WINDOW = 50;
const DEFAULT_MAX_CHARACTERS_PER_BLOCK = 2_000;
const MAX_MAX_CHARACTERS_PER_BLOCK = 20_000;

export class ConversationInspectCapabilityInputError extends Error {}

interface ConversationInspectSessionSummary {
  id: string;
  title: string;
  cwd: string;
  lastActivityAt: string;
  isLive: boolean;
  isRunning: boolean;
  isCurrent: boolean;
  messageCount: number;
}

interface ConversationInspectSessionRecord extends ConversationInspectSessionSummary {
  file: string;
}

interface InspectableBlockBase {
  id: string;
  index: number;
  ts: string;
  type: ConversationInspectBlockType;
}

export type InspectableConversationBlock =
  | (InspectableBlockBase & { type: 'user'; text: string; truncated?: boolean })
  | (InspectableBlockBase & { type: 'text'; text: string; truncated?: boolean })
  | (InspectableBlockBase & { type: 'context'; text: string; customType?: string; truncated?: boolean })
  | (InspectableBlockBase & { type: 'summary'; kind: 'compaction' | 'branch' | 'related'; title: string; text: string; detail?: string; truncated?: boolean })
  | (InspectableBlockBase & { type: 'tool_use'; tool: string; toolCallId: string; durationMs?: number; input: string; output: string; truncated?: boolean })
  | (InspectableBlockBase & { type: 'image'; alt: string; caption?: string })
  | (InspectableBlockBase & { type: 'error'; tool?: string; message: string; truncated?: boolean });

export interface ListConversationInspectResult {
  scope: ConversationInspectScope;
  totalMatching: number;
  returnedCount: number;
  sessions: ConversationInspectSessionSummary[];
}

export interface SearchConversationInspectMatch {
  conversationId: string;
  title: string;
  cwd: string;
  lastActivityAt: string;
  isLive: boolean;
  isRunning: boolean;
  blockId: string;
  blockType: ConversationInspectBlockType;
  blockIndex: number;
  snippet: string;
  contextBlocks?: InspectableConversationBlock[];
}

export interface SearchConversationInspectResult {
  query: string;
  mode: ConversationInspectSearchMode;
  scope: ConversationInspectScope;
  totalMatching: number;
  returnedCount: number;
  matches: SearchConversationInspectMatch[];
}

export interface QueryConversationInspectResult {
  conversationId: string;
  title: string;
  cwd: string;
  signature: string | null;
  totalBlocks: number;
  matchingBlocks: number;
  returnedBlocks: number;
  firstReturnedBlockId: string | null;
  lastReturnedBlockId: string | null;
  order: ConversationInspectOrder;
  blocks: InspectableConversationBlock[];
}

export interface DiffConversationInspectResult {
  conversationId: string;
  title: string;
  cwd: string;
  signature: string | null;
  unchanged: boolean;
  totalBlocks: number;
  matchingBlocks: number;
  returnedBlocks: number;
  firstReturnedBlockId: string | null;
  lastReturnedBlockId: string | null;
  blocks: InspectableConversationBlock[];
}

export interface ConversationInspectOutlineAnchor {
  blockId: string;
  blockIndex: number;
  type: 'user' | 'summary';
  label: string;
  preview: string;
}

export interface ConversationInspectOutlineResult {
  conversationId: string;
  title: string;
  cwd: string;
  signature: string | null;
  totalBlocks: number;
  cachedPreview?: string;
  anchors: ConversationInspectOutlineAnchor[];
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isInteger(value)
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number.parseInt(value.trim(), 10)
      : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(1, Math.min(max, parsed));
}

function normalizeScope(value: unknown): ConversationInspectScope {
  if (value === undefined || value === null || value === '') {
    return 'all';
  }
  if (value === 'all' || value === 'live' || value === 'running' || value === 'archived') {
    return value;
  }
  throw new ConversationInspectCapabilityInputError(`Invalid scope ${JSON.stringify(value)}. Valid values: ${CONVERSATION_INSPECT_SCOPE_VALUES.join(', ')}.`);
}

function normalizeOrder(value: unknown): ConversationInspectOrder {
  if (value === undefined || value === null || value === '') {
    return 'asc';
  }
  if (value === 'asc' || value === 'desc') {
    return value;
  }
  throw new ConversationInspectCapabilityInputError(`Invalid order ${JSON.stringify(value)}. Valid values: ${CONVERSATION_INSPECT_ORDER_VALUES.join(', ')}.`);
}

function normalizeSearchMode(value: unknown): ConversationInspectSearchMode {
  if (value === undefined || value === null || value === '') {
    return 'phrase';
  }
  if (value === 'phrase' || value === 'allTerms' || value === 'anyTerm') {
    return value;
  }
  throw new ConversationInspectCapabilityInputError(`Invalid searchMode ${JSON.stringify(value)}. Valid values: ${CONVERSATION_INSPECT_SEARCH_MODE_VALUES.join(', ')}.`);
}

function normalizeBlockTypes(value: unknown): ConversationInspectBlockType[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const allowed = new Set<string>(CONVERSATION_INSPECT_BLOCK_TYPE_VALUES);
  const seen = new Set<string>();
  const normalized: ConversationInspectBlockType[] = [];

  for (const candidate of value) {
    const type = typeof candidate === 'string' ? candidate.trim() : '';
    if (!type || seen.has(type)) {
      continue;
    }
    if (!allowed.has(type)) {
      throw new ConversationInspectCapabilityInputError(`Invalid types value ${JSON.stringify(type)}. Valid values: ${CONVERSATION_INSPECT_BLOCK_TYPE_VALUES.join(', ')}. Tip: use roles:["assistant"] for assistant messages; block type "text" is assistant text.`);
    }

    seen.add(type);
    normalized.push(type as ConversationInspectBlockType);
  }

  return normalized;
}

function normalizeRoles(value: unknown): ConversationInspectRole[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const allowed = new Set<string>(CONVERSATION_INSPECT_ROLE_VALUES);
  const seen = new Set<string>();
  const normalized: ConversationInspectRole[] = [];

  for (const candidate of value) {
    const role = typeof candidate === 'string' ? candidate.trim() : '';
    if (!role || seen.has(role)) {
      continue;
    }
    if (!allowed.has(role)) {
      throw new ConversationInspectCapabilityInputError(`Invalid roles value ${JSON.stringify(role)}. Valid values: ${CONVERSATION_INSPECT_ROLE_VALUES.join(', ')}.`);
    }

    seen.add(role);
    normalized.push(role as ConversationInspectRole);
  }

  return normalized;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const candidate of value) {
    const item = typeof candidate === 'string' ? candidate.trim() : '';
    if (!item || seen.has(item)) {
      continue;
    }

    seen.add(item);
    normalized.push(item);
  }

  return normalized;
}

function truncateText(value: string, maxCharacters: number): { text: string; truncated: boolean } {
  if (value.length <= maxCharacters) {
    return { text: value, truncated: false };
  }

  return {
    text: `${value.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`,
    truncated: true,
  };
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function buildBlockSearchText(block: DisplayBlock): string {
  switch (block.type) {
    case 'user':
    case 'text':
      return block.text;
    case 'context':
      return `${block.customType ?? ''}\n${block.text}`;
    case 'summary':
      return `${block.kind}\n${block.title}\n${block.detail ?? ''}\n${block.text}`;
    case 'tool_use':
      return `${block.tool}\n${stringifyUnknown(block.input)}\n${block.output}`;
    case 'image':
      return `${block.alt}\n${block.caption ?? ''}`;
    case 'error':
      return `${block.tool ?? ''}\n${block.message}`;
    default:
      return '';
  }
}

function blockRole(block: DisplayBlock): ConversationInspectRole | null {
  switch (block.type) {
    case 'user':
      return 'user';
    case 'text':
      return 'assistant';
    case 'tool_use':
      return 'tool';
    case 'context':
      return 'context';
    case 'summary':
      return 'summary';
    case 'image':
      return 'image';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

function splitSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function matchesSearchText(text: string, query: string, mode: ConversationInspectSearchMode): boolean {
  const haystack = text.replace(/\s+/g, ' ').trim().toLowerCase();
  const phrase = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!phrase) {
    return false;
  }
  if (mode === 'phrase') {
    return haystack.includes(phrase);
  }

  const terms = splitSearchTerms(query);
  if (terms.length === 0) {
    return false;
  }
  return mode === 'allTerms'
    ? terms.every((term) => haystack.includes(term))
    : terms.some((term) => haystack.includes(term));
}

function sanitizeBlock(block: DisplayBlock, index: number, maxCharactersPerBlock: number): InspectableConversationBlock | null {
  switch (block.type) {
    case 'user': {
      const text = truncateText(block.text, maxCharactersPerBlock);
      return {
        id: block.id,
        index,
        ts: block.ts,
        type: 'user',
        text: text.text,
        ...(text.truncated ? { truncated: true } : {}),
      };
    }

    case 'text': {
      const text = truncateText(block.text, maxCharactersPerBlock);
      return {
        id: block.id,
        index,
        ts: block.ts,
        type: 'text',
        text: text.text,
        ...(text.truncated ? { truncated: true } : {}),
      };
    }

    case 'context': {
      const text = truncateText(block.text, maxCharactersPerBlock);
      return {
        id: block.id,
        index,
        ts: block.ts,
        type: 'context',
        text: text.text,
        ...(block.customType ? { customType: block.customType } : {}),
        ...(text.truncated ? { truncated: true } : {}),
      };
    }

    case 'summary': {
      const text = truncateText([block.detail, block.text].filter(Boolean).join('\n\n'), maxCharactersPerBlock);
      return {
        id: block.id,
        index,
        ts: block.ts,
        type: 'summary',
        kind: block.kind,
        title: block.title,
        text: text.text,
        ...(block.detail ? { detail: truncateText(block.detail, maxCharactersPerBlock).text } : {}),
        ...(text.truncated ? { truncated: true } : {}),
      };
    }

    case 'tool_use': {
      const input = truncateText(stringifyUnknown(block.input), maxCharactersPerBlock);
      const output = truncateText(block.output, maxCharactersPerBlock);
      return {
        id: block.id,
        index,
        ts: block.ts,
        type: 'tool_use',
        tool: block.tool,
        toolCallId: block.toolCallId,
        input: input.text,
        output: output.text,
        ...(typeof block.durationMs === 'number' ? { durationMs: block.durationMs } : {}),
        ...(input.truncated || output.truncated ? { truncated: true } : {}),
      };
    }

    case 'image':
      return {
        id: block.id,
        index,
        ts: block.ts,
        type: 'image',
        alt: block.alt,
        ...(block.caption ? { caption: block.caption } : {}),
      };

    case 'error': {
      const message = truncateText(block.message, maxCharactersPerBlock);
      return {
        id: block.id,
        index,
        ts: block.ts,
        type: 'error',
        ...(block.tool ? { tool: block.tool } : {}),
        message: message.text,
        ...(message.truncated ? { truncated: true } : {}),
      };
    }

    case 'thinking':
      return null;

    default:
      return null;
  }
}

function formatInspectableBlock(block: InspectableConversationBlock): string {
  const header = `[${block.index}] ${block.id} · ${block.type}${'tool' in block ? `:${block.tool}` : ''} · ${block.ts}`;

  switch (block.type) {
    case 'user':
    case 'text':
      return `${header}\n${block.text}`;
    case 'context':
      return `${header}${block.customType ? `\ncustomType: ${block.customType}` : ''}\n${block.text}`;
    case 'summary':
      return `${header}\ntitle: ${block.title}\n${block.text}`;
    case 'tool_use':
      return `${header}\ninput:\n${block.input}\n\noutput:\n${block.output}`;
    case 'image':
      return `${header}\nalt: ${block.alt}${block.caption ? `\ncaption: ${block.caption}` : ''}`;
    case 'error':
      return `${header}\n${block.message}`;
    default:
      return header;
  }
}

function statusLabel(session: ConversationInspectSessionSummary): string {
  if (session.isRunning) {
    return 'running';
  }
  if (session.isLive) {
    return 'live';
  }
  return 'archived';
}

function matchesCwdFilter(sessionCwd: string, cwdFilter: string | undefined): boolean {
  if (!cwdFilter) {
    return true;
  }

  return sessionCwd === cwdFilter
    || sessionCwd.startsWith(`${cwdFilter}${sep}`)
    || sessionCwd.includes(cwdFilter);
}

function collectInspectableSessions(input: {
  scope?: unknown;
  cwd?: unknown;
  query?: unknown;
  includeCurrent?: unknown;
  currentConversationId?: string;
} = {}): { scope: ConversationInspectScope; sessions: ConversationInspectSessionRecord[] } {
  const scope = normalizeScope(input.scope);
  const cwd = readOptionalString(input.cwd);
  const query = readOptionalString(input.query)?.toLowerCase();
  const includeCurrent = readOptionalBoolean(input.includeCurrent) ?? false;
  const currentConversationId = readOptionalString(input.currentConversationId);

  const sessions = listConversationSessionsSnapshot()
    .map((session) => ({
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      lastActivityAt: session.lastActivityAt ?? session.timestamp,
      isLive: Boolean(session.isLive),
      isRunning: Boolean(session.isRunning),
      isCurrent: session.id === currentConversationId,
      messageCount: session.messageCount,
      file: session.file,
    }))
    .filter((session) => includeCurrent || !session.isCurrent)
    .filter((session) => {
      switch (scope) {
        case 'running':
          return session.isRunning;
        case 'live':
          return session.isLive;
        case 'archived':
          return !session.isLive;
        default:
          return true;
      }
    })
    .filter((session) => matchesCwdFilter(session.cwd, cwd))
    .filter((session) => {
      if (!query) {
        return true;
      }

      return session.id.toLowerCase().includes(query)
        || session.title.toLowerCase().includes(query)
        || session.cwd.toLowerCase().includes(query);
    })
    .sort((left, right) => {
      if (left.isRunning !== right.isRunning) {
        return left.isRunning ? -1 : 1;
      }
      if (left.isLive !== right.isLive) {
        return left.isLive ? -1 : 1;
      }
      return right.lastActivityAt.localeCompare(left.lastActivityAt);
    });

  return { scope, sessions };
}

function findSnippetMatch(text: string, query: string, mode: ConversationInspectSearchMode): { index: number; length: number } | null {
  const phrase = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!phrase) {
    return null;
  }

  if (mode === 'phrase') {
    const index = text.toLowerCase().indexOf(phrase);
    return index >= 0 ? { index, length: phrase.length } : null;
  }

  const lowerText = text.toLowerCase();
  const matches = splitSearchTerms(query)
    .map((term) => ({ term, index: lowerText.indexOf(term) }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index);

  const firstMatch = matches[0];
  return firstMatch ? { index: firstMatch.index, length: firstMatch.term.length } : null;
}

function extractQuerySnippet(text: string, query: string, mode: ConversationInspectSearchMode, maxCharacters: number): string {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const match = findSnippetMatch(normalizedText, query, mode);
  if (!normalizedText || !match) {
    return '';
  }

  if (normalizedText.length <= maxCharacters) {
    return normalizedText;
  }

  const remaining = Math.max(0, maxCharacters - match.length);
  const leftContext = Math.floor(remaining / 2);
  const rightContext = remaining - leftContext;
  const start = Math.max(0, match.index - leftContext);
  const end = Math.min(normalizedText.length, match.index + match.length + rightContext);
  const rawSnippet = normalizedText.slice(start, end).trim();

  return `${start > 0 ? '…' : ''}${rawSnippet}${end < normalizedText.length ? '…' : ''}`;
}

function resolveConversationSession(conversationIdInput: unknown): {
  conversationId: string;
  title: string;
  cwd: string;
  signature: string | null;
  blocks: DisplayBlock[];
} {
  const conversationId = readOptionalString(conversationIdInput);
  if (!conversationId) {
    throw new ConversationInspectCapabilityInputError('conversationId is required.');
  }

  const meta = readConversationSessionMeta(conversationId);
  if (!meta) {
    throw new ConversationInspectCapabilityInputError(`Conversation ${conversationId} was not found.`);
  }

  const sessionFile = resolveConversationSessionFile(conversationId) ?? meta.file;
  if (!sessionFile) {
    throw new ConversationInspectCapabilityInputError(`Conversation ${conversationId} does not have a readable session file.`);
  }

  const detail = readSessionBlocksByFile(sessionFile);
  if (!detail) {
    throw new ConversationInspectCapabilityInputError(`Conversation ${conversationId} could not be read.`);
  }

  return {
    conversationId,
    title: meta.title,
    cwd: meta.cwd,
    signature: readConversationSessionSignature(conversationId) ?? detail.signature ?? null,
    blocks: detail.blocks,
  };
}

function findBlockIndex(blocks: DisplayBlock[], blockId: string, label: 'afterBlockId' | 'beforeBlockId' | 'aroundBlockId'): number {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0) {
    throw new ConversationInspectCapabilityInputError(`${label} ${blockId} was not found in the conversation.`);
  }

  return index;
}

function applyBlockFilters(blocks: DisplayBlock[], input: {
  afterBlockId?: string;
  beforeBlockId?: string;
  aroundBlockId?: string;
  window: number;
  types: ConversationInspectBlockType[];
  roles: ConversationInspectRole[];
  tools: string[];
  text?: string;
  searchMode: ConversationInspectSearchMode;
  includeAroundMatches: boolean;
}): Array<{ block: DisplayBlock; index: number }> {
  if (input.aroundBlockId && (input.afterBlockId || input.beforeBlockId)) {
    throw new ConversationInspectCapabilityInputError('aroundBlockId cannot be combined with afterBlockId or beforeBlockId.');
  }

  let indexed = blocks.map((block, index) => ({ block, index }));

  if (input.afterBlockId) {
    const afterIndex = findBlockIndex(blocks, input.afterBlockId, 'afterBlockId');
    indexed = indexed.filter((entry) => entry.index > afterIndex);
  }

  if (input.beforeBlockId) {
    const beforeIndex = findBlockIndex(blocks, input.beforeBlockId, 'beforeBlockId');
    indexed = indexed.filter((entry) => entry.index < beforeIndex);
  }

  if (input.aroundBlockId) {
    const anchorIndex = findBlockIndex(blocks, input.aroundBlockId, 'aroundBlockId');
    const start = Math.max(0, anchorIndex - input.window);
    const end = Math.min(blocks.length, anchorIndex + input.window + 1);
    indexed = indexed.filter((entry) => entry.index >= start && entry.index < end);
  }

  if (input.types.length > 0) {
    const allowed = new Set<string>(input.types);
    indexed = indexed.filter((entry) => allowed.has(entry.block.type));
  }

  if (input.roles.length > 0) {
    const allowed = new Set<string>(input.roles);
    indexed = indexed.filter((entry) => {
      const role = blockRole(entry.block);
      return role ? allowed.has(role) : false;
    });
  }

  if (input.tools.length > 0) {
    const allowed = new Set(input.tools.map((tool) => tool.toLowerCase()));
    indexed = indexed.filter((entry) => {
      if (entry.block.type === 'tool_use') {
        return allowed.has(entry.block.tool.toLowerCase());
      }
      if (entry.block.type === 'error' && entry.block.tool) {
        return allowed.has(entry.block.tool.toLowerCase());
      }
      return false;
    });
  }

  if (input.text) {
    indexed = indexed.filter((entry) => matchesSearchText(buildBlockSearchText(entry.block), input.text ?? '', input.searchMode));
  }

  if (input.includeAroundMatches && !input.aroundBlockId) {
    const includedIndexes = new Set<number>();
    for (const entry of indexed) {
      const start = Math.max(0, entry.index - input.window);
      const end = Math.min(blocks.length, entry.index + input.window + 1);
      for (let index = start; index < end; index += 1) {
        includedIndexes.add(index);
      }
    }
    indexed = blocks
      .map((block, index) => ({ block, index }))
      .filter((entry) => includedIndexes.has(entry.index));
  }

  return indexed;
}

function sanitizeBlocks(entries: Array<{ block: DisplayBlock; index: number }>, maxCharactersPerBlock: number): InspectableConversationBlock[] {
  return entries
    .map(({ block, index }) => sanitizeBlock(block, index, maxCharactersPerBlock))
    .filter((block): block is InspectableConversationBlock => Boolean(block));
}

export function listConversationInspectSessions(input: {
  scope?: unknown;
  cwd?: unknown;
  query?: unknown;
  limit?: unknown;
  includeCurrent?: unknown;
  currentConversationId?: string;
} = {}): ListConversationInspectResult {
  const limit = normalizePositiveInteger(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const { scope, sessions } = collectInspectableSessions(input);
  const returned = sessions.slice(0, limit).map(({ file: _file, ...session }) => session);

  return {
    scope,
    totalMatching: sessions.length,
    returnedCount: returned.length,
    sessions: returned,
  };
}

export function formatConversationInspectSessionList(result: ListConversationInspectResult): string {
  if (result.sessions.length === 0) {
    return `No conversations matched scope=${result.scope}.`;
  }

  return [
    `Conversations (${result.returnedCount}/${result.totalMatching}) scope=${result.scope}:`,
    ...result.sessions.map((session) => {
      const current = session.isCurrent ? ' current' : '';
      return `- ${session.id} [${statusLabel(session)}${current}] ${session.title} · ${session.cwd} · ${session.lastActivityAt}`;
    }),
  ].join('\n');
}

export function searchConversationInspectSessions(input: {
  query?: unknown;
  searchMode?: unknown;
  scope?: unknown;
  cwd?: unknown;
  limit?: unknown;
  window?: unknown;
  includeAroundMatches?: unknown;
  includeCurrent?: unknown;
  currentConversationId?: string;
  maxSnippetCharacters?: unknown;
  maxCharactersPerBlock?: unknown;
  stopAfterLimit?: unknown;
} = {}): SearchConversationInspectResult {
  const query = readOptionalString(input.query);
  if (!query) {
    throw new ConversationInspectCapabilityInputError('query is required.');
  }

  const mode = normalizeSearchMode(input.searchMode);
  const limit = normalizePositiveInteger(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const window = normalizePositiveInteger(input.window, DEFAULT_WINDOW, MAX_WINDOW);
  const includeAroundMatches = readOptionalBoolean(input.includeAroundMatches) ?? false;
  const stopAfterLimit = readOptionalBoolean(input.stopAfterLimit) ?? false;
  const maxSnippetCharacters = normalizePositiveInteger(input.maxSnippetCharacters, 240, 2_000);
  const maxCharactersPerBlock = normalizePositiveInteger(
    input.maxCharactersPerBlock,
    DEFAULT_MAX_CHARACTERS_PER_BLOCK,
    MAX_MAX_CHARACTERS_PER_BLOCK,
  );
  const { scope, sessions } = collectInspectableSessions({
    scope: input.scope,
    cwd: input.cwd,
    includeCurrent: input.includeCurrent,
    currentConversationId: input.currentConversationId,
  });

  const matches: SearchConversationInspectMatch[] = [];

  for (const session of sessions) {
    if (stopAfterLimit && matches.length >= limit) {
      break;
    }

    const detail = readSessionBlocksByFile(session.file);
    if (!detail) {
      continue;
    }

    const matchEntry = detail.blocks
      .map((block, index) => ({ block, index, searchText: buildBlockSearchText(block) }))
      .find((entry) => matchesSearchText(entry.searchText, query, mode));
    if (!matchEntry) {
      continue;
    }

    const contextEntries = includeAroundMatches
      ? detail.blocks
        .map((block, index) => ({ block, index }))
        .slice(Math.max(0, matchEntry.index - window), Math.min(detail.blocks.length, matchEntry.index + window + 1))
      : [];

    matches.push({
      conversationId: session.id,
      title: session.title,
      cwd: session.cwd,
      lastActivityAt: session.lastActivityAt,
      isLive: session.isLive,
      isRunning: session.isRunning,
      blockId: matchEntry.block.id,
      blockType: matchEntry.block.type as ConversationInspectBlockType,
      blockIndex: matchEntry.index,
      snippet: extractQuerySnippet(matchEntry.searchText, query, mode, maxSnippetCharacters),
      ...(includeAroundMatches ? { contextBlocks: sanitizeBlocks(contextEntries, maxCharactersPerBlock) } : {}),
    });
  }

  const returned = matches.slice(0, limit);

  return {
    query,
    mode,
    scope,
    totalMatching: matches.length,
    returnedCount: returned.length,
    matches: returned,
  };
}

export function formatConversationInspectSearchResult(result: SearchConversationInspectResult): string {
  if (result.matches.length === 0) {
    return `No conversations matched transcript search ${JSON.stringify(result.query)} mode=${result.mode} within scope=${result.scope}.`;
  }

  return [
    `Transcript search (${result.returnedCount}/${result.totalMatching}) for ${JSON.stringify(result.query)} mode=${result.mode} scope=${result.scope}:`,
    ...result.matches.flatMap((match) => {
      const header = `- ${match.conversationId} [${match.isRunning ? 'running' : match.isLive ? 'live' : 'archived'}] ${match.title} · ${match.cwd} · block ${match.blockId} (${match.blockType})\n  ${match.snippet}`;
      if (!match.contextBlocks || match.contextBlocks.length === 0) {
        return [header];
      }
      return [
        header,
        ...match.contextBlocks.map((block) => formatInspectableBlock(block).split('\n').map((line) => `  ${line}`).join('\n')),
      ];
    }),
  ].join('\n');
}

export function queryConversationInspectBlocks(input: {
  conversationId?: unknown;
  types?: unknown;
  roles?: unknown;
  tools?: unknown;
  text?: unknown;
  searchMode?: unknown;
  afterBlockId?: unknown;
  beforeBlockId?: unknown;
  aroundBlockId?: unknown;
  window?: unknown;
  includeAroundMatches?: unknown;
  order?: unknown;
  limit?: unknown;
  maxCharactersPerBlock?: unknown;
}): QueryConversationInspectResult {
  const resolved = resolveConversationSession(input.conversationId);
  const window = normalizePositiveInteger(input.window, DEFAULT_WINDOW, MAX_WINDOW);
  const order = normalizeOrder(input.order);
  const limit = normalizePositiveInteger(input.limit, DEFAULT_BLOCK_LIMIT, MAX_BLOCK_LIMIT);
  const maxCharactersPerBlock = normalizePositiveInteger(
    input.maxCharactersPerBlock,
    DEFAULT_MAX_CHARACTERS_PER_BLOCK,
    MAX_MAX_CHARACTERS_PER_BLOCK,
  );

  const filtered = applyBlockFilters(resolved.blocks, {
    afterBlockId: readOptionalString(input.afterBlockId),
    beforeBlockId: readOptionalString(input.beforeBlockId),
    aroundBlockId: readOptionalString(input.aroundBlockId),
    window,
    types: normalizeBlockTypes(input.types),
    roles: normalizeRoles(input.roles),
    tools: normalizeStringArray(input.tools),
    text: readOptionalString(input.text),
    searchMode: normalizeSearchMode(input.searchMode),
    includeAroundMatches: readOptionalBoolean(input.includeAroundMatches) ?? false,
  });

  const ordered = order === 'desc'
    ? [...filtered].reverse()
    : filtered;
  const returned = ordered.slice(0, limit);
  const sanitized = sanitizeBlocks(returned, maxCharactersPerBlock);

  return {
    conversationId: resolved.conversationId,
    title: resolved.title,
    cwd: resolved.cwd,
    signature: resolved.signature,
    totalBlocks: resolved.blocks.length,
    matchingBlocks: filtered.length,
    returnedBlocks: sanitized.length,
    firstReturnedBlockId: sanitized[0]?.id ?? null,
    lastReturnedBlockId: sanitized[sanitized.length - 1]?.id ?? null,
    order,
    blocks: sanitized,
  };
}

export function formatConversationInspectQueryResult(result: QueryConversationInspectResult): string {
  if (result.blocks.length === 0) {
    return `No transcript blocks matched in ${result.conversationId} (${result.title}).`;
  }

  return [
    `Conversation ${result.conversationId} — ${result.title}`,
    `cwd: ${result.cwd}`,
    `signature: ${result.signature ?? 'none'}`,
    `blocks: ${result.returnedBlocks}/${result.matchingBlocks} matched (total ${result.totalBlocks}, order ${result.order})`,
    '',
    ...result.blocks.flatMap((block, index) => index === 0 ? [formatInspectableBlock(block)] : ['', formatInspectableBlock(block)]),
  ].join('\n');
}

function blockPreview(block: DisplayBlock, maxCharacters = 240): string {
  return truncateText(buildBlockSearchText(block).replace(/\s+/g, ' ').trim(), maxCharacters).text;
}

function pushUniqueAnchor(
  anchors: ConversationInspectOutlineAnchor[],
  seen: Set<string>,
  block: DisplayBlock,
  index: number,
  label: string,
): void {
  if (seen.has(block.id)) {
    return;
  }
  if (block.type !== 'user' && block.type !== 'summary') {
    return;
  }

  seen.add(block.id);
  anchors.push({
    blockId: block.id,
    blockIndex: index,
    type: block.type,
    label,
    preview: blockPreview(block),
  });
}

export function outlineConversationInspectSession(input: {
  conversationId?: unknown;
  maxSnippetCharacters?: unknown;
}): ConversationInspectOutlineResult {
  const resolved = resolveConversationSession(input.conversationId);
  const maxSnippetCharacters = normalizePositiveInteger(input.maxSnippetCharacters, 240, 2_000);
  const summary = readConversationSummary(resolved.conversationId);
  const anchors: ConversationInspectOutlineAnchor[] = [];
  const seen = new Set<string>();
  const userBlocks = resolved.blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => entry.block.type === 'user');

  const firstUser = userBlocks[0];
  if (firstUser) {
    pushUniqueAnchor(anchors, seen, firstUser.block, firstUser.index, 'first user prompt');
  }

  for (const entry of resolved.blocks.map((block, index) => ({ block, index }))) {
    if (entry.block.type === 'summary') {
      pushUniqueAnchor(anchors, seen, entry.block, entry.index, entry.block.title);
    }
  }

  for (const entry of userBlocks.slice(-3)) {
    pushUniqueAnchor(anchors, seen, entry.block, entry.index, 'recent user prompt');
  }

  return {
    conversationId: resolved.conversationId,
    title: resolved.title,
    cwd: resolved.cwd,
    signature: resolved.signature,
    totalBlocks: resolved.blocks.length,
    ...(summary?.displaySummary ? { cachedPreview: truncateText(summary.displaySummary, maxSnippetCharacters).text } : {}),
    anchors: anchors.map((anchor) => ({
      ...anchor,
      preview: truncateText(anchor.preview, maxSnippetCharacters).text,
    })),
  };
}

export function formatConversationInspectOutlineResult(result: ConversationInspectOutlineResult): string {
  return [
    `Conversation ${result.conversationId} — ${result.title}`,
    `cwd: ${result.cwd}`,
    `signature: ${result.signature ?? 'none'}`,
    `blocks: ${result.totalBlocks}`,
    ...(result.cachedPreview ? ['', `Cached preview: ${result.cachedPreview}`] : []),
    '',
    result.anchors.length > 0 ? 'Anchors:' : 'No outline anchors found.',
    ...result.anchors.map((anchor) => `- [${anchor.blockIndex}] ${anchor.blockId} · ${anchor.type} · ${anchor.label}\n  ${anchor.preview}`),
  ].join('\n');
}

export function readWindowConversationInspectBlocks(input: {
  conversationId?: unknown;
  aroundBlockId?: unknown;
  window?: unknown;
  maxCharactersPerBlock?: unknown;
}): QueryConversationInspectResult {
  return queryConversationInspectBlocks({
    conversationId: input.conversationId,
    aroundBlockId: input.aroundBlockId,
    window: input.window,
    order: 'asc',
    limit: normalizePositiveInteger(input.window, DEFAULT_WINDOW, MAX_WINDOW) * 2 + 1,
    maxCharactersPerBlock: input.maxCharactersPerBlock,
  });
}

export function diffConversationInspectBlocks(input: {
  conversationId?: unknown;
  knownSignature?: unknown;
  afterBlockId?: unknown;
  types?: unknown;
  roles?: unknown;
  tools?: unknown;
  text?: unknown;
  searchMode?: unknown;
  limit?: unknown;
  maxCharactersPerBlock?: unknown;
}): DiffConversationInspectResult {
  const resolved = resolveConversationSession(input.conversationId);
  const knownSignature = readOptionalString(input.knownSignature);
  if (knownSignature && resolved.signature && knownSignature === resolved.signature) {
    return {
      conversationId: resolved.conversationId,
      title: resolved.title,
      cwd: resolved.cwd,
      signature: resolved.signature,
      unchanged: true,
      totalBlocks: resolved.blocks.length,
      matchingBlocks: 0,
      returnedBlocks: 0,
      firstReturnedBlockId: null,
      lastReturnedBlockId: null,
      blocks: [],
    };
  }

  const limit = normalizePositiveInteger(input.limit, DEFAULT_BLOCK_LIMIT, MAX_BLOCK_LIMIT);
  const maxCharactersPerBlock = normalizePositiveInteger(
    input.maxCharactersPerBlock,
    DEFAULT_MAX_CHARACTERS_PER_BLOCK,
    MAX_MAX_CHARACTERS_PER_BLOCK,
  );

  const filtered = applyBlockFilters(resolved.blocks, {
    afterBlockId: readOptionalString(input.afterBlockId),
    beforeBlockId: undefined,
    aroundBlockId: undefined,
    window: DEFAULT_WINDOW,
    types: normalizeBlockTypes(input.types),
    roles: normalizeRoles(input.roles),
    tools: normalizeStringArray(input.tools),
    text: readOptionalString(input.text),
    searchMode: normalizeSearchMode(input.searchMode),
    includeAroundMatches: false,
  });

  const returned = filtered.length > limit
    ? filtered.slice(filtered.length - limit)
    : filtered;
  const sanitized = sanitizeBlocks(returned, maxCharactersPerBlock);

  return {
    conversationId: resolved.conversationId,
    title: resolved.title,
    cwd: resolved.cwd,
    signature: resolved.signature,
    unchanged: false,
    totalBlocks: resolved.blocks.length,
    matchingBlocks: filtered.length,
    returnedBlocks: sanitized.length,
    firstReturnedBlockId: sanitized[0]?.id ?? null,
    lastReturnedBlockId: sanitized[sanitized.length - 1]?.id ?? null,
    blocks: sanitized,
  };
}

export function formatConversationInspectDiffResult(result: DiffConversationInspectResult): string {
  if (result.unchanged) {
    return `Conversation ${result.conversationId} is unchanged (signature ${result.signature ?? 'none'}).`;
  }

  if (result.blocks.length === 0) {
    return `Conversation ${result.conversationId} changed, but no blocks matched the requested diff filters.`;
  }

  return [
    `Conversation ${result.conversationId} — ${result.title}`,
    `cwd: ${result.cwd}`,
    `signature: ${result.signature ?? 'none'}`,
    `diff blocks: ${result.returnedBlocks}/${result.matchingBlocks} matched (total ${result.totalBlocks})`,
    '',
    ...result.blocks.flatMap((block, index) => index === 0 ? [formatInspectableBlock(block)] : ['', formatInspectableBlock(block)]),
  ].join('\n');
}
