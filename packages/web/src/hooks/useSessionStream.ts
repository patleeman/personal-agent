/**
 * useSessionStream — subscribes to a live Pi session SSE endpoint and builds
 * a growing MessageBlock list in real time.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LiveSessionPresenceState,
  LiveSessionSurfaceType,
  MessageBlock,
  PromptAttachmentRefInput,
  PromptImageInput,
  QueuedPromptPreview,
  SessionContextUsage,
  SseEvent,
} from '../types';
import { api } from '../api';
import { displayBlockToMessageBlock } from '../messageBlocks';
import { parseSkillBlock } from '../skillBlock';

export interface StreamState {
  blocks: MessageBlock[];
  blockOffset: number;
  totalBlocks: number;
  hasSnapshot: boolean;
  isStreaming: boolean;
  error: string | null;
  title: string | null;
  tokens: { input: number; output: number; total: number } | null;
  cost: number | null;
  contextUsage: SessionContextUsage | null;
  pendingQueue: { steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] };
  presence: LiveSessionPresenceState;
}

export function createEmptyLiveSessionPresenceState(): LiveSessionPresenceState {
  return {
    surfaces: [],
    controllerSurfaceId: null,
    controllerSurfaceType: null,
    controllerAcquiredAt: null,
  };
}

export const INITIAL_STREAM_STATE: StreamState = {
  blocks: [],
  blockOffset: 0,
  totalBlocks: 0,
  hasSnapshot: false,
  isStreaming: false,
  error: null,
  title: null,
  tokens: null,
  cost: null,
  contextUsage: null,
  pendingQueue: { steering: [], followUp: [] },
  presence: createEmptyLiveSessionPresenceState(),
};

const SURFACE_STORAGE_KEY = 'pa.live-session.surface-id';
let fallbackSurfaceId: string | null = null;

function createConversationSurfaceId(): string {
  return `surface-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateConversationSurfaceId(): string {
  if (typeof window === 'undefined') {
    fallbackSurfaceId ??= createConversationSurfaceId();
    return fallbackSurfaceId;
  }

  try {
    const existing = window.sessionStorage.getItem(SURFACE_STORAGE_KEY)?.trim();
    if (existing) {
      return existing;
    }

    const created = createConversationSurfaceId();
    window.sessionStorage.setItem(SURFACE_STORAGE_KEY, created);
    return created;
  } catch {
    fallbackSurfaceId ??= createConversationSurfaceId();
    return fallbackSurfaceId;
  }
}

export function detectConversationSurfaceType(): LiveSessionSurfaceType {
  if (typeof window === 'undefined') {
    return 'desktop_web';
  }

  try {
    if (window.matchMedia('(max-width: 768px)').matches || window.matchMedia('(pointer: coarse)').matches) {
      return 'mobile_web';
    }
  } catch {
    // Ignore media-query failures and fall back to desktop.
  }

  return 'desktop_web';
}

let optimisticPendingQueueItemCounter = 0;

function createOptimisticPendingQueueItem(text: string): QueuedPromptPreview {
  optimisticPendingQueueItemCounter += 1;
  return {
    id: `optimistic-${optimisticPendingQueueItemCounter}`,
    text,
    imageCount: 0,
  };
}

export function normalizePendingQueueItems(value: unknown): QueuedPromptPreview[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): QueuedPromptPreview[] => {
    if (typeof item === 'string') {
      return [createOptimisticPendingQueueItem(item)];
    }

    if (!item || typeof item !== 'object') {
      return [];
    }

    const candidate = item as Partial<QueuedPromptPreview>;
    const id = typeof candidate.id === 'string' && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : createOptimisticPendingQueueItem(typeof candidate.text === 'string' ? candidate.text : '').id;
    const text = typeof candidate.text === 'string' && candidate.text.trim().length > 0
      ? candidate.text.trim()
      : '(empty queued prompt)';
    const imageCount = Number.isInteger(candidate.imageCount) && Number(candidate.imageCount) > 0
      ? Number(candidate.imageCount)
      : 0;

    return [{
      id,
      text,
      imageCount,
      ...(typeof candidate.restorable === 'boolean' ? { restorable: candidate.restorable } : {}),
    }];
  });
}

export function appendPendingQueueItem(
  state: StreamState,
  behavior: 'steer' | 'followUp',
  text: string,
): StreamState {
  if (behavior === 'steer') {
    return {
      ...state,
      pendingQueue: {
        ...state.pendingQueue,
        steering: [...state.pendingQueue.steering, createOptimisticPendingQueueItem(text)],
      },
    };
  }

  return {
    ...state,
    pendingQueue: {
      ...state.pendingQueue,
      followUp: [...state.pendingQueue.followUp, createOptimisticPendingQueueItem(text)],
    },
  };
}

export function removePendingQueueItem(
  state: StreamState,
  behavior: 'steer' | 'followUp',
  text: string,
): StreamState {
  const key = behavior === 'steer' ? 'steering' : 'followUp';
  const queue = state.pendingQueue[key];
  const index = queue.findLastIndex((item) => item.text === text);
  if (index < 0) {
    return state;
  }

  return {
    ...state,
    pendingQueue: {
      ...state.pendingQueue,
      [key]: queue.filter((_, itemIndex) => itemIndex !== index),
    },
  };
}

export function removeOptimisticUserBlock(
  state: StreamState,
  optimisticBlockId: string,
): StreamState {
  if (!optimisticBlockId.trim()) {
    return state;
  }

  const blocks = state.blocks.filter((block) => block.id !== optimisticBlockId);
  if (blocks.length === state.blocks.length) {
    return state;
  }

  return {
    ...state,
    blocks,
    totalBlocks: Math.max(0, state.blockOffset + blocks.length),
  };
}

export function selectVisibleStreamState(
  state: StreamState,
  stateSessionId: string | null,
  requestedSessionId: string | null,
): StreamState {
  return stateSessionId === requestedSessionId ? state : INITIAL_STREAM_STATE;
}

function readInvokedSkillName(text: string): string | null {
  const match = text.trim().match(/^\/skill:([^\s]+)/i);
  const skillName = match?.[1]?.trim().toLowerCase();
  return skillName && skillName.length > 0 ? skillName : null;
}

export function shouldReplaceOptimisticUserBlock(previous: MessageBlock | undefined, next: MessageBlock): boolean {
  if (previous?.type !== 'user' || next.type !== 'user') {
    return false;
  }

  const previousSkillName = readInvokedSkillName(previous.text);
  if (!previousSkillName) {
    return false;
  }

  const nextSkillBlock = parseSkillBlock(next.text);
  if (!nextSkillBlock) {
    return false;
  }

  const previousImageCount = previous.images?.length ?? 0;
  const nextImageCount = next.images?.length ?? 0;
  return previousImageCount === nextImageCount && nextSkillBlock.name.trim().toLowerCase() === previousSkillName;
}

export function resolveSessionStreamSubscriptionId(
  sessionId: string | null,
  options?: { enabled?: boolean },
): string | null {
  return options?.enabled === false ? null : sessionId;
}

export function shouldRetrySessionStreamAfterError(status?: number): boolean {
  if (typeof status !== 'number') {
    return true;
  }

  return status >= 500;
}

export function isLiveSessionSurfaceRegistered(presence: LiveSessionPresenceState, surfaceId: string): boolean {
  const normalizedSurfaceId = surfaceId.trim();
  if (!normalizedSurfaceId) {
    return false;
  }

  return presence.surfaces.some((surface) => surface.surfaceId === normalizedSurfaceId);
}

export function isLiveSessionControlError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toLowerCase();

  return normalized.includes('controlled by another surface')
    || normalized.includes('surface id is required to control this conversation')
    || normalized.includes('no surface is currently controlling this conversation')
    || normalized.includes('open the conversation on this surface before taking control');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForSurfaceRegistration(input: {
  surfaceId: string;
  hasSurface: () => boolean;
  reconnect?: () => void;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<boolean> {
  const normalizedSurfaceId = input.surfaceId.trim();
  if (!normalizedSurfaceId) {
    return false;
  }

  if (input.hasSurface()) {
    return true;
  }

  input.reconnect?.();

  const timeoutMs = Math.max(0, input.timeoutMs ?? 1_500);
  const pollMs = Math.max(10, input.pollMs ?? 50);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await wait(pollMs);
    if (input.hasSurface()) {
      return true;
    }
  }

  return input.hasSurface();
}

export async function submitLivePromptWithControlRetry(input: {
  attemptPrompt: () => Promise<void>;
  waitForSurfaceRegistration: () => Promise<boolean>;
  takeOverSessionControl: () => Promise<unknown>;
}): Promise<void> {
  try {
    await input.attemptPrompt();
    return;
  } catch (error) {
    if (!isLiveSessionControlError(error)) {
      throw error;
    }

    const surfaceReady = await input.waitForSurfaceRegistration();
    if (!surfaceReady) {
      throw error;
    }
  }

  await input.takeOverSessionControl();
  await input.attemptPrompt();
}

export function useSessionStream(sessionId: string | null, options?: { tailBlocks?: number; enabled?: boolean }) {
  const [state, setState] = useState<StreamState>(INITIAL_STREAM_STATE);
  const [connectVersion, setConnectVersion] = useState(0);
  // Mutable refs to avoid stale closures in the SSE handler
  const blocksRef = useRef<MessageBlock[]>([]);
  const streamingRef = useRef(false);
  const requestedSessionId = resolveSessionStreamSubscriptionId(sessionId, options);
  const stateSessionIdRef = useRef<string | null>(requestedSessionId);
  const surfaceId = useMemo(() => getOrCreateConversationSurfaceId(), []);
  const surfaceType = useMemo(() => detectConversationSurfaceType(), []);

  const presenceRef = useRef<LiveSessionPresenceState>(createEmptyLiveSessionPresenceState());

  useEffect(() => {
    presenceRef.current = state.presence;
  }, [state.presence]);

  const waitForCurrentSurfaceRegistration = useCallback(() => waitForSurfaceRegistration({
    surfaceId,
    hasSurface: () => isLiveSessionSurfaceRegistered(presenceRef.current, surfaceId),
    reconnect: sessionId
      ? () => {
          setConnectVersion((current) => current + 1);
        }
      : undefined,
  }), [sessionId, surfaceId]);

  const send = useCallback(async (
    text: string,
    behavior?: 'steer' | 'followUp',
    images?: PromptImageInput[],
    attachmentRefs?: PromptAttachmentRefInput[],
  ) => {
    if (!sessionId) return;

    let optimisticUserBlockId: string | null = null;

    if (!behavior) {
      const ts = new Date().toISOString();
      const userBlock: MessageBlock = {
        type: 'user',
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        ts,
        ...(images && images.length > 0
          ? {
              images: images.map((image) => ({
                alt: image.name ?? 'Attached image',
                src: image.previewUrl,
                mimeType: image.mimeType,
                caption: image.name,
              })),
            }
          : {}),
      };
      optimisticUserBlockId = userBlock.id ?? null;
      blocksRef.current = [...blocksRef.current, userBlock];
      setState((s) => ({ ...s, blocks: blocksRef.current }));
    } else {
      setState((s) => appendPendingQueueItem(s, behavior, text));
    }

    try {
      await submitLivePromptWithControlRetry({
        attemptPrompt: () => api.promptSession(sessionId, text, behavior, images, attachmentRefs, surfaceId).then(() => undefined),
        waitForSurfaceRegistration: waitForCurrentSurfaceRegistration,
        takeOverSessionControl: () => api.takeoverLiveSession(sessionId, surfaceId),
      });
    } catch (error) {
      if (behavior) {
        setState((s) => removePendingQueueItem(s, behavior, text));
      } else if (optimisticUserBlockId) {
        setState((s) => {
          const next = removeOptimisticUserBlock(s, optimisticUserBlockId ?? '');
          blocksRef.current = next.blocks;
          return next;
        });
      }
      throw error;
    }
  }, [sessionId, surfaceId, waitForCurrentSurfaceRegistration]);

  const abort = useCallback(async () => {
    if (!sessionId) return;
    await api.abortSession(sessionId, surfaceId);
  }, [sessionId, surfaceId]);

  const takeover = useCallback(async () => {
    if (!sessionId) {
      return;
    }

    const surfaceReady = await waitForCurrentSurfaceRegistration();
    if (!surfaceReady) {
      throw new Error('Unable to confirm this surface is connected yet. Try again in a moment.');
    }

    await api.takeoverLiveSession(sessionId, surfaceId);
  }, [sessionId, surfaceId, waitForCurrentSurfaceRegistration]);

  const reconnect = useCallback(() => {
    if (!sessionId) {
      return;
    }

    setConnectVersion((current) => current + 1);
  }, [sessionId]);

  useEffect(() => {
    stateSessionIdRef.current = requestedSessionId;
    blocksRef.current = [];
    streamingRef.current = false;
    setState(INITIAL_STREAM_STATE);
  }, [requestedSessionId]);

  useEffect(() => {
    if (!requestedSessionId) return;

    let es: EventSource;
    let closed = false;

    function connect() {
      const params = new URLSearchParams();
      if (typeof options?.tailBlocks === 'number' && Number.isInteger(options.tailBlocks) && options.tailBlocks > 0) {
        params.set('tailBlocks', String(options.tailBlocks));
      }
      params.set('surfaceId', surfaceId);
      params.set('surfaceType', surfaceType);
      const query = params.toString();
      es = new EventSource(`/api/live-sessions/${requestedSessionId}/events${query ? `?${query}` : ''}`);

      es.onmessage = (e: MessageEvent<string>) => {
        if (closed) return;
        let event: SseEvent;
        try { event = JSON.parse(e.data) as SseEvent; }
        catch { return; }

        setState(prev => applyEvent(prev, blocksRef, streamingRef, event));
      };

      es.onerror = () => {
        if (closed) return;
        es.close();
        fetch(`/api/live-sessions/${requestedSessionId}`)
          .then((response) => {
            if (!closed && (response.ok || shouldRetrySessionStreamAfterError(response.status))) {
              setTimeout(connect, 2_000);
            }
          })
          .catch(() => {
            if (!closed && shouldRetrySessionStreamAfterError()) {
              setTimeout(connect, 2_000);
            }
          });
      };
    }

    connect();

    return () => {
      closed = true;
      es?.close();
    };
  }, [connectVersion, options?.tailBlocks, requestedSessionId, surfaceId, surfaceType]);

  const visibleState = selectVisibleStreamState(state, stateSessionIdRef.current, requestedSessionId);

  return useMemo(
    () => ({ ...visibleState, surfaceId, takeover, send, abort, reconnect }),
    [visibleState, surfaceId, takeover, send, abort, reconnect],
  );
}

// ── Event → block reducer ─────────────────────────────────────────────────────

export function applyEvent(
  prev: StreamState,
  blocksRef: React.MutableRefObject<MessageBlock[]>,
  streamingRef: React.MutableRefObject<boolean>,
  event: SseEvent,
): StreamState {
  const blocks = [...blocksRef.current];

  switch (event.type) {
    case 'snapshot': {
      const snapshotBlocks = event.blocks.map(displayBlockToMessageBlock);
      streamingRef.current = false;
      blocksRef.current = snapshotBlocks;
      return {
        ...prev,
        blocks: snapshotBlocks,
        blockOffset: event.blockOffset,
        totalBlocks: event.totalBlocks,
        hasSnapshot: true,
        isStreaming: false,
        error: null,
      };
    }

    case 'agent_start': {
      streamingRef.current = true;
      blocksRef.current = blocks;
      return { ...prev, blocks, isStreaming: true, error: null };
    }

    case 'agent_end': {
      streamingRef.current = false;
      blocksRef.current = blocks;
      return { ...prev, blocks, isStreaming: false };
    }

    case 'user_message': {
      const nextBlock = displayBlockToMessageBlock(event.block);
      const last = blocks[blocks.length - 1];
      const lastImageCount = last?.type === 'user' ? last.images?.length ?? 0 : -1;
      const nextImageCount = nextBlock.type === 'user' ? nextBlock.images?.length ?? 0 : -1;
      const sameUserBlock = last?.type === 'user' && nextBlock.type === 'user'
        && last.text === nextBlock.text
        && lastImageCount === nextImageCount;
      const replaceOptimisticUserBlock = shouldReplaceOptimisticUserBlock(last, nextBlock);

      if (sameUserBlock || replaceOptimisticUserBlock) {
        blocks[blocks.length - 1] = nextBlock;
      } else {
        blocks.push(nextBlock);
      }

      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'queue_state': {
      const steering = normalizePendingQueueItems(event.steering);
      const followUp = normalizePendingQueueItems(event.followUp);
      return { ...prev, pendingQueue: { steering, followUp } };
    }

    case 'presence_state': {
      return { ...prev, presence: event.state };
    }

    case 'text_delta': {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'text') {
        blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
      } else {
        blocks.push({ type: 'text', text: event.delta, ts: new Date().toISOString() });
      }
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'thinking_delta': {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'thinking') {
        blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
      } else {
        blocks.push({ type: 'thinking', text: event.delta, ts: new Date().toISOString() });
      }
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'tool_start': {
      const args = (event.args ?? {}) as Record<string, unknown>;
      blocks.push({
        type: 'tool_use',
        tool: event.toolName,
        input: args,
        output: '',
        status: 'running',
        ts: new Date().toISOString(),
        _toolCallId: event.toolCallId,
      } as MessageBlock & { _toolCallId: string });
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'tool_update': {
      const idx = blocks.findLastIndex(
        b => b.type === 'tool_use' && (b as MessageBlock & { _toolCallId?: string })._toolCallId === event.toolCallId,
      );
      if (idx >= 0) {
        const b = blocks[idx] as Extract<MessageBlock, { type: 'tool_use' }>;
        // partialResult from Pi is an AgentToolResult; content[0].text holds the text
        const pr = event.partialResult as { content?: { text?: string }[] } | string | undefined;
        const partial = typeof pr === 'string' ? pr
          : pr?.content?.[0]?.text ?? '';
        blocks[idx] = { ...b, output: (b.output ?? '') + partial };
      }
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'tool_end': {
      const idx = blocks.findLastIndex(
        b => b.type === 'tool_use' && (b as MessageBlock & { _toolCallId?: string })._toolCallId === event.toolCallId,
      );
      if (idx >= 0) {
        const b = blocks[idx] as Extract<MessageBlock, { type: 'tool_use' }>;
        blocks[idx] = {
          ...b,
          output:     event.output,   // replace partial with final
          status:     event.isError ? 'error' : 'ok',
          durationMs: event.durationMs,
          details:    event.details,
        };
      }
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'title_update':
      return { ...prev, title: event.title };

    case 'context_usage':
      return { ...prev, contextUsage: event.usage };

    case 'stats_update':
      return { ...prev, tokens: event.tokens, cost: event.cost };

    case 'error': {
      blocks.push({ type: 'error', message: event.message, ts: new Date().toISOString() });
      blocksRef.current = blocks;
      return {
        ...prev,
        blocks,
        totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length),
        isStreaming: false,
        error: event.message,
      };
    }

    default:
      return prev;
  }
}
