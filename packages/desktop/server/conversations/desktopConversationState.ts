import { readSessionDetailForRoute } from './conversationService.js';
import { inlineConversationSessionDetailAssetsCapability } from './conversationSessionAssetCapability.js';
import { readConversationSessionMetaCapability } from './conversationSessionCapability.js';
import type {
  LiveContextUsage,
  LiveSessionPresenceState,
  LiveSessionStateSnapshot,
  ParallelPromptPreview,
  QueuedPromptPreview,
  SseEvent,
} from './liveSessions.js';
import { readLiveSessionStateSnapshot } from './liveSessions.js';
import { normalizeTranscriptToolName } from './toolNames.js';

export interface DesktopConversationMessageBlock {
  type: 'user' | 'text' | 'context' | 'summary' | 'thinking' | 'tool_use' | 'image' | 'error';
  id?: string;
  ts: string;
  text?: string;
  images?: Array<{
    alt: string;
    src?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    caption?: string;
    deferred?: boolean;
  }>;
  customType?: string;
  kind?: 'compaction' | 'branch' | 'related';
  title?: string;
  detail?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  durationMs?: number;
  status?: 'running' | 'ok' | 'error';
  error?: boolean;
  _toolCallId?: string;
  details?: unknown;
  outputDeferred?: boolean;
  alt?: string;
  src?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  caption?: string;
  deferred?: boolean;
  message?: string;
}

export interface DesktopConversationStreamState {
  blocks: DesktopConversationMessageBlock[];
  blockOffset: number;
  totalBlocks: number;
  hasSnapshot: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  error: string | null;
  title: string | null;
  tokens: { input: number; output: number; total: number } | null;
  cost: number | null;
  contextUsage: LiveContextUsage | null;
  pendingQueue: { steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] };
  parallelJobs: ParallelPromptPreview[];
  presence: LiveSessionPresenceState;
  goalState: import('./sessions.js').ThreadGoal | null;
  systemPrompt: string | null;
  toolDefinitions: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  cwdChange: { newConversationId: string; cwd: string; autoContinued: boolean } | null;
}

export interface DesktopConversationState {
  conversationId: string;
  sessionDetail: {
    meta: unknown;
    blocks: unknown[];
    blockOffset: number;
    totalBlocks: number;
    contextUsage: LiveContextUsage | null;
    signature?: string;
  } | null;
  liveSession:
    | { live: false }
    | {
        live: true;
        id: string;
        cwd: string;
        sessionFile: string;
        title?: string;
        isStreaming: boolean;
        hasStaleTurnState?: boolean;
      };
  stream: DesktopConversationStreamState;
}

export function createEmptyDesktopConversationStreamState(): DesktopConversationStreamState {
  return {
    blocks: [],
    blockOffset: 0,
    totalBlocks: 0,
    hasSnapshot: false,
    isStreaming: false,
    isCompacting: false,
    error: null,
    title: null,
    tokens: null,
    cost: null,
    contextUsage: null,
    pendingQueue: { steering: [], followUp: [] },
    parallelJobs: [],
    presence: {
      surfaces: [],
      controllerSurfaceId: null,
      controllerSurfaceType: null,
      controllerAcquiredAt: null,
    },
    cwdChange: null,
    goalState: null,
    systemPrompt: null,
    toolDefinitions: [],
  };
}

const TERMINAL_BASH_DISPLAY_MODE = 'terminal';
const GOAL_TOOL_NAMES = new Set(['set_goal', 'update_goal']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeGoalStatus(value: unknown): import('./sessions.js').ThreadGoal['status'] {
  if (typeof value === 'string' && ['active', 'paused', 'complete'].includes(value)) {
    return value as import('./sessions.js').ThreadGoal['status'];
  }
  return 'complete';
}

function readGoalStateFromToolDetails(
  toolName: string | undefined,
  details: unknown,
): import('./sessions.js').ThreadGoal | null | undefined {
  if (!toolName || !GOAL_TOOL_NAMES.has(toolName) || !isRecord(details) || !isRecord(details.state)) {
    return undefined;
  }
  const state = details.state;
  if (typeof state.objective !== 'string') {
    return undefined;
  }
  const status = normalizeGoalStatus(state.status);
  if (!state.objective.trim() || status === 'complete') {
    return null;
  }
  return {
    objective: state.objective,
    status,
    tasks: [],
    stopReason: typeof state.stopReason === 'string' ? state.stopReason : null,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null,
  };
}

function findLastToolUseIndex(blocks: DesktopConversationMessageBlock[], toolCallId: string): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.type === 'tool_use' && block._toolCallId === toolCallId) {
      return index;
    }
  }

  return -1;
}

function readLiveTerminalBashDetails(
  toolName: string | undefined,
  args: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (toolName !== 'bash' || !args || args.displayMode !== TERMINAL_BASH_DISPLAY_MODE) {
    return null;
  }

  return {
    displayMode: TERMINAL_BASH_DISPLAY_MODE,
    ...(args.excludeFromContext === true ? { excludeFromContext: true } : {}),
  };
}

function displayBlockToMessageBlock(block: {
  type: string;
  id?: string;
  ts: string;
  text?: string;
  images?: unknown;
  customType?: string;
  kind?: 'compaction' | 'branch' | 'related';
  title?: string;
  detail?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  durationMs?: number;
  toolCallId?: string;
  details?: unknown;
  outputDeferred?: boolean;
  alt?: string;
  src?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  caption?: string;
  deferred?: boolean;
  message?: string;
}): DesktopConversationMessageBlock {
  switch (block.type) {
    case 'user':
      return {
        type: 'user',
        id: block.id,
        text: block.text ?? '',
        images: Array.isArray(block.images) ? (block.images as DesktopConversationMessageBlock['images']) : undefined,
        ts: block.ts,
      };
    case 'text':
      return { type: 'text', id: block.id, text: block.text ?? '', ts: block.ts };
    case 'context':
      return { type: 'context', id: block.id, text: block.text ?? '', customType: block.customType, ts: block.ts };
    case 'thinking':
      return { type: 'thinking', id: block.id, text: block.text ?? '', ts: block.ts };
    case 'summary':
      return {
        type: 'summary',
        id: block.id,
        kind: block.kind,
        title: block.title,
        text: block.text ?? '',
        detail: block.detail,
        ts: block.ts,
      };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        tool: normalizeTranscriptToolName(block.tool ?? 'unknown'),
        input: block.input,
        output: block.output,
        durationMs: block.durationMs,
        details: block.details,
        outputDeferred: block.outputDeferred,
        ts: block.ts,
        _toolCallId: block.toolCallId,
      };
    case 'image':
      return {
        type: 'image',
        id: block.id,
        alt: block.alt,
        src: block.src,
        mimeType: block.mimeType,
        width: block.width,
        height: block.height,
        caption: block.caption,
        deferred: block.deferred,
        ts: block.ts,
      };
    case 'error':
      return { type: 'error', id: block.id, tool: block.tool, message: block.message ?? '', ts: block.ts };
    default:
      return { type: 'text', id: block.id, text: block.text ?? '', ts: block.ts };
  }
}

export function createDesktopConversationStreamStateFromSnapshot(snapshot: LiveSessionStateSnapshot): DesktopConversationStreamState {
  const state = {
    blocks: snapshot.blocks.map((block) => displayBlockToMessageBlock(block)),
    blockOffset: snapshot.blockOffset,
    totalBlocks: snapshot.totalBlocks,
    hasSnapshot: snapshot.hasSnapshot,
    isStreaming: snapshot.isStreaming,
    isCompacting: snapshot.isCompacting,
    error: snapshot.error,
    title: snapshot.title,
    tokens: snapshot.tokens,
    cost: snapshot.cost,
    contextUsage: snapshot.contextUsage,
    pendingQueue: snapshot.pendingQueue,
    parallelJobs: snapshot.parallelJobs,
    presence: snapshot.presence,
    cwdChange: snapshot.cwdChange,
    systemPrompt: snapshot.systemPrompt,
    toolDefinitions: snapshot.toolDefinitions,
    autoModeState: null,
    ...(snapshot.goalState ? { goalState: snapshot.goalState } : {}),
  };
  return state as DesktopConversationStreamState;
}

export function applyDesktopConversationStreamEvent(prev: DesktopConversationStreamState, event: SseEvent): DesktopConversationStreamState {
  const blocks = [...prev.blocks];

  switch (event.type) {
    case 'snapshot': {
      const snapshotBlocks = event.blocks.map((block) => displayBlockToMessageBlock(block));
      return {
        ...prev,
        blocks: snapshotBlocks,
        blockOffset: event.blockOffset,
        totalBlocks: event.totalBlocks,
        hasSnapshot: true,
        // Use the server's streaming state — snapshot events include
        // isStreaming from the live session. Previously this was
        // hardcoded to false, which caused the submit button to flip
        // from Steer to Send/Follow up on every reconnection cycle.
        isStreaming: 'isStreaming' in event ? event.isStreaming === true : prev.isStreaming,
        isCompacting: false,
        error: null,
        goalState: 'goalState' in event ? (event.goalState as import('./sessions.js').ThreadGoal | null) : prev.goalState,
        systemPrompt: 'systemPrompt' in event ? (event.systemPrompt ?? null) : prev.systemPrompt,
        toolDefinitions: 'toolDefinitions' in event ? (event.toolDefinitions ?? []) : prev.toolDefinitions,
      };
    }

    case 'compaction_start':
      return { ...prev, isCompacting: true };

    case 'compaction_end':
      if (event.errorMessage) {
        blocks.push({ type: 'error', message: event.errorMessage, ts: new Date().toISOString() });
        return {
          ...prev,
          blocks,
          totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length),
          isCompacting: false,
          error: event.errorMessage,
        };
      }
      return { ...prev, isCompacting: false };

    case 'agent_start':
      return { ...prev, isStreaming: true, error: null };

    case 'agent_end':
    case 'turn_end':
      return { ...prev, isStreaming: false };

    case 'cwd_changed':
      return {
        ...prev,
        cwdChange: {
          newConversationId: event.newConversationId,
          cwd: event.cwd,
          autoContinued: event.autoContinued,
        },
      };

    case 'user_message': {
      const nextBlock = displayBlockToMessageBlock(event.block);
      const last = blocks.at(-1);
      const sameUserBlock =
        last?.type === 'user' &&
        nextBlock.type === 'user' &&
        (last.text ?? '') === (nextBlock.text ?? '') &&
        desktopUserBlockImagesMatch(last.images ?? [], nextBlock.images ?? []);
      if (sameUserBlock) {
        blocks[blocks.length - 1] = nextBlock;
      } else {
        blocks.push(nextBlock);
      }
      return {
        ...prev,
        blocks,
        totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length),
      };
    }

    case 'queue_state':
      return { ...prev, pendingQueue: { steering: event.steering, followUp: event.followUp } };

    case 'parallel_state':
      return { ...prev, parallelJobs: event.jobs };

    case 'presence_state':
      return { ...prev, presence: event.state };

    case 'text_delta': {
      const last = blocks.at(-1);
      if (last?.type === 'text') {
        blocks[blocks.length - 1] = { ...last, text: `${last.text ?? ''}${event.delta}` };
      } else {
        blocks.push({ type: 'text', text: event.delta, ts: new Date().toISOString() });
      }
      return {
        ...prev,
        blocks,
        totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length),
      };
    }

    case 'thinking_delta': {
      const last = blocks.at(-1);
      if (last?.type === 'thinking') {
        blocks[blocks.length - 1] = { ...last, text: `${last.text ?? ''}${event.delta}` };
      } else {
        blocks.push({ type: 'thinking', text: event.delta, ts: new Date().toISOString() });
      }
      return {
        ...prev,
        blocks,
        totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length),
      };
    }

    case 'tool_start': {
      const input = (event.args ?? {}) as Record<string, unknown>;
      const toolName = normalizeTranscriptToolName(event.toolName);
      const details = readLiveTerminalBashDetails(toolName, input);
      blocks.push({
        type: 'tool_use',
        tool: toolName,
        input,
        output: '',
        status: 'running',
        ts: new Date().toISOString(),
        _toolCallId: event.toolCallId,
        ...(details ? { details } : {}),
      });
      return {
        ...prev,
        blocks,
        totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length),
      };
    }

    case 'tool_update': {
      const index = findLastToolUseIndex(blocks, event.toolCallId);
      if (index >= 0) {
        const block = blocks[index];
        const partialResult = event.partialResult as { content?: Array<{ text?: string }> } | string | undefined;
        const partialText = typeof partialResult === 'string' ? partialResult : (partialResult?.content?.[0]?.text ?? '');
        blocks[index] = {
          ...block,
          output: `${block.output ?? ''}${partialText}`,
        };
      }
      return {
        ...prev,
        blocks,
        totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length),
      };
    }

    case 'tool_end': {
      const index = findLastToolUseIndex(blocks, event.toolCallId);
      if (index >= 0) {
        const block = blocks[index];
        blocks[index] = {
          ...block,
          output: event.output,
          status: event.isError ? 'error' : 'ok',
          durationMs: event.durationMs,
          details: event.details ?? block.details,
        };
      }
      const goalState = readGoalStateFromToolDetails(normalizeTranscriptToolName(event.toolName), event.details);
      return {
        ...prev,
        blocks,
        totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length),
        ...(goalState !== undefined ? { goalState } : {}),
      };
    }

    case 'title_update':
      return { ...prev, title: event.title };

    case 'context_usage':
      return { ...prev, contextUsage: event.usage };

    case 'stats_update':
      return { ...prev, tokens: event.tokens, cost: event.cost };

    case 'error':
      blocks.push({ type: 'error', message: event.message, ts: new Date().toISOString() });
      return {
        ...prev,
        blocks,
        totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length),
        isStreaming: false,
        error: event.message,
      };

    default:
      return prev;
  }
}

function desktopUserBlockImagesMatch(
  previousImages: NonNullable<DesktopConversationMessageBlock['images']>,
  nextImages: NonNullable<DesktopConversationMessageBlock['images']>,
): boolean {
  return (
    previousImages.length === nextImages.length &&
    nextImages.every((image, index) => {
      const previousImage = previousImages[index];
      return (
        Boolean(previousImage) &&
        (previousImage.src ?? '') === (image.src ?? '') &&
        (previousImage.mimeType?.trim().toLowerCase() ?? '') === (image.mimeType?.trim().toLowerCase() ?? '') &&
        (previousImage.caption ?? '') === (image.caption ?? '') &&
        (previousImage.alt ?? '') === (image.alt ?? '')
      );
    })
  );
}

export async function readDesktopConversationState(input: {
  conversationId: string;
  profile: string;
  tailBlocks?: number;
}): Promise<DesktopConversationState> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new Error('conversationId required');
  }
  const tailBlocks =
    typeof input.tailBlocks === 'number' && Number.isSafeInteger(input.tailBlocks) && input.tailBlocks > 0
      ? Math.min(10000, input.tailBlocks)
      : undefined;

  const sessionMeta = readConversationSessionMetaCapability(conversationId);
  const liveSession = sessionMeta?.isLive ? readLiveSessionStateSnapshot(conversationId, tailBlocks) : null;

  if (liveSession && sessionMeta) {
    return {
      conversationId,
      sessionDetail: {
        meta: sessionMeta,
        blocks: [],
        blockOffset: liveSession.blockOffset,
        totalBlocks: liveSession.totalBlocks,
        contextUsage: liveSession.contextUsage,
      },
      liveSession: {
        live: true,
        id: conversationId,
        cwd: sessionMeta.cwd,
        sessionFile: sessionMeta.file,
        ...(liveSession.title ? { title: liveSession.title } : {}),
        isStreaming: liveSession.isStreaming,
        hasStaleTurnState: liveSession.hasStaleTurnState,
      },
      stream: createDesktopConversationStreamStateFromSnapshot(liveSession),
    };
  }

  const { sessionRead } = await readSessionDetailForRoute({
    conversationId,
    profile: input.profile,
    tailBlocks,
  });

  if (!sessionRead.detail) {
    return {
      conversationId,
      sessionDetail: null,
      liveSession: { live: false },
      stream: createEmptyDesktopConversationStreamState(),
    };
  }

  const detail = inlineConversationSessionDetailAssetsCapability(conversationId, sessionRead.detail);
  return {
    conversationId,
    sessionDetail: detail,
    liveSession: { live: false },
    stream: createEmptyDesktopConversationStreamState(),
  };
}
