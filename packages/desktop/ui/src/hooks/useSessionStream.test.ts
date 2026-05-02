import { describe, expect, it, vi } from 'vitest';

import type { StreamState } from './useSessionStream';
import {
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
