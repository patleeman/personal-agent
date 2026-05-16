import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./liveSessionStaleTurns.js', () => ({
  hasQueuedOrActiveStaleTurn: vi.fn(() => false),
}));

import { canInjectResumeFallbackPrompt } from './liveSessionQueueRead.js';
import * as staleTurns from './liveSessionStaleTurns.js';

function createEntry(overrides?: Record<string, unknown>) {
  return {
    session: {
      isStreaming: false,
      getSteeringMessages: vi.fn().mockReturnValue([]),
      getFollowUpMessages: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  } as unknown;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('canInjectResumeFallbackPrompt', () => {
  it('returns true for a quiet session with no queue activity', () => {
    expect(canInjectResumeFallbackPrompt(createEntry())).toBe(true);
  });

  it('returns false for undefined entry', () => {
    expect(canInjectResumeFallbackPrompt(undefined)).toBe(false);
  });

  it('returns false when session is streaming', () => {
    expect(canInjectResumeFallbackPrompt(createEntry({ session: { isStreaming: true } }))).toBe(false);
  });

  it('returns false when there are queued or active stale turn markers', () => {
    vi.mocked(staleTurns.hasQueuedOrActiveStaleTurn).mockReturnValueOnce(true);
    expect(canInjectResumeFallbackPrompt(createEntry())).toBe(false);
  });

  it('returns false when steering messages exist', () => {
    const entry = createEntry();
    entry.session.getSteeringMessages = vi.fn().mockReturnValue([{ prompt: 'steer' }]);
    expect(canInjectResumeFallbackPrompt(entry)).toBe(false);
  });

  it('returns false when follow-up messages exist', () => {
    const entry = createEntry();
    entry.session.getFollowUpMessages = vi.fn().mockReturnValue([{ prompt: 'followup' }]);
    expect(canInjectResumeFallbackPrompt(entry)).toBe(false);
  });

  it('handles missing getSteeringMessages gracefully', () => {
    const entry = createEntry();
    delete entry.session.getSteeringMessages;
    expect(canInjectResumeFallbackPrompt(entry)).toBe(true);
  });

  it('handles missing getFollowUpMessages gracefully', () => {
    const entry = createEntry();
    delete entry.session.getFollowUpMessages;
    expect(canInjectResumeFallbackPrompt(entry)).toBe(true);
  });
});
