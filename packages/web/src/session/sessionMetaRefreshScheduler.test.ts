import { describe, expect, it, vi } from 'vitest';
import { createSessionMetaRefreshScheduler } from './sessionMetaRefreshScheduler';

describe('createSessionMetaRefreshScheduler', () => {
  it('coalesces repeated refreshes for the same session into one trailing call', () => {
    vi.useFakeTimers();
    try {
      const refreshSessionMeta = vi.fn();
      const scheduler = createSessionMetaRefreshScheduler(refreshSessionMeta, { delayMs: 180 });

      scheduler.schedule('session-1');
      vi.advanceTimersByTime(120);
      scheduler.schedule('session-1');
      vi.advanceTimersByTime(120);
      scheduler.schedule('session-1');
      vi.advanceTimersByTime(179);

      expect(refreshSessionMeta).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(refreshSessionMeta).toHaveBeenCalledTimes(1);
      expect(refreshSessionMeta).toHaveBeenCalledWith('session-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps different sessions independent', () => {
    vi.useFakeTimers();
    try {
      const refreshSessionMeta = vi.fn();
      const scheduler = createSessionMetaRefreshScheduler(refreshSessionMeta, { delayMs: 180 });

      scheduler.schedule('session-1');
      scheduler.schedule('session-2');
      vi.advanceTimersByTime(180);

      expect(refreshSessionMeta).toHaveBeenCalledTimes(2);
      expect(refreshSessionMeta).toHaveBeenNthCalledWith(1, 'session-1');
      expect(refreshSessionMeta).toHaveBeenNthCalledWith(2, 'session-2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels pending refreshes on dispose', () => {
    vi.useFakeTimers();
    try {
      const refreshSessionMeta = vi.fn();
      const scheduler = createSessionMetaRefreshScheduler(refreshSessionMeta, { delayMs: 180 });

      scheduler.schedule('session-1');
      scheduler.dispose();
      vi.advanceTimersByTime(180);

      expect(refreshSessionMeta).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
