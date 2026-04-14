export interface CompatDisplayImage {
  alt: string;
  src?: string;
  mimeType?: string;
  caption?: string;
}

export type CompatDisplayBlock =
  | { type: 'user'; id: string; ts: string; text: string; images?: CompatDisplayImage[] }
  | { type: 'text'; id: string; ts: string; text: string }
  | { type: 'context'; id: string; ts: string; text: string; customType?: string }
  | { type: 'summary'; id: string; ts: string; kind: 'compaction' | 'branch'; title: string; text: string; detail?: string }
  | { type: 'thinking'; id: string; ts: string; text: string }
  | { type: 'tool_use'; id: string; ts: string; tool: string; input: Record<string, unknown>; output: string; durationMs?: number; toolCallId: string; details?: unknown; outputDeferred?: boolean }
  | { type: 'image'; id: string; ts: string; alt: string; src?: string; mimeType?: string; width?: number; height?: number; caption?: string; deferred?: boolean }
  | { type: 'error'; id: string; ts: string; tool?: string; message: string };

export interface CompatSessionMeta {
  id: string;
  file: string;
  timestamp: string;
  cwd: string;
  cwdSlug: string;
  model: string;
  title: string;
  messageCount: number;
  isRunning?: boolean;
  isLive?: boolean;
  lastActivityAt?: string;
  parentSessionFile?: string;
  parentSessionId?: string;
  sourceRunId?: string;
}

export interface CompatSessionDetail {
  meta: CompatSessionMeta;
  blocks: CompatDisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  contextUsage: unknown;
  signature?: string;
}

export type CodexThreadStatus =
  | { type: 'notLoaded' }
  | { type: 'idle' }
  | { type: 'systemError' }
  | { type: 'active'; activeFlags: string[] };

export type CodexUserInput =
  | { type: 'text'; text: string; textElements: Array<{ start: number; end: number; kind?: string }> }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string }
  | { type: 'skill'; name: string; path: string }
  | { type: 'mention'; name: string; path: string };

export type CodexThreadItem =
  | { type: 'userMessage'; id: string; content: CodexUserInput[] }
  | { type: 'agentMessage'; id: string; text: string; phase: string | null; memoryCitation: unknown }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | { type: 'dynamicToolCall'; id: string; tool: string; arguments: unknown; status: 'inProgress' | 'completed' | 'failed'; contentItems: Array<{ type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string }> | null; success: boolean | null; durationMs: number | null };

export interface CodexTurnError {
  message: string;
  codexErrorInfo: unknown;
  additionalDetails: string | null;
}

export interface CodexTurn {
  id: string;
  items: CodexThreadItem[];
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: CodexTurnError | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export interface CodexThread {
  id: string;
  forkedFromId: string | null;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: CodexThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: string;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: unknown;
  name: string | null;
  turns: CodexTurn[];
}

function toUnixSeconds(value: string | undefined): number {
  if (!value) {
    return Math.floor(Date.now() / 1000);
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return Math.floor(Date.now() / 1000);
  }

  return Math.floor(parsed / 1000);
}

function toIsoStringFromSeconds(value: number | null | undefined, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }

  return fallback;
}

function buildPreview(blocks: CompatDisplayBlock[], fallback: string): string {
  for (const block of blocks) {
    if ((block.type === 'user' || block.type === 'text') && block.text.trim().length > 0) {
      return block.text.trim();
    }
  }

  return fallback;
}

function codexStatusFromSession(detail: CompatSessionDetail): CodexThreadStatus {
  if (detail.meta.isRunning || detail.meta.isLive) {
    return { type: 'active', activeFlags: [] };
  }

  return { type: 'idle' };
}

function blockToThreadItem(block: CompatDisplayBlock): CodexThreadItem | null {
  switch (block.type) {
    case 'user':
      return {
        type: 'userMessage',
        id: block.id,
        content: [{ type: 'text', text: block.text, textElements: [] }],
      };
    case 'text':
      return {
        type: 'agentMessage',
        id: block.id,
        text: block.text,
        phase: null,
        memoryCitation: null,
      };
    case 'thinking':
      return {
        type: 'reasoning',
        id: block.id,
        summary: [],
        content: [block.text],
      };
    case 'tool_use':
      return {
        type: 'dynamicToolCall',
        id: block.id,
        tool: block.tool,
        arguments: block.input,
        status: 'completed',
        contentItems: block.output.length > 0 ? [{ type: 'inputText', text: block.output }] : [],
        success: true,
        durationMs: typeof block.durationMs === 'number' ? block.durationMs : null,
      };
    case 'error':
      return null;
    case 'context':
    case 'summary':
    case 'image':
      return {
        type: 'agentMessage',
        id: block.id,
        text: 'text' in block ? block.text : block.alt,
        phase: null,
        memoryCitation: null,
      };
    default:
      return null;
  }
}

function threadItemToBlock(item: CodexThreadItem, timestamp: string): CompatDisplayBlock | null {
  switch (item.type) {
    case 'userMessage': {
      const parts = item.content
        .filter((entry): entry is Extract<CodexUserInput, { type: 'text' }> => entry.type === 'text')
        .map((entry) => entry.text.trim())
        .filter((entry) => entry.length > 0);
      return {
        type: 'user',
        id: item.id,
        ts: timestamp,
        text: parts.join('\n\n'),
      };
    }
    case 'agentMessage':
      return {
        type: 'text',
        id: item.id,
        ts: timestamp,
        text: item.text,
      };
    case 'reasoning':
      return {
        type: 'thinking',
        id: item.id,
        ts: timestamp,
        text: item.content.join('\n\n'),
      };
    case 'dynamicToolCall':
      return {
        type: 'tool_use',
        id: item.id,
        ts: timestamp,
        tool: item.tool,
        input: (item.arguments ?? {}) as Record<string, unknown>,
        output: (item.contentItems ?? []).reduce((result, entry) => {
          if (entry.type === 'inputText') {
            return result + entry.text;
          }
          return result;
        }, ''),
        durationMs: item.durationMs ?? undefined,
        toolCallId: item.id,
      };
    default:
      return null;
  }
}

function finalizeTurn(turnId: string, blocks: CompatDisplayBlock[]): CodexTurn | null {
  if (blocks.length === 0) {
    return null;
  }

  const startedAt = toUnixSeconds(blocks[0]?.ts);
  const completedAt = toUnixSeconds(blocks[blocks.length - 1]?.ts);
  const errorBlock = blocks.find((block): block is Extract<CompatDisplayBlock, { type: 'error' }> => block.type === 'error') ?? null;
  const items = blocks
    .map((block) => blockToThreadItem(block))
    .filter((item): item is CodexThreadItem => item !== null);

  return {
    id: turnId,
    items,
    status: errorBlock ? 'failed' : 'completed',
    error: errorBlock
      ? {
          message: errorBlock.message,
          codexErrorInfo: null,
          additionalDetails: null,
        }
      : null,
    startedAt,
    completedAt,
    durationMs: Math.max(0, (completedAt - startedAt) * 1000),
  };
}

export function buildCodexThreadFromSessionDetail(input: {
  detail: CompatSessionDetail;
  modelProvider: string;
  cliVersion: string;
}): CodexThread {
  const turns: CodexTurn[] = [];
  let currentBlocks: CompatDisplayBlock[] = [];
  let turnIndex = 1;

  for (const block of input.detail.blocks) {
    if (block.type === 'user' && currentBlocks.length > 0) {
      const turn = finalizeTurn(`${input.detail.meta.id}:turn:${String(turnIndex++)}`, currentBlocks);
      if (turn) {
        turns.push(turn);
      }
      currentBlocks = [];
    }

    currentBlocks.push(block);
  }

  const finalTurn = finalizeTurn(`${input.detail.meta.id}:turn:${String(turnIndex)}`, currentBlocks);
  if (finalTurn) {
    turns.push(finalTurn);
  }

  return {
    id: input.detail.meta.id,
    forkedFromId: null,
    preview: buildPreview(input.detail.blocks, input.detail.meta.title),
    ephemeral: false,
    modelProvider: input.modelProvider,
    createdAt: toUnixSeconds(input.detail.meta.timestamp),
    updatedAt: toUnixSeconds(input.detail.meta.lastActivityAt ?? input.detail.meta.timestamp),
    status: codexStatusFromSession(input.detail),
    path: input.detail.meta.file,
    cwd: input.detail.meta.cwd,
    cliVersion: input.cliVersion,
    source: 'cli',
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: input.detail.meta.title || null,
    turns,
  };
}

export function buildSessionMetaFromCodexThread(input: {
  thread: CodexThread;
  model: string;
}): CompatSessionMeta {
  const fallbackTimestamp = toIsoStringFromSeconds(input.thread.createdAt, new Date().toISOString());
  return {
    id: input.thread.id,
    file: input.thread.path ?? '',
    timestamp: fallbackTimestamp,
    cwd: input.thread.cwd,
    cwdSlug: input.thread.cwd.split('/').filter(Boolean).at(-1) ?? 'workspace',
    model: input.model,
    title: input.thread.name ?? input.thread.preview,
    messageCount: input.thread.turns.reduce((count, turn) => count + turn.items.filter((item) => item.type === 'userMessage').length, 0),
    isRunning: input.thread.status.type === 'active',
    isLive: input.thread.status.type === 'active',
    lastActivityAt: toIsoStringFromSeconds(input.thread.updatedAt, fallbackTimestamp),
  };
}

export function buildSessionDetailFromCodexThread(input: {
  thread: CodexThread;
  model: string;
}): CompatSessionDetail {
  const blocks: CompatDisplayBlock[] = [];
  const meta = buildSessionMetaFromCodexThread(input);

  for (const turn of input.thread.turns) {
    const startedTimestamp = toIsoStringFromSeconds(turn.startedAt, meta.timestamp);
    const completedTimestamp = toIsoStringFromSeconds(turn.completedAt, startedTimestamp);
    for (const item of turn.items) {
      const block = threadItemToBlock(item, item.type === 'agentMessage' ? completedTimestamp : startedTimestamp);
      if (block) {
        blocks.push(block);
      }
    }

    if (turn.error) {
      blocks.push({
        type: 'error',
        id: `${turn.id}:error`,
        ts: completedTimestamp,
        message: turn.error.message,
      });
    }
  }

  return {
    meta: {
      ...meta,
      messageCount: blocks.filter((block) => block.type === 'user').length,
    },
    blocks,
    blockOffset: 0,
    totalBlocks: blocks.length,
    contextUsage: null,
    signature: undefined,
  };
}
