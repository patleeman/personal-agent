/**
 * sessionStream — shared types, utilities, and constants for live session
 * conversation streams. The SSE-based useSessionStream hook was removed;
 * the desktop bridge (useDesktopConversationState) is the only stream path.
 */
import type {
  LiveSessionPresenceState,
  LiveSessionSurfaceType,
  MessageBlock,
  ParallelPromptPreview,
  QueuedPromptPreview,
  SessionContextUsage,
  ThreadGoal,
} from '../shared/types';

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
  goalState: ThreadGoal | null;
  systemPrompt: string | null;
  cwdChange: { newConversationId: string; cwd: string; autoContinued: boolean } | null;
}

function createEmptyLiveSessionPresenceState(): LiveSessionPresenceState {
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
  isCompacting: false,
  error: null,
  title: null,
  tokens: null,
  cost: null,
  contextUsage: null,
  pendingQueue: { steering: [], followUp: [] },
  parallelJobs: [],
  presence: createEmptyLiveSessionPresenceState(),
  goalState: null,
  systemPrompt: null,
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

export function normalizeSurfaceRegistrationWaitOptions(input: { timeoutMs?: number; pollMs?: number }): {
  timeoutMs: number;
  pollMs: number;
} {
  const timeoutMs =
    Number.isSafeInteger(input.timeoutMs) && (input.timeoutMs as number) >= 0 ? Math.min(10_000, input.timeoutMs as number) : 1_500;
  const pollMs = Number.isSafeInteger(input.pollMs) && (input.pollMs as number) >= 10 ? Math.min(1_000, input.pollMs as number) : 50;
  return { timeoutMs, pollMs };
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
