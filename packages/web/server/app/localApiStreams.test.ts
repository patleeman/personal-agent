import { describe, expect, it, vi } from 'vitest';

const {
  getDurableRunLogCursorMock,
  getDurableRunSnapshotMock,
  inlineConversationSessionSnapshotAssetsCapabilityMock,
  readDurableRunLogDeltaMock,
  subscribeLiveSessionMock,
  subscribeProviderOAuthLoginMock,
} = vi.hoisted(() => ({
  getDurableRunLogCursorMock: vi.fn(),
  getDurableRunSnapshotMock: vi.fn(),
  inlineConversationSessionSnapshotAssetsCapabilityMock: vi.fn((_: string, event: unknown) => event),
  readDurableRunLogDeltaMock: vi.fn(),
  subscribeLiveSessionMock: vi.fn(),
  subscribeProviderOAuthLoginMock: vi.fn(),
}));

vi.mock('../automation/durableRuns.js', () => ({
  getDurableRunLogCursor: getDurableRunLogCursorMock,
  getDurableRunSnapshot: getDurableRunSnapshotMock,
  readDurableRunLogDelta: readDurableRunLogDeltaMock,
}));

vi.mock('../conversations/conversationSessionAssetCapability.js', () => ({
  inlineConversationSessionSnapshotAssetsCapability: inlineConversationSessionSnapshotAssetsCapabilityMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  subscribe: subscribeLiveSessionMock,
}));

vi.mock('../models/providerAuth.js', () => ({
  subscribeProviderOAuthLogin: subscribeProviderOAuthLoginMock,
}));

import { subscribeDesktopLocalApiStreamByUrl } from './localApiStreams.js';

describe('localApiStreams', () => {
  it('ignores malformed live stream tailBlocks instead of partially parsing them', async () => {
    const unsubscribe = vi.fn();
    subscribeLiveSessionMock.mockImplementation((_sessionId, listener) => {
      listener({ type: 'snapshot', blocks: [], blockOffset: 0, totalBlocks: 0, isStreaming: false });
      return unsubscribe;
    });
    const events: unknown[] = [];

    await subscribeDesktopLocalApiStreamByUrl(
      new URL('http://local.test/api/live-sessions/session-1/events?tailBlocks=20abc'),
      (event) => events.push(event),
    );

    expect(subscribeLiveSessionMock).toHaveBeenCalledWith('session-1', expect.any(Function), {});
    expect(events).toEqual(expect.arrayContaining([
      { type: 'open' },
      { type: 'message', data: JSON.stringify({ type: 'snapshot', blocks: [], blockOffset: 0, totalBlocks: 0, isStreaming: false }) },
    ]));
  });
});
