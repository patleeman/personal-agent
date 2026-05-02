import { getDurableRunLogCursor, getDurableRunSnapshot, readDurableRunLogDelta } from '../automation/durableRuns.js';
import { inlineConversationSessionSnapshotAssetsCapability } from '../conversations/conversationSessionAssetCapability.js';
import { subscribe as subscribeLiveSession } from '../conversations/liveSessions.js';
import type { DisplayBlock } from '../conversations/sessions.js';
import { subscribeProviderOAuthLogin } from '../models/providerAuth.js';

const MAX_DESKTOP_LOCAL_API_STREAM_TAIL_BLOCKS = 1000;

export type DesktopLocalApiStreamEvent =
  | { type: 'open' }
  | { type: 'message'; data: string }
  | { type: 'error'; message: string }
  | { type: 'close' };

function emitStreamMessage(onEvent: (event: DesktopLocalApiStreamEvent) => void, payload: unknown): void {
  onEvent({ type: 'message', data: JSON.stringify(payload) });
}

function parsePositiveInteger(raw: string | null, options?: { minimum?: number; maximum?: number }): number | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed)) {
    return undefined;
  }

  const minimum = options?.minimum ?? 1;
  if (parsed < minimum) {
    return undefined;
  }

  const maximum = options?.maximum;
  if (typeof maximum === 'number' && parsed > maximum) {
    return maximum;
  }

  return parsed;
}

async function subscribeDesktopLiveSessionStream(url: URL, onEvent: (event: DesktopLocalApiStreamEvent) => void): Promise<() => void> {
  const match = /^\/api\/live-sessions\/([^/]+)\/events$/.exec(url.pathname);
  const sessionId = decodeURIComponent(match?.[1] ?? '');
  if (!sessionId) {
    throw new Error('Live session id is required.');
  }

  const tailBlocks = parsePositiveInteger(url.searchParams.get('tailBlocks'), {
    maximum: MAX_DESKTOP_LOCAL_API_STREAM_TAIL_BLOCKS,
  });
  const surfaceId = url.searchParams.get('surfaceId')?.trim() ?? '';
  const surfaceType = url.searchParams.get('surfaceType') === 'mobile_web' ? 'mobile_web' : 'desktop_web';

  const pendingPayloads: unknown[] = [];
  let opened = false;
  let closed = false;
  const writeEvent = (event: unknown) => {
    if (closed) {
      return;
    }

    const payload =
      event && typeof event === 'object' && (event as { type?: unknown }).type === 'snapshot'
        ? inlineConversationSessionSnapshotAssetsCapability(
            sessionId,
            event as {
              type: 'snapshot';
              blocks: DisplayBlock[];
              blockOffset: number;
              totalBlocks: number;
            },
          )
        : event;

    if (!opened) {
      pendingPayloads.push(payload);
      return;
    }

    emitStreamMessage(onEvent, payload);
  };

  const unsubscribe = subscribeLiveSession(sessionId, writeEvent, {
    ...(tailBlocks ? { tailBlocks } : {}),
    ...(surfaceId ? { surface: { surfaceId, surfaceType } } : {}),
  });

  if (!unsubscribe) {
    throw new Error('Not a live session');
  }

  onEvent({ type: 'open' });
  opened = true;
  for (const payload of pendingPayloads) {
    emitStreamMessage(onEvent, payload);
  }

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    unsubscribe();
    onEvent({ type: 'close' });
  };
}

const ACTIVE_RUN_POLL_INTERVAL_MS = 1_000;
const IDLE_RUN_POLL_INTERVAL_MS = 5_000;
const ACTIVE_RUN_LOG_POLL_INTERVAL_MS = 250;
const IDLE_RUN_LOG_POLL_INTERVAL_MS = 2_000;

function isRunStreamActive(snapshot: { detail: { run: { status?: { status?: string } | string } } }): boolean {
  const runStatus = typeof snapshot.detail.run.status === 'string' ? snapshot.detail.run.status : snapshot.detail.run.status?.status;

  return runStatus === 'queued' || runStatus === 'waiting' || runStatus === 'running' || runStatus === 'recovering';
}

function getRunStreamPollInterval(snapshot: { detail: { run: { status?: { status?: string } | string } } }): number {
  return isRunStreamActive(snapshot) ? ACTIVE_RUN_POLL_INTERVAL_MS : IDLE_RUN_POLL_INTERVAL_MS;
}

function getRunLogPollInterval(active: boolean): number {
  return active ? ACTIVE_RUN_LOG_POLL_INTERVAL_MS : IDLE_RUN_LOG_POLL_INTERVAL_MS;
}

async function subscribeDesktopRunStream(url: URL, onEvent: (event: DesktopLocalApiStreamEvent) => void): Promise<() => void> {
  const match = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
  const runId = decodeURIComponent(match?.[1] ?? '');
  if (!runId) {
    throw new Error('Run id is required.');
  }

  const tail = parsePositiveInteger(url.searchParams.get('tail'), { minimum: 1, maximum: 1000 }) ?? 120;
  const initial = await getDurableRunSnapshot(runId, tail);
  if (!initial) {
    throw new Error('Run not found');
  }

  let closed = false;
  let detailPollTimer: ReturnType<typeof setTimeout> | null = null;
  let logPollTimer: ReturnType<typeof setTimeout> | null = null;
  let logPath = initial.log.path;
  let logCursor = getDurableRunLogCursor(logPath);
  let runActive = isRunStreamActive(initial);
  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    if (detailPollTimer) {
      clearTimeout(detailPollTimer);
      detailPollTimer = null;
    }
    if (logPollTimer) {
      clearTimeout(logPollTimer);
      logPollTimer = null;
    }
    onEvent({ type: 'close' });
  };

  const scheduleDetailPoll = (delayMs: number) => {
    if (closed) {
      return;
    }

    detailPollTimer = setTimeout(() => {
      void pollDetailOnce();
    }, delayMs);
  };

  const scheduleLogPoll = (delayMs: number) => {
    if (closed) {
      return;
    }

    logPollTimer = setTimeout(() => {
      void pollLogOnce();
    }, delayMs);
  };

  const pollDetailOnce = async () => {
    if (closed) {
      return;
    }

    try {
      const next = await getDurableRunSnapshot(runId, tail);
      if (closed) {
        return;
      }

      if (!next) {
        emitStreamMessage(onEvent, { type: 'deleted', runId });
        close();
        return;
      }

      runActive = isRunStreamActive(next);
      if (next.log.path !== logPath) {
        logPath = next.log.path;
        logCursor = getDurableRunLogCursor(logPath);
        emitStreamMessage(onEvent, {
          type: 'snapshot',
          detail: next.detail,
          log: next.log,
        });
      } else {
        emitStreamMessage(onEvent, {
          type: 'detail',
          detail: next.detail,
        });
      }
      scheduleDetailPoll(getRunStreamPollInterval(next));
    } catch {
      scheduleDetailPoll(ACTIVE_RUN_POLL_INTERVAL_MS);
    }
  };

  const pollLogOnce = async () => {
    if (closed) {
      return;
    }

    try {
      const delta = readDurableRunLogDelta(logPath, logCursor);
      if (closed) {
        return;
      }

      if (delta?.reset) {
        const next = await getDurableRunSnapshot(runId, tail);
        if (closed) {
          return;
        }

        if (!next) {
          emitStreamMessage(onEvent, { type: 'deleted', runId });
          close();
          return;
        }

        runActive = isRunStreamActive(next);
        logPath = next.log.path;
        logCursor = getDurableRunLogCursor(logPath);
        emitStreamMessage(onEvent, {
          type: 'snapshot',
          detail: next.detail,
          log: next.log,
        });
      } else if (delta) {
        logCursor = delta.nextCursor;
        if (delta.delta.length > 0) {
          emitStreamMessage(onEvent, { type: 'log_delta', path: delta.path, delta: delta.delta });
        }
      }
    } finally {
      scheduleLogPoll(getRunLogPollInterval(runActive));
    }
  };

  onEvent({ type: 'open' });
  emitStreamMessage(onEvent, {
    type: 'snapshot',
    detail: initial.detail,
    log: initial.log,
  });
  scheduleDetailPoll(getRunStreamPollInterval(initial));
  scheduleLogPoll(getRunLogPollInterval(runActive));

  return close;
}

async function subscribeDesktopProviderOAuthStream(url: URL, onEvent: (event: DesktopLocalApiStreamEvent) => void): Promise<() => void> {
  const match = /^\/api\/provider-auth\/oauth\/([^/]+)\/events$/.exec(url.pathname);
  const loginId = decodeURIComponent(match?.[1] ?? '');
  if (!loginId) {
    throw new Error('Provider OAuth login id is required.');
  }

  let closed = false;
  let unsubscribe = () => {};
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    unsubscribe();
    onEvent({ type: 'close' });
  };

  onEvent({ type: 'open' });
  unsubscribe = subscribeProviderOAuthLogin(loginId, (login) => {
    if (closed) {
      return;
    }

    emitStreamMessage(onEvent, login);
    if (login.status === 'completed' || login.status === 'failed') {
      close();
    }
  });

  timeoutId = setTimeout(
    () => {
      close();
    },
    10 * 60 * 1000,
  );

  return close;
}

export async function subscribeDesktopLocalApiStreamByUrl(
  url: URL,
  onEvent: (event: DesktopLocalApiStreamEvent) => void,
): Promise<() => void> {
  if (/^\/api\/live-sessions\/[^/]+\/events$/.test(url.pathname)) {
    return subscribeDesktopLiveSessionStream(url, onEvent);
  }

  if (/^\/api\/runs\/[^/]+\/events$/.test(url.pathname)) {
    return subscribeDesktopRunStream(url, onEvent);
  }

  if (/^\/api\/provider-auth\/oauth\/[^/]+\/events$/.test(url.pathname)) {
    return subscribeDesktopProviderOAuthStream(url, onEvent);
  }

  throw new Error(`No local API stream for ${url.pathname}`);
}
