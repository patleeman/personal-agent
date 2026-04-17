import { describe, expect, it, vi } from 'vitest';
import {
  normalizePendingQueueItems,
  retryLiveSessionActionAfterTakeover,
} from './useSessionStream';

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


