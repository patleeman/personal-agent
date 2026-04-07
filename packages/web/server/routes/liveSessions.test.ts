import { describe, expect, it } from 'vitest';
import { shouldRequireCompanionSessionForLiveSessionSse } from './liveSessions.js';

describe('shouldRequireCompanionSessionForLiveSessionSse', () => {
  it('does not require companion auth for desktop live-session SSE routes', () => {
    expect(shouldRequireCompanionSessionForLiveSessionSse({
      originalUrl: '/api/live-sessions/conv-123/events',
      url: '/api/live-sessions/conv-123/events',
    })).toBe(false);
  });

  it('requires companion auth for companion live-session SSE routes', () => {
    expect(shouldRequireCompanionSessionForLiveSessionSse({
      originalUrl: '/app/api/live-sessions/conv-123/events',
      url: '/api/live-sessions/conv-123/events',
    })).toBe(true);
  });

  it('falls back to the current request url when originalUrl is unavailable', () => {
    expect(shouldRequireCompanionSessionForLiveSessionSse({
      originalUrl: undefined,
      url: '/app/api/live-sessions/conv-123/events',
    })).toBe(true);
  });
});
