/**
 * useSessionStream — subscribes to a live Pi session SSE endpoint and builds
 * a growing MessageBlock list in real time.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../client/api';
import { createDesktopAwareEventSource, type EventSourceLike } from '../desktop/desktopEventSource';
import { parseSkillBlock } from '../knowledge/skillBlock';
import type {
  ConversationAutoModeState,
  LiveSessionPresenceState,
  LiveSessionSurfaceType,
  MessageBlock,
  ParallelPromptPreview,
  PromptAttachmentRefInput,
  PromptImageInput,
  QueuedPromptPreview,
  SessionContextUsage,
  SseEvent,
} from '../shared/types';
import { displayBlockToMessageBlock } from '../transcript/messageBlocks';
import { clearWarmLiveSessionState, readWarmLiveSessionState, writeWarmLiveSessionState } from '../ui-state/liveSessionWarmth';

export interface StreamState {
  blocks: MessageBlock[];
  blockOffset: number;
  totalBlocks: number;
  hasSnapshot: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  error: string | null;
  title: string | null;
  tokens: { input: number; output: number; total: number } | null;
  cost: number | null;
  contextUsage: SessionContextUsage | null;
  pendingQueue: { steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] };
  parallelJobs: ParallelPromptPreview[];
  presence: LiveSessionPresenceState;
  autoModeState: ConversationAutoModeState | null;
  cwdChange: { newConversationId: string; cwd: string; autoContinued: boolean } | null;
}

const MAX_LIVE_SESSION_TAIL_BLOCKS = 1000;

export function normalizeLiveSessionTailBlocks(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(MAX_LIVE_SESSION_TAIL_BLOCKS, value) : undefined;
}

function createEmptyLiveSessionPresenceState(): LiveSessionPresenceState {
  return {
    surfaces: [],
    controllerSurfaceId: null,
    controllerSurfaceType: null,
    controllerAcquiredAt: null,
  };
}

const INITIAL_STREAM_STATE: StreamState = {
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
  presence: createEmptyLiveSessionPresenceState(),
  autoModeState: null,
  cwdChange: null,
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

function createPendingQueuePreview(
  text: string,
  options: { imageCount?: number; restorable?: boolean; pending?: boolean } = {},
): QueuedPromptPreview {
  optimisticPendingQueueItemCounter += 1;
  return {
    id: `optimistic-${optimisticPendingQueueItemCounter}`,
    text,
    imageCount: Math.max(0, options.imageCount ?? 0),
    ...(typeof options.restorable === 'boolean' ? { restorable: options.restorable } : {}),
    ...(typeof options.pending === 'boolean' ? { pending: options.pending } : {}),
  };
}

function createOptimisticPendingQueueItem(text: string, imageCount = 0): QueuedPromptPreview {
  return createPendingQueuePreview(text, {
    imageCount,
    restorable: false,
    pending: true,
  });
}

export function normalizePendingQueueItems(value: unknown): QueuedPromptPreview[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): QueuedPromptPreview[] => {
    if (typeof item === 'string') {
      return [createPendingQueuePreview(item, { restorable: false })];
    }

    if (!item || typeof item !== 'object') {
      return [];
    }

    const candidate = item as Partial<QueuedPromptPreview>;
    const imageCount =
      typeof candidate.imageCount === 'number' && Number.isSafeInteger(candidate.imageCount) && candidate.imageCount > 0
        ? candidate.imageCount
        : 0;
    const rawText = typeof candidate.text === 'string' ? candidate.text : '';
    const text = rawText.trim().length > 0 ? rawText.trim() : imageCount > 0 ? '' : '(empty queued prompt)';
    const id =
      typeof candidate.id === 'string' && candidate.id.trim().length > 0 ? candidate.id.trim() : createPendingQueuePreview(text).id;

    return [
      {
        id,
        text,
        imageCount,
        ...(typeof candidate.restorable === 'boolean' ? { restorable: candidate.restorable } : {}),
        ...(typeof candidate.pending === 'boolean' ? { pending: candidate.pending } : {}),
      },
    ];
  });
}

function appendPendingQueueItem(state: StreamState, behavior: 'steer' | 'followUp', item: QueuedPromptPreview): StreamState {
  if (behavior === 'steer') {
    return {
      ...state,
      pendingQueue: {
        ...state.pendingQueue,
        steering: [...state.pendingQueue.steering, item],
      },
    };
  }

  return {
    ...state,
    pendingQueue: {
      ...state.pendingQueue,
      followUp: [...state.pendingQueue.followUp, item],
    },
  };
}

export function removePendingQueueItemById(state: StreamState, behavior: 'steer' | 'followUp', itemId: string): StreamState {
  const normalizedItemId = itemId.trim();
  if (!normalizedItemId) {
    return state;
  }

  const key = behavior === 'steer' ? 'steering' : 'followUp';
  const queue = state.pendingQueue[key];
  const index = queue.findIndex((item) => item.id === normalizedItemId);
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

function removeOptimisticUserBlock(state: StreamState, optimisticBlockId: string): StreamState {
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

function selectVisibleStreamState(state: StreamState, stateSessionId: string | null, requestedSessionId: string | null): StreamState {
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

  return (
    messageBlockImagesMatch(previous.images ?? [], next.images ?? []) && nextSkillBlock.name.trim().toLowerCase() === previousSkillName
  );
}

function messageBlockImagesMatch(
  previousImages: NonNullable<Extract<MessageBlock, { type: 'user' }>['images']>,
  nextImages: NonNullable<Extract<MessageBlock, { type: 'user' }>['images']>,
): boolean {
  return (
    previousImages.length === nextImages.length &&
    nextImages.every((image, index) => {
      const previousImage = previousImages[index];
      if (!previousImage) {
        return false;
      }

      if (previousImage.src === image.src) {
        return messageImageMimeTypesMatch(previousImage.mimeType, image.mimeType) && previousImage.caption === image.caption;
      }

      const previousSrc = previousImage.src ?? '';
      const nextSrc = image.src ?? '';
      const bridgesPreviewToTranscriptData =
        (previousSrc.startsWith('blob:') && isImageBase64DataUrl(nextSrc)) ||
        (isImageBase64DataUrl(previousSrc) && nextSrc.startsWith('blob:'));
      return (
        bridgesPreviewToTranscriptData &&
        messageImageMimeTypesMatch(previousImage.mimeType, image.mimeType) &&
        previousImage.caption === image.caption
      );
    })
  );
}

function messageImageMimeTypesMatch(previousMimeType: string | undefined, nextMimeType: string | undefined): boolean {
  return (previousMimeType?.trim().toLowerCase() || '') === (nextMimeType?.trim().toLowerCase() || '');
}

function isImageBase64DataUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('data:image/') || !normalized.includes(';base64,')) {
    return false;
  }
  const commaIndex = normalized.indexOf(',');
  const base64 = commaIndex >= 0 ? value.slice(commaIndex + 1).trim() : '';
  return Boolean(base64) && base64.length % 4 !== 1 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64);
}

export function userMessageBlocksMatchForStreamDedupe(previous: MessageBlock | undefined, next: MessageBlock): boolean {
  if (previous?.type !== 'user' || next.type !== 'user' || previous.text !== next.text) {
    return false;
  }

  return messageBlockImagesMatch(previous.images ?? [], next.images ?? []);
}

function resolveSessionStreamSubscriptionId(sessionId: string | null, options?: { enabled?: boolean }): string | null {
  return options?.enabled === false ? null : sessionId;
}

function resolveEffectiveSessionStreamSubscriptionId(
  sessionId: string | null,
  options?: { enabled?: boolean },
  forcedSessionId?: string | null,
): string | null {
  const requestedSessionId = resolveSessionStreamSubscriptionId(sessionId, options);
  if (requestedSessionId) {
    return requestedSessionId;
  }

  const normalizedSessionId = sessionId?.trim() ?? '';
  if (!normalizedSessionId) {
    return null;
  }

  return forcedSessionId?.trim() === normalizedSessionId ? normalizedSessionId : null;
}

function shouldRetrySessionStreamAfterError(status?: number): boolean {
  if (typeof status !== 'number') {
    return true;
  }

  return status >= 500;
}

function shouldPersistWarmLiveSessionState(state: StreamState): boolean {
  return (
    state.hasSnapshot ||
    state.blocks.length > 0 ||
    state.isStreaming ||
    state.error !== null ||
    state.title !== null ||
    state.tokens !== null ||
    state.cost !== null ||
    state.contextUsage !== null ||
    state.pendingQueue.steering.length > 0 ||
    state.pendingQueue.followUp.length > 0 ||
    state.parallelJobs.length > 0 ||
    state.presence.surfaces.length > 0 ||
    state.presence.controllerSurfaceId !== null ||
    state.presence.controllerSurfaceType !== null ||
    state.presence.controllerAcquiredAt !== null
  );
}

function readSeededSessionStreamState(sessionId: string | null): StreamState {
  if (!sessionId) {
    return INITIAL_STREAM_STATE;
  }

  return readWarmLiveSessionState(sessionId) ?? INITIAL_STREAM_STATE;
}

function isLiveSessionSurfaceRegistered(presence: LiveSessionPresenceState, surfaceId: string): boolean {
  const normalizedSurfaceId = surfaceId.trim();
  if (!normalizedSurfaceId) {
    return false;
  }

  return presence.surfaces.some((surface) => surface.surfaceId === normalizedSurfaceId);
}

function isLiveSessionControlError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toLowerCase();

  return (
    normalized.includes('controlled by another surface') ||
    normalized.includes('surface id is required to control this conversation') ||
    normalized.includes('no surface is currently controlling this conversation') ||
    normalized.includes('open the conversation on this surface before taking control')
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function normalizeSurfaceRegistrationWaitOptions(input: { timeoutMs?: number; pollMs?: number }): {
  timeoutMs: number;
  pollMs: number;
} {
  const timeoutMs =
    Number.isSafeInteger(input.timeoutMs) && (input.timeoutMs as number) >= 0 ? Math.min(10_000, input.timeoutMs as number) : 1_500;
  const pollMs = Number.isSafeInteger(input.pollMs) && (input.pollMs as number) >= 10 ? Math.min(1_000, input.pollMs as number) : 50;
  return { timeoutMs, pollMs };
}

async function waitForSurfaceRegistration(input: {
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

  const { timeoutMs, pollMs } = normalizeSurfaceRegistrationWaitOptions(input);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await wait(pollMs);
    if (input.hasSurface()) {
      return true;
    }
  }

  return input.hasSurface();
}

export async function retryLiveSessionActionAfterTakeover<T>(input: {
  attemptAction: () => Promise<T>;
  takeOverSessionControl: () => Promise<unknown>;
}): Promise<T> {
  try {
    return await input.attemptAction();
  } catch (error) {
    if (!isLiveSessionControlError(error)) {
      throw error;
    }
  }

  await input.takeOverSessionControl();
  return input.attemptAction();
}

async function submitLivePromptWithControlRetry<T>(input: {
  attemptPrompt: () => Promise<T>;
  waitForSurfaceRegistration: () => Promise<boolean>;
  takeOverSessionControl: () => Promise<unknown>;
}): Promise<T> {
  try {
    return await input.attemptPrompt();
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
  return await input.attemptPrompt();
}

export function useSessionStream(
  sessionId: string | null,
  options?: { tailBlocks?: number; enabled?: boolean; registerSurface?: boolean },
) {
  const normalizedSessionId = sessionId?.trim() || null;
  const [state, setState] = useState<StreamState>(() => readSeededSessionStreamState(normalizedSessionId));
  const [connectVersion, setConnectVersion] = useState(0);
  const [forcedSessionId, setForcedSessionId] = useState<string | null>(null);
  // Mutable refs to avoid stale closures in the SSE handler
  const blocksRef = useRef<MessageBlock[]>(state.blocks);
  const streamingRef = useRef(state.isStreaming);
  const configuredSessionId = resolveSessionStreamSubscriptionId(normalizedSessionId, options);
  const requestedSessionId = resolveEffectiveSessionStreamSubscriptionId(normalizedSessionId, options, forcedSessionId);
  const stateSessionIdRef = useRef<string | null>(requestedSessionId);
  const previousConversationIdRef = useRef<string | null>(null);
  const previousRequestedSessionIdRef = useRef<string | null>(null);
  const surfaceId = useMemo(() => getOrCreateConversationSurfaceId(), []);
  const surfaceType = useMemo(() => detectConversationSurfaceType(), []);
  const registerSurface = options?.registerSurface !== false;

  const presenceRef = useRef<LiveSessionPresenceState>(createEmptyLiveSessionPresenceState());

  useEffect(() => {
    presenceRef.current = state.presence;
  }, [state.presence]);

  useEffect(() => {
    if (!normalizedSessionId) {
      setForcedSessionId(null);
      return;
    }

    if (forcedSessionId && forcedSessionId !== normalizedSessionId) {
      setForcedSessionId(null);
      return;
    }

    if (configuredSessionId && forcedSessionId === configuredSessionId) {
      setForcedSessionId(null);
    }
  }, [configuredSessionId, forcedSessionId, normalizedSessionId]);

  const ensureRequestedSubscription = useCallback(() => {
    if (!normalizedSessionId) {
      return;
    }

    setForcedSessionId((current) => (current === normalizedSessionId ? current : normalizedSessionId));
  }, [normalizedSessionId]);

  const waitForCurrentSurfaceRegistration = useCallback(
    () =>
      waitForSurfaceRegistration({
        surfaceId,
        hasSurface: () => isLiveSessionSurfaceRegistered(presenceRef.current, surfaceId),
        reconnect: normalizedSessionId
          ? () => {
              ensureRequestedSubscription();
              setConnectVersion((current) => current + 1);
            }
          : undefined,
      }),
    [ensureRequestedSubscription, normalizedSessionId, surfaceId],
  );

  const send = useCallback(
    async (
      text: string,
      behavior?: 'steer' | 'followUp',
      images?: PromptImageInput[],
      attachmentRefs?: PromptAttachmentRefInput[],
      contextMessages?: Array<{ customType: string; content: string }>,
      relatedConversationIds?: string[],
    ) => {
      if (!normalizedSessionId) return undefined;

      ensureRequestedSubscription();

      let optimisticUserBlockId: string | null = null;
      let optimisticQueueItemId: string | null = null;

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
        const optimisticQueueItem = createOptimisticPendingQueueItem(text, images?.length ?? 0);
        optimisticQueueItemId = optimisticQueueItem.id;
        setState((s) => appendPendingQueueItem(s, behavior, optimisticQueueItem));
      }

      try {
        return await submitLivePromptWithControlRetry({
          attemptPrompt: () =>
            api.promptSession(
              normalizedSessionId,
              text,
              behavior,
              images,
              attachmentRefs,
              surfaceId,
              contextMessages,
              relatedConversationIds,
            ),
          waitForSurfaceRegistration: waitForCurrentSurfaceRegistration,
          takeOverSessionControl: () => api.takeoverLiveSession(normalizedSessionId, surfaceId),
        });
      } catch (error) {
        if (behavior && optimisticQueueItemId) {
          setState((s) => removePendingQueueItemById(s, behavior, optimisticQueueItemId ?? ''));
        } else if (optimisticUserBlockId) {
          setState((s) => {
            const next = removeOptimisticUserBlock(s, optimisticUserBlockId ?? '');
            blocksRef.current = next.blocks;
            return next;
          });
        }
        throw error;
      }
    },
    [ensureRequestedSubscription, normalizedSessionId, surfaceId, waitForCurrentSurfaceRegistration],
  );

  const parallel = useCallback(
    async (
      text: string,
      images?: PromptImageInput[],
      attachmentRefs?: PromptAttachmentRefInput[],
      contextMessages?: Array<{ customType: string; content: string }>,
      relatedConversationIds?: string[],
    ) => {
      if (!normalizedSessionId) {
        return;
      }

      ensureRequestedSubscription();
      return await submitLivePromptWithControlRetry({
        attemptPrompt: () =>
          api.parallelPromptSession(normalizedSessionId, text, images, attachmentRefs, surfaceId, contextMessages, relatedConversationIds),
        waitForSurfaceRegistration: waitForCurrentSurfaceRegistration,
        takeOverSessionControl: () => api.takeoverLiveSession(normalizedSessionId, surfaceId),
      });
    },
    [ensureRequestedSubscription, normalizedSessionId, surfaceId, waitForCurrentSurfaceRegistration],
  );

  const manageParallelJob = useCallback(
    async (jobId: string, action: 'importNow' | 'skip' | 'cancel') => {
      if (!normalizedSessionId) {
        return;
      }

      ensureRequestedSubscription();
      return retryLiveSessionActionAfterTakeover({
        attemptAction: () => api.manageParallelPromptJob(normalizedSessionId, jobId, action, surfaceId),
        takeOverSessionControl: async () => {
          const surfaceReady = await waitForCurrentSurfaceRegistration();
          if (!surfaceReady) {
            throw new Error('Unable to confirm this surface is connected yet. Try again in a moment.');
          }
          return api.takeoverLiveSession(normalizedSessionId, surfaceId);
        },
      });
    },
    [ensureRequestedSubscription, normalizedSessionId, surfaceId, waitForCurrentSurfaceRegistration],
  );

  const abort = useCallback(async () => {
    if (!normalizedSessionId) return;
    await api.abortSession(normalizedSessionId, surfaceId);
  }, [normalizedSessionId, surfaceId]);

  const takeover = useCallback(async () => {
    if (!normalizedSessionId) {
      return;
    }

    ensureRequestedSubscription();

    const surfaceReady = await waitForCurrentSurfaceRegistration();
    if (!surfaceReady) {
      throw new Error('Unable to confirm this surface is connected yet. Try again in a moment.');
    }

    await api.takeoverLiveSession(normalizedSessionId, surfaceId);
  }, [ensureRequestedSubscription, normalizedSessionId, surfaceId, waitForCurrentSurfaceRegistration]);

  const reconnect = useCallback(() => {
    if (!normalizedSessionId) {
      return;
    }

    ensureRequestedSubscription();
    setConnectVersion((current) => current + 1);
  }, [ensureRequestedSubscription, normalizedSessionId]);

  useEffect(() => {
    const requestedSessionIdChanged = previousRequestedSessionIdRef.current !== requestedSessionId;
    const conversationIdChanged = previousConversationIdRef.current !== normalizedSessionId;
    if (!requestedSessionIdChanged && !conversationIdChanged) {
      return;
    }

    previousConversationIdRef.current = normalizedSessionId;
    previousRequestedSessionIdRef.current = requestedSessionId;
    stateSessionIdRef.current = requestedSessionId;
    const seededState = readSeededSessionStreamState(requestedSessionId);
    blocksRef.current = seededState.blocks;
    streamingRef.current = seededState.isStreaming;
    setState(seededState);
  }, [normalizedSessionId, requestedSessionId]);

  useEffect(() => {
    if (!requestedSessionId || !shouldPersistWarmLiveSessionState(state)) {
      return;
    }

    writeWarmLiveSessionState(requestedSessionId, state);
  }, [requestedSessionId, state]);

  useEffect(() => {
    if (!requestedSessionId) return;

    let es: EventSourceLike;
    let closed = false;

    function connect() {
      const params = new URLSearchParams();
      const tailBlocks = normalizeLiveSessionTailBlocks(options?.tailBlocks);
      if (tailBlocks !== undefined) {
        params.set('tailBlocks', String(tailBlocks));
      }
      if (registerSurface) {
        params.set('surfaceId', surfaceId);
        params.set('surfaceType', surfaceType);
      }
      const query = params.toString();
      es = createDesktopAwareEventSource(`/api/live-sessions/${requestedSessionId}/events${query ? `?${query}` : ''}`);

      es.onmessage = (e: MessageEvent<string>) => {
        if (closed) return;
        let event: SseEvent;
        try {
          event = JSON.parse(e.data) as SseEvent;
        } catch {
          return;
        }

        setState((prev) => applyEvent(prev, blocksRef, streamingRef, event));
      };

      es.onerror = () => {
        if (closed) return;
        es.close();
        api
          .liveSession(requestedSessionId)
          .then(() => {
            if (!closed) {
              setTimeout(connect, 2_000);
            }
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            const statusMatch = message.match(/^(\d{3})\b/);
            const status = statusMatch ? Number.parseInt(statusMatch[1] ?? '', 10) : undefined;
            if (!closed && shouldRetrySessionStreamAfterError(status)) {
              setTimeout(connect, 2_000);
              return;
            }

            clearWarmLiveSessionState(requestedSessionId);
          });
      };
    }

    connect();

    return () => {
      closed = true;
      es?.close();
    };
  }, [connectVersion, options?.tailBlocks, registerSurface, requestedSessionId, surfaceId, surfaceType]);

  const visibleState = selectVisibleStreamState(state, stateSessionIdRef.current, requestedSessionId);

  return useMemo(
    () => ({ ...visibleState, surfaceId, takeover, send, parallel, manageParallelJob, abort, reconnect }),
    [visibleState, surfaceId, takeover, send, parallel, manageParallelJob, abort, reconnect],
  );
}

// ── Event → block reducer ─────────────────────────────────────────────────────

const TERMINAL_BASH_DISPLAY_MODE = 'terminal';

function readLiveTerminalBashDetails(toolName: string, args: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (toolName !== 'bash' || !args || args.displayMode !== TERMINAL_BASH_DISPLAY_MODE) {
    return null;
  }

  return {
    displayMode: TERMINAL_BASH_DISPLAY_MODE,
    ...(args.excludeFromContext === true ? { excludeFromContext: true } : {}),
  };
}

function applyEvent(
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
        isCompacting: false,
        error: null,
      };
    }

    case 'compaction_start': {
      return { ...prev, isCompacting: true };
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

    case 'cwd_changed': {
      return {
        ...prev,
        cwdChange: {
          newConversationId: event.newConversationId,
          cwd: event.cwd,
          autoContinued: event.autoContinued,
        },
      };
    }

    case 'user_message': {
      const nextBlock = displayBlockToMessageBlock(event.block);
      const last = blocks[blocks.length - 1];
      const sameUserBlock = userMessageBlocksMatchForStreamDedupe(last, nextBlock);
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

    case 'parallel_state': {
      return { ...prev, parallelJobs: Array.isArray(event.jobs) ? event.jobs : [] };
    }

    case 'presence_state': {
      return { ...prev, presence: event.state };
    }

    case 'auto_mode_state': {
      return { ...prev, autoModeState: event.state };
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
      const details = readLiveTerminalBashDetails(event.toolName, args);
      blocks.push({
        type: 'tool_use',
        tool: event.toolName,
        input: args,
        output: '',
        status: 'running',
        ts: new Date().toISOString(),
        _toolCallId: event.toolCallId,
        ...(details ? { details } : {}),
      } as MessageBlock & { _toolCallId: string });
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'tool_update': {
      const idx = blocks.findLastIndex(
        (b) => b.type === 'tool_use' && (b as MessageBlock & { _toolCallId?: string })._toolCallId === event.toolCallId,
      );
      if (idx >= 0) {
        const b = blocks[idx] as Extract<MessageBlock, { type: 'tool_use' }>;
        // partialResult from Pi is an AgentToolResult; content[0].text holds the text
        const pr = event.partialResult as { content?: { text?: string }[] } | string | undefined;
        const partial = typeof pr === 'string' ? pr : (pr?.content?.[0]?.text ?? '');
        blocks[idx] = { ...b, output: (b.output ?? '') + partial };
      }
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'tool_end': {
      const idx = blocks.findLastIndex(
        (b) => b.type === 'tool_use' && (b as MessageBlock & { _toolCallId?: string })._toolCallId === event.toolCallId,
      );
      if (idx >= 0) {
        const b = blocks[idx] as Extract<MessageBlock, { type: 'tool_use' }>;
        blocks[idx] = {
          ...b,
          output: event.output, // replace partial with final
          status: event.isError ? 'error' : 'ok',
          durationMs: event.durationMs,
          details: event.details ?? b.details,
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
