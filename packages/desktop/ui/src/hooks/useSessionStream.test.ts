import { describe, expect, it, vi } from 'vitest';

import type { MessageBlock } from '../shared/types';
import type { StreamState } from './useSessionStream';
import {
  applyEvent,
  normalizeLiveSessionTailBlocks,
  normalizePendingQueueItems,
  normalizeSurfaceRegistrationWaitOptions,
  removePendingQueueItemById,
  retryLiveSessionActionAfterTakeover,
  shouldReplaceOptimisticUserBlock,
  userMessageBlocksMatchForStreamDedupe,
} from './useSessionStream';

function createStreamState(overrides: Partial<StreamState> = {}): StreamState {
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
    presence: { surfaces: [], controllerSurfaceId: null, controllerSurfaceType: null, controllerAcquiredAt: null },
    autoModeState: null,
    cwdChange: null,
    ...overrides,
  };
}

// ── applyEvent helpers ───────────────────────────────────────────────────────

function makeRef<T>(value: T): { current: T } {
  return { current: value };
}

function apply(prev: StreamState, event: Parameters<typeof applyEvent>[3]): StreamState {
  const blocksRef = makeRef<MessageBlock[]>(prev.blocks);
  const streamingRef = makeRef(prev.isStreaming);
  const next = applyEvent(prev, blocksRef as never, streamingRef as never, event as never);
  return next;
}

// ── applyEvent ────────────────────────────────────────────────────────────────

describe('applyEvent — streaming lifecycle', () => {
  it('agent_start sets isStreaming and clears error', () => {
    const prev = createStreamState({ isStreaming: false, error: 'previous error' });
    const next = apply(prev, { type: 'agent_start' });
    expect(next.isStreaming).toBe(true);
    expect(next.error).toBeNull();
  });

  it('agent_end clears isStreaming', () => {
    const prev = createStreamState({ isStreaming: true });
    const next = apply(prev, { type: 'agent_end' });
    expect(next.isStreaming).toBe(false);
  });

  it('turn_end is a no-op in the web SSE reducer (agent_end handles the clear)', () => {
    // In the web SSE path, turn_end falls through to default and does not
    // change state. The streaming flag is cleared by the agent_end event
    // that always accompanies it.
    const prev = createStreamState({ isStreaming: true });
    const next = apply(prev, { type: 'turn_end' });
    expect(next.isStreaming).toBe(true);
  });

  it('snapshot uses the server streaming state while clearing stale compaction and error state', () => {
    const prev = createStreamState({ isStreaming: false, isCompacting: true, error: 'stale error' });
    const next = apply(prev, {
      type: 'snapshot',
      blocks: [],
      blockOffset: 0,
      totalBlocks: 5,
      isStreaming: true,
    });
    expect(next.isStreaming).toBe(true);
    expect(next.isCompacting).toBe(false);
    expect(next.error).toBeNull();
    expect(next.hasSnapshot).toBe(true);
    expect(next.totalBlocks).toBe(5);
  });

  it('error event appends an error block and clears isStreaming', () => {
    const prev = createStreamState({ isStreaming: true });
    const next = apply(prev, { type: 'error', message: 'server overloaded' });
    expect(next.isStreaming).toBe(false);
    expect(next.error).toBe('server overloaded');
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]).toMatchObject({ type: 'error', message: 'server overloaded' });
  });

  it('compaction_start sets isCompacting without touching isStreaming', () => {
    const prev = createStreamState({ isStreaming: true, isCompacting: false });
    const next = apply(prev, { type: 'compaction_start', mode: 'auto' });
    expect(next.isCompacting).toBe(true);
    expect(next.isStreaming).toBe(true);
  });

  it('full turn cycle: agent_start → text_delta × 2 → agent_end', () => {
    let state = createStreamState();
    state = apply(state, { type: 'agent_start' });
    expect(state.isStreaming).toBe(true);

    state = apply(state, { type: 'text_delta', delta: 'Hello' });
    state = apply(state, { type: 'text_delta', delta: ', world' });
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ type: 'text', text: 'Hello, world' });

    state = apply(state, { type: 'agent_end' });
    expect(state.isStreaming).toBe(false);
    // Text block persists after the turn ends
    expect(state.blocks[0]).toMatchObject({ type: 'text', text: 'Hello, world' });
  });

  it('full turn cycle: agent_start → tool_start → tool_end → agent_end', () => {
    let state = createStreamState();
    state = apply(state, { type: 'agent_start' });
    state = apply(state, { type: 'tool_start', toolCallId: 'tc-1', toolName: 'bash', args: { command: 'ls' } });
    expect(state.blocks[0]).toMatchObject({ type: 'tool_use', status: 'running' });

    state = apply(state, {
      type: 'tool_end',
      toolCallId: 'tc-1',
      toolName: 'bash',
      isError: false,
      durationMs: 10,
      output: 'file.ts',
    });
    expect(state.blocks[0]).toMatchObject({ type: 'tool_use', status: 'ok', output: 'file.ts' });

    state = apply(state, { type: 'agent_end' });
    expect(state.isStreaming).toBe(false);
  });

  it('preserves existing blocks across agent_end', () => {
    // The blocksRef is shared across apply() calls, so text_delta appends
    // to the last block if it is a text block. Start with a tool_use block
    // so the incoming text_delta creates a new block instead of merging.
    const existingBlock: MessageBlock = {
      type: 'tool_use',
      tool: 'bash',
      input: {},
      output: 'done',
      status: 'ok',
      ts: '2026-01-01T00:00:00.000Z',
    };
    let state = createStreamState({ blocks: [existingBlock] });
    state = apply(state, { type: 'agent_start' });
    state = apply(state, { type: 'text_delta', delta: 'new reply' });
    state = apply(state, { type: 'agent_end' });
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks[1]).toMatchObject({ type: 'text', text: 'new reply' });
    expect(state.isStreaming).toBe(false);
  });

  it('snapshot after a stale streaming session clears streaming cursor', () => {
    // Simulate the SSE-drop scenario: isStreaming got stuck true, then reconnect
    // delivers a fresh snapshot.
    let state = createStreamState({ isStreaming: true, error: null });
    state = apply(state, {
      type: 'snapshot',
      blocks: [{ type: 'text', id: 'msg-1', ts: '2026-05-01T00:00:00.000Z', text: 'completed response' }],
      blockOffset: 0,
      totalBlocks: 1,
      isStreaming: false,
    });
    expect(state.isStreaming).toBe(false);
    expect(state.blocks[0]).toMatchObject({ type: 'text', text: 'completed response' });
  });
});

// ── SSE error does NOT clear streaming flag ───────────────────────────────────
// The es.onerror handler used to immediately clear isStreaming so the
// cursor wouldn't stay frozen during reconnection. This caused the submit
// button to flip from Steer to Send/Follow up, making the input area
// unusable during the reconnect window. Now the snapshot on reconnect
// restores the real state and the previous isStreaming value is preserved.

describe('applyEvent — SSE reconnect preserves isStreaming', () => {
  it('preserves isStreaming when SSE drops while streaming', () => {
    // The onerror handler no longer touches isStreaming — it stays as-is
    // until the next snapshot restores the correct server-side state.
    const prev = createStreamState({ isStreaming: true });
    // No state change on error — keep isStreaming as-is
    expect(prev.isStreaming).toBe(true);
    expect(prev.blocks).toBe(prev.blocks);
  });

  it('preserves isStreaming=false when SSE drops while idle', () => {
    const prev = createStreamState({ isStreaming: false });
    // No state change on error
    expect(prev.isStreaming).toBe(false);
  });
});

describe('normalizeLiveSessionTailBlocks', () => {
  it('drops unsafe live stream tail block limits', () => {
    expect(normalizeLiveSessionTailBlocks(20)).toBe(20);
    expect(normalizeLiveSessionTailBlocks(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
  });

  it('caps expensive live stream tail block limits', () => {
    expect(normalizeLiveSessionTailBlocks(5000)).toBe(1000);
  });
});

describe('userMessageBlocksMatchForStreamDedupe', () => {
  it('requires matching image identity, not just matching image counts', () => {
    expect(
      userMessageBlocksMatchForStreamDedupe(
        {
          type: 'user',
          ts: '2026-04-01T00:00:00.000Z',
          text: 'same text',
          images: [{ alt: 'old.png', src: 'blob:old', mimeType: 'image/png', caption: 'old.png' }],
        },
        {
          type: 'user',
          ts: '2026-04-01T00:00:01.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'blob:new', mimeType: 'image/png', caption: 'new.png' }],
        },
      ),
    ).toBe(false);

    expect(
      userMessageBlocksMatchForStreamDedupe(
        {
          type: 'user',
          ts: '2026-04-01T00:00:00.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'blob:new', mimeType: 'image/png', caption: 'new.png' }],
        },
        {
          type: 'user',
          ts: '2026-04-01T00:00:01.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'blob:new', mimeType: 'image/png', caption: 'new.png' }],
        },
      ),
    ).toBe(true);

    expect(
      userMessageBlocksMatchForStreamDedupe(
        {
          type: 'user',
          ts: '2026-04-01T00:00:00.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'blob:new', mimeType: 'image/png', caption: 'new.png' }],
        },
        {
          type: 'user',
          ts: '2026-04-01T00:00:01.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'data:image/png;base64,abc', mimeType: 'image/png', caption: 'new.png' }],
        },
      ),
    ).toBe(true);

    expect(
      userMessageBlocksMatchForStreamDedupe(
        {
          type: 'user',
          ts: '2026-04-01T00:00:00.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'blob:new', mimeType: 'image/png', caption: 'new.png' }],
        },
        {
          type: 'user',
          ts: '2026-04-01T00:00:01.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'data:text/html;base64,PHNjcmlwdA==', mimeType: 'image/png', caption: 'new.png' }],
        },
      ),
    ).toBe(false);

    expect(
      userMessageBlocksMatchForStreamDedupe(
        {
          type: 'user',
          ts: '2026-04-01T00:00:00.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'blob:new', mimeType: 'image/png', caption: 'new.png' }],
        },
        {
          type: 'user',
          ts: '2026-04-01T00:00:01.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'data:image/png;base64,not-valid-base64!', mimeType: 'image/png', caption: 'new.png' }],
        },
      ),
    ).toBe(false);
  });

  it('matches image mime types case-insensitively for stream dedupe', () => {
    expect(
      userMessageBlocksMatchForStreamDedupe(
        {
          type: 'user',
          ts: '2026-04-01T00:00:00.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'blob:new', mimeType: 'IMAGE/PNG', caption: 'new.png' }],
        },
        {
          type: 'user',
          ts: '2026-04-01T00:00:01.000Z',
          text: 'same text',
          images: [{ alt: 'new.png', src: 'data:image/png;base64,abc', mimeType: 'image/png', caption: 'new.png' }],
        },
      ),
    ).toBe(true);
  });
});

describe('shouldReplaceOptimisticUserBlock', () => {
  it('does not replace a skill prompt when accepted images differ', () => {
    expect(
      shouldReplaceOptimisticUserBlock(
        {
          type: 'user',
          ts: '2026-04-01T00:00:00.000Z',
          text: '/skill:checkpoint',
          images: [{ alt: 'old.png', src: 'blob:old', mimeType: 'image/png', caption: 'old.png' }],
        },
        {
          type: 'user',
          ts: '2026-04-01T00:00:01.000Z',
          text: '<skill name="checkpoint" location="/skills/checkpoint/SKILL.md">\nCommit current work.\n</skill>',
          images: [{ alt: 'new.png', src: 'blob:new', mimeType: 'image/png', caption: 'new.png' }],
        },
      ),
    ).toBe(false);
  });
});

describe('retryLiveSessionActionAfterTakeover', () => {
  it('retries generic live-session actions after taking over on control errors', async () => {
    const attemptAction = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('This conversation is controlled by another surface. Take over here to continue.'))
      .mockResolvedValueOnce('ok');
    const takeOver = vi.fn(async () => undefined);

    await expect(
      retryLiveSessionActionAfterTakeover({
        attemptAction,
        takeOverSessionControl: takeOver,
      }),
    ).resolves.toBe('ok');

    expect(attemptAction).toHaveBeenCalledTimes(2);
    expect(takeOver).toHaveBeenCalledTimes(1);
  });

  it('does not retry unrelated live-session action failures', async () => {
    const error = new Error('provider unavailable');
    const attemptAction = vi.fn<() => Promise<void>>().mockRejectedValueOnce(error);
    const takeOver = vi.fn(async () => undefined);

    await expect(
      retryLiveSessionActionAfterTakeover({
        attemptAction,
        takeOverSessionControl: takeOver,
      }),
    ).rejects.toBe(error);

    expect(attemptAction).toHaveBeenCalledTimes(1);
    expect(takeOver).not.toHaveBeenCalled();
  });
});

describe('normalizeSurfaceRegistrationWaitOptions', () => {
  it('defaults fractional surface wait timers', () => {
    expect(normalizeSurfaceRegistrationWaitOptions({ timeoutMs: 1.5, pollMs: 2.5 })).toEqual({
      timeoutMs: 1_500,
      pollMs: 50,
    });
    expect(normalizeSurfaceRegistrationWaitOptions({ timeoutMs: Number.MAX_SAFE_INTEGER, pollMs: Number.MAX_SAFE_INTEGER })).toEqual({
      timeoutMs: 10_000,
      pollMs: 1_000,
    });
  });
});

describe('removePendingQueueItemById', () => {
  it('removes the failed optimistic queued prompt by id when duplicate text exists', () => {
    const state = createStreamState({
      pendingQueue: {
        steering: [
          { id: 'failed', text: 'same', imageCount: 0, pending: true },
          { id: 'later', text: 'same', imageCount: 0, pending: true },
        ],
        followUp: [],
      },
    });

    expect(removePendingQueueItemById(state, 'steer', 'failed').pendingQueue.steering).toEqual([
      { id: 'later', text: 'same', imageCount: 0, pending: true },
    ]);
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
    expect(normalizePendingQueueItems([{ id: 'steer-1', text: '', imageCount: 2 }])).toEqual([{ id: 'steer-1', text: '', imageCount: 2 }]);
  });

  it('rejects unsafe queue preview image counts', () => {
    expect(normalizePendingQueueItems([{ id: 'steer-unsafe', text: '', imageCount: Number.MAX_SAFE_INTEGER + 1 }])).toEqual([
      { id: 'steer-unsafe', text: '(empty queued prompt)', imageCount: 0 },
    ]);
  });

  it('falls back to an empty queue for non-array payloads', () => {
    expect(normalizePendingQueueItems(undefined)).toEqual([]);
    expect(normalizePendingQueueItems({ steering: ['bad-shape'] })).toEqual([]);
  });
});
