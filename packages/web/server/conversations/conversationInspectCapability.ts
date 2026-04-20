import { sep } from 'node:path';
import {
  listConversationSessionsSnapshot,
  readConversationSessionMeta,
  readConversationSessionSignature,
  resolveConversationSessionFile,
} from './conversationService.js';
import { readSessionBlocksByFile, type DisplayBlock } from './sessions.js';

export const CONVERSATION_INSPECT_SCOPE_VALUES = ['all', 'live', 'running', 'archived'] as const;
export const CONVERSATION_INSPECT_ACTION_VALUES = ['list', 'query', 'diff'] as const;
export const CONVERSATION_INSPECT_ORDER_VALUES = ['asc', 'desc'] as const;
export const CONVERSATION_INSPECT_BLOCK_TYPE_VALUES = ['user', 'text', 'context', 'summary', 'tool_use', 'image', 'error'] as const;

export type ConversationInspectScope = (typeof CONVERSATION_INSPECT_SCOPE_VALUES)[number];
export type ConversationInspectAction = (typeof CONVERSATION_INSPECT_ACTION_VALUES)[number];
export type ConversationInspectOrder = (typeof CONVERSATION_INSPECT_ORDER_VALUES)[number];
export type ConversationInspectBlockType = (typeof CONVERSATION_INSPECT_BLOCK_TYPE_VALUES)[number];

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

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'number'
    ? Math.floor(value)
    : typeof value === 'string' && value.trim().length > 0
      ? Number.parseInt(value.trim(), 10)
      : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(1, Math.min(max, parsed));
}

function normalizeScope(value: unknown): ConversationInspectScope {
  return value === 'live' || value === 'running' || value === 'archived'
    ? value
    : 'all';
}

function normalizeOrder(value: unknown): ConversationInspectOrder {
  return value === 'desc' ? 'desc' : 'asc';
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
    if (!type || !allowed.has(type) || seen.has(type)) {
      continue;
    }

    seen.add(type);
    normalized.push(type as ConversationInspectBlockType);
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
  tools: string[];
  text?: string;
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
    const needle = input.text.toLowerCase();
    indexed = indexed.filter((entry) => buildBlockSearchText(entry.block).toLowerCase().includes(needle));
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
  const scope = normalizeScope(input.scope);
  const cwd = readOptionalString(input.cwd);
  const query = readOptionalString(input.query)?.toLowerCase();
  const includeCurrent = readOptionalBoolean(input.includeCurrent) ?? false;
  const currentConversationId = readOptionalString(input.currentConversationId);
  const limit = normalizePositiveInteger(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

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

  const returned = sessions.slice(0, limit);

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

export function queryConversationInspectBlocks(input: {
  conversationId?: unknown;
  types?: unknown;
  tools?: unknown;
  text?: unknown;
  afterBlockId?: unknown;
  beforeBlockId?: unknown;
  aroundBlockId?: unknown;
  window?: unknown;
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
    tools: normalizeStringArray(input.tools),
    text: readOptionalString(input.text),
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

export function diffConversationInspectBlocks(input: {
  conversationId?: unknown;
  knownSignature?: unknown;
  afterBlockId?: unknown;
  types?: unknown;
  tools?: unknown;
  text?: unknown;
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
    tools: normalizeStringArray(input.tools),
    text: readOptionalString(input.text),
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
