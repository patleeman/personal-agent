import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageBlock } from '../types';
import type { StreamState } from './useSessionStream';
import {
  appendPendingQueueItem,
  applyEvent,
  INITIAL_STREAM_STATE,
  isLiveSessionControlError,
  normalizePendingQueueItems,
  removeOptimisticUserBlock,
  removePendingQueueItem,
  resolveEffectiveSessionStreamSubscriptionId,
  resolveSessionStreamSubscriptionId,
  retryLiveSessionActionAfterTakeover,
  selectVisibleStreamState,
  shouldReplaceOptimisticUserBlock,
  shouldRetrySessionStreamAfterError,
  submitLivePromptWithControlRetry,
  waitForSurfaceRegistration,
} from './useSessionStream';

describe('resolveSessionStreamSubscriptionId', () => {
  it('disables the live stream subscription when explicitly turned off', () => {
    expect(resolveSessionStreamSubscriptionId('session-a', { enabled: false })).toBeNull();
  });

  it('keeps the requested session id when streaming is enabled', () => {
    expect(resolveSessionStreamSubscriptionId('session-a', { enabled: true })).toBe('session-a');
    expect(resolveSessionStreamSubscriptionId('session-a')).toBe('session-a');
  });
});

describe('resolveEffectiveSessionStreamSubscriptionId', () => {
  it('keeps a forced subscription for the active session while the live stream is still disabled', () => {
    expect(resolveEffectiveSessionStreamSubscriptionId('session-a', { enabled: false }, 'session-a')).toBe('session-a');
  });

  it('ignores forced subscriptions for other sessions', () => {
    expect(resolveEffectiveSessionStreamSubscriptionId('session-a', { enabled: false }, 'session-b')).toBeNull();
  });

  it('prefers the configured live subscription when streaming is enabled', () => {
    expect(resolveEffectiveSessionStreamSubscriptionId('session-a', { enabled: true }, 'session-a')).toBe('session-a');
  });
});

describe('shouldRetrySessionStreamAfterError', () => {
  it('retries when the probe fails or the server errors', () => {
    expect(shouldRetrySessionStreamAfterError()).toBe(true);
    expect(shouldRetrySessionStreamAfterError(500)).toBe(true);
    expect(shouldRetrySessionStreamAfterError(503)).toBe(true);
  });

  it('does not retry when the session is definitively gone', () => {
    expect(shouldRetrySessionStreamAfterError(404)).toBe(false);
    expect(shouldRetrySessionStreamAfterError(400)).toBe(false);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isLiveSessionControlError', () => {
  it('matches the live-surface control errors we retry locally', () => {
    expect(isLiveSessionControlError(new Error('This conversation is controlled by another surface. Take over here to continue.'))).toBe(true);
    expect(isLiveSessionControlError(new Error('Open the conversation on this surface before taking control.'))).toBe(true);
    expect(isLiveSessionControlError(new Error('No surface is currently controlling this conversation. Take over here to continue.'))).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isLiveSessionControlError(new Error('boom'))).toBe(false);
  });
});

describe('waitForSurfaceRegistration', () => {
  it('returns immediately when the surface is already present', async () => {
    const reconnect = vi.fn();

    await expect(waitForSurfaceRegistration({
      surfaceId: 'surface-1',
      hasSurface: () => true,
      reconnect,
    })).resolves.toBe(true);

    expect(reconnect).not.toHaveBeenCalled();
  });

  it('nudges a reconnect and waits for the surface to appear', async () => {
    vi.useFakeTimers();
    let connected = false;
    const reconnect = vi.fn();

    const waiting = waitForSurfaceRegistration({
      surfaceId: 'surface-1',
      hasSurface: () => connected,
      reconnect,
      timeoutMs: 200,
      pollMs: 25,
    });

    expect(reconnect).toHaveBeenCalledTimes(1);

    setTimeout(() => {
      connected = true;
    }, 60);

    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toBe(true);
  });

  it('returns false when the surface never reconnects', async () => {
    vi.useFakeTimers();

    const waiting = waitForSurfaceRegistration({
      surfaceId: 'surface-1',
      hasSurface: () => false,
      timeoutMs: 100,
      pollMs: 25,
    });

    await vi.advanceTimersByTimeAsync(125);
    await expect(waiting).resolves.toBe(false);
  });
});

describe('retryLiveSessionActionAfterTakeover', () => {
  it('retries generic live-session actions after taking over on control errors', async () => {
    const attemptAction = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('This conversation is controlled by another surface. Take over here to continue.'))
      .mockResolvedValueOnce('ok');
    const takeOver = vi.fn(async () => undefined);

    await expect(retryLiveSessionActionAfterTakeover({
      attemptAction,
      takeOverSessionControl: takeOver,
    })).resolves.toBe('ok');

    expect(attemptAction).toHaveBeenCalledTimes(2);
    expect(takeOver).toHaveBeenCalledTimes(1);
  });

  it('does not retry unrelated live-session action failures', async () => {
    const error = new Error('provider unavailable');
    const attemptAction = vi.fn<() => Promise<void>>().mockRejectedValueOnce(error);
    const takeOver = vi.fn(async () => undefined);

    await expect(retryLiveSessionActionAfterTakeover({
      attemptAction,
      takeOverSessionControl: takeOver,
    })).rejects.toBe(error);

    expect(attemptAction).toHaveBeenCalledTimes(1);
    expect(takeOver).not.toHaveBeenCalled();
  });
});

describe('submitLivePromptWithControlRetry', () => {
  it('retries after reconnecting and taking over on control errors', async () => {
    const attemptPrompt = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('This conversation is controlled by another surface. Take over here to continue.'))
      .mockResolvedValueOnce(undefined);
    const waitForRegistration = vi.fn(async () => true);
    const takeOver = vi.fn(async () => undefined);

    await expect(submitLivePromptWithControlRetry({
      attemptPrompt,
      waitForSurfaceRegistration: waitForRegistration,
      takeOverSessionControl: takeOver,
    })).resolves.toBeUndefined();

    expect(attemptPrompt).toHaveBeenCalledTimes(2);
    expect(waitForRegistration).toHaveBeenCalledTimes(1);
    expect(takeOver).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original control error when the surface never comes back', async () => {
    const error = new Error('This conversation is controlled by another surface. Take over here to continue.');
    const attemptPrompt = vi.fn<() => Promise<void>>().mockRejectedValueOnce(error);
    const waitForRegistration = vi.fn(async () => false);
    const takeOver = vi.fn(async () => undefined);

    await expect(submitLivePromptWithControlRetry({
      attemptPrompt,
      waitForSurfaceRegistration: waitForRegistration,
      takeOverSessionControl: takeOver,
    })).rejects.toBe(error);

    expect(attemptPrompt).toHaveBeenCalledTimes(1);
    expect(takeOver).not.toHaveBeenCalled();
  });

  it('does not retry unrelated prompt failures', async () => {
    const error = new Error('provider unavailable');
    const attemptPrompt = vi.fn<() => Promise<void>>().mockRejectedValueOnce(error);
    const waitForRegistration = vi.fn(async () => true);
    const takeOver = vi.fn(async () => undefined);

    await expect(submitLivePromptWithControlRetry({
      attemptPrompt,
      waitForSurfaceRegistration: waitForRegistration,
      takeOverSessionControl: takeOver,
    })).rejects.toBe(error);

    expect(waitForRegistration).not.toHaveBeenCalled();
    expect(takeOver).not.toHaveBeenCalled();
  });
});

describe('normalizePendingQueueItems', () => {
  it('normalizes string queue entries into structured previews', () => {
    expect(normalizePendingQueueItems(['first', 2, null, 'second'])).toEqual([
      { id: expect.any(String), text: 'first', imageCount: 0, restorable: false },
      { id: expect.any(String), text: 'second', imageCount: 0, restorable: false },
    ]);
  });

  it('preserves structured queue previews from the server', () => {
    expect(normalizePendingQueueItems([{ id: 'steer-0', text: 'draft', imageCount: 1 }])).toEqual([
      { id: 'steer-0', text: 'draft', imageCount: 1 },
    ]);
  });

  it('keeps image-only queue previews empty so the UI can render attachment chrome separately', () => {
    expect(normalizePendingQueueItems([{ id: 'steer-1', text: '', imageCount: 2 }])).toEqual([
      { id: 'steer-1', text: '', imageCount: 2 },
    ]);
  });

  it('falls back to an empty queue for non-array payloads', () => {
    expect(normalizePendingQueueItems(undefined)).toEqual([]);
    expect(normalizePendingQueueItems({ steering: ['bad-shape'] })).toEqual([]);
  });
});

describe('applyEvent', () => {
  it('clears stale streaming state when a fresh snapshot arrives after reconnect', () => {
    const state: StreamState = {
      ...INITIAL_STREAM_STATE,
      blocks: [{ type: 'text', ts: '2026-03-25T00:00:00.000Z', text: 'partial response' }],
      isStreaming: true,
      error: 'stale error',
    };
    const blocksRef = { current: state.blocks };
    const streamingRef = { current: true };

    const next = applyEvent(state, blocksRef, streamingRef, {
      type: 'snapshot',
      blocks: [{ type: 'text', id: 'assistant-1', ts: '2026-03-25T00:00:01.000Z', text: 'finished response' }],
      blockOffset: 0,
      totalBlocks: 1,
    });

    expect(next.isStreaming).toBe(false);
    expect(streamingRef.current).toBe(false);
    expect(next.error).toBeNull();
    expect(next.blocks).toEqual([{ type: 'text', id: 'assistant-1', ts: '2026-03-25T00:00:01.000Z', text: 'finished response' }]);
    expect(blocksRef.current).toEqual(next.blocks);
  });
});

describe('pending queue optimistic updates', () => {
  it('removes a failed optimistic user block by id', () => {
    const state: StreamState = {
      ...INITIAL_STREAM_STATE,
      blocks: [
        { type: 'user', id: 'user-1', ts: '2026-03-23T00:00:00.000Z', text: 'hello' },
        { type: 'text', id: 'assistant-1', ts: '2026-03-23T00:00:01.000Z', text: 'hi' },
        { type: 'user', id: 'user-2', ts: '2026-03-23T00:00:02.000Z', text: 'failed send' },
      ],
      totalBlocks: 3,
    };

    expect(removeOptimisticUserBlock(state, 'user-2')).toEqual({
      ...state,
      blocks: [
        { type: 'user', id: 'user-1', ts: '2026-03-23T00:00:00.000Z', text: 'hello' },
        { type: 'text', id: 'assistant-1', ts: '2026-03-23T00:00:01.000Z', text: 'hi' },
      ],
      totalBlocks: 2,
    });
  });

  it('tracks queued follow-up text and images in pending queue state immediately', () => {
    expect(appendPendingQueueItem(INITIAL_STREAM_STATE, 'followUp', 'queued follow-up', 2).pendingQueue).toEqual({
      steering: [],
      followUp: [{
        id: expect.any(String),
        text: 'queued follow-up',
        imageCount: 2,
        restorable: false,
        pending: true,
      }],
    });
  });

  it('removes only the most recent matching optimistic queue item', () => {
    const state: StreamState = {
      ...INITIAL_STREAM_STATE,
      pendingQueue: {
        steering: [{ id: 'steer-1', text: 'first steer', imageCount: 0 }],
        followUp: [
          { id: 'dup-1', text: 'duplicate', imageCount: 0 },
          { id: 'stable-1', text: 'stable', imageCount: 0 },
          { id: 'dup-2', text: 'duplicate', imageCount: 0 },
        ],
      },
    };

    expect(removePendingQueueItem(state, 'followUp', 'duplicate').pendingQueue).toEqual({
      steering: [{ id: 'steer-1', text: 'first steer', imageCount: 0 }],
      followUp: [
        { id: 'dup-1', text: 'duplicate', imageCount: 0 },
        { id: 'stable-1', text: 'stable', imageCount: 0 },
      ],
    });
  });
});

describe('selectVisibleStreamState', () => {
  it('hides stale stream data after navigating to a different session', () => {
    const staleState: StreamState = {
      ...INITIAL_STREAM_STATE,
      blocks: [{ type: 'text', ts: '2026-03-11T16:32:19.000Z', text: 'Old response' }],
      isStreaming: true,
      title: 'Existing conversation title',
      error: 'stale error',
      tokens: { input: 10, output: 20, total: 30 },
      cost: 0.12,
      contextUsage: { tokens: 30 },
    };

    expect(selectVisibleStreamState(staleState, 'session-a', 'session-b')).toEqual(INITIAL_STREAM_STATE);
  });

  it('returns the current stream state when the session id still matches', () => {
    const state: StreamState = {
      ...INITIAL_STREAM_STATE,
      title: 'Current conversation title',
    };

    expect(selectVisibleStreamState(state, 'session-a', 'session-a')).toBe(state);
  });
});

describe('shouldReplaceOptimisticUserBlock', () => {
  it('replaces an optimistic /skill bubble with the expanded skill block', () => {
    const previous: MessageBlock = {
      type: 'user',
      ts: '2026-03-19T12:00:00.000Z',
      text: '/skill:checkpoint commit only my files',
    };
    const next: MessageBlock = {
      type: 'user',
      ts: '2026-03-19T12:00:01.000Z',
      text: [
        '<skill name="checkpoint" location="/state/profiles/shared/agent/skills/checkpoint/INDEX.md">',
        'References are relative to /state/profiles/shared/agent/skills/checkpoint.',
        '</skill>',
      ].join('\n'),
    };

    expect(shouldReplaceOptimisticUserBlock(previous, next)).toBe(true);
  });

  it('does not replace normal user messages', () => {
    const previous: MessageBlock = {
      type: 'user',
      ts: '2026-03-19T12:00:00.000Z',
      text: 'hello there',
    };
    const next: MessageBlock = {
      type: 'user',
      ts: '2026-03-19T12:00:01.000Z',
      text: [
        '<skill name="checkpoint" location="/state/profiles/shared/agent/skills/checkpoint/INDEX.md">',
        'References are relative to /state/profiles/shared/agent/skills/checkpoint.',
        '</skill>',
      ].join('\n'),
    };

    expect(shouldReplaceOptimisticUserBlock(previous, next)).toBe(false);
  });
});
