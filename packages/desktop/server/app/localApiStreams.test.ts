import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDurableRunLogCursorMock,
  getDurableRunSnapshotMock,
  inlineConversationSessionSnapshotAssetsCapabilityMock,
  readDurableRunLogDeltaMock,
  readWorkspaceRootSnapshotMock,
  subscribeLiveSessionMock,
  subscribeProviderOAuthLoginMock,
  existsSyncMock,
  watchMock,
} = vi.hoisted(() => ({
  getDurableRunLogCursorMock: vi.fn(),
  getDurableRunSnapshotMock: vi.fn(),
  inlineConversationSessionSnapshotAssetsCapabilityMock: vi.fn((_: string, event: unknown) => event),
  readDurableRunLogDeltaMock: vi.fn(),
  readWorkspaceRootSnapshotMock: vi.fn(),
  existsSyncMock: vi.fn(),
  subscribeLiveSessionMock: vi.fn(),
  subscribeProviderOAuthLoginMock: vi.fn(),
  watchMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  watch: watchMock,
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

vi.mock('../workspace/workspaceExplorer.js', () => ({
  readWorkspaceRootSnapshot: readWorkspaceRootSnapshotMock,
}));

import { subscribeDesktopLocalApiStreamByUrl } from './localApiStreams.js';

describe('localApiStreams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(false);
  });

  it('ignores malformed live stream tailBlocks instead of partially parsing them', async () => {
    const unsubscribe = vi.fn();
    subscribeLiveSessionMock.mockImplementation((_sessionId, listener) => {
      listener({ type: 'snapshot', blocks: [], blockOffset: 0, totalBlocks: 0, isStreaming: false });
      return unsubscribe;
    });
    const events: unknown[] = [];

    await subscribeDesktopLocalApiStreamByUrl(new URL('http://local.test/api/live-sessions/session-1/events?tailBlocks=20abc'), (event) =>
      events.push(event),
    );

    expect(subscribeLiveSessionMock).toHaveBeenCalledWith('session-1', expect.any(Function), {});
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'open' },
        { type: 'message', data: JSON.stringify({ type: 'snapshot', blocks: [], blockOffset: 0, totalBlocks: 0, isStreaming: false }) },
      ]),
    );
  });

  it('ignores unsafe live stream tailBlocks', async () => {
    const unsubscribe = vi.fn();
    subscribeLiveSessionMock.mockImplementation((_sessionId, listener) => {
      listener({ type: 'snapshot', blocks: [], blockOffset: 0, totalBlocks: 0, isStreaming: false });
      return unsubscribe;
    });

    await subscribeDesktopLocalApiStreamByUrl(
      new URL(`http://local.test/api/live-sessions/session-1/events?tailBlocks=${Number.MAX_SAFE_INTEGER + 1}`),
      vi.fn(),
    );

    expect(subscribeLiveSessionMock).toHaveBeenCalledWith('session-1', expect.any(Function), {});
  });

  it('caps live stream tailBlocks before subscribing', async () => {
    const unsubscribe = vi.fn();
    subscribeLiveSessionMock.mockReturnValue(unsubscribe);

    await subscribeDesktopLocalApiStreamByUrl(new URL('http://local.test/api/live-sessions/session-1/events?tailBlocks=5000'), vi.fn());

    expect(subscribeLiveSessionMock).toHaveBeenCalledWith('session-1', expect.any(Function), { tailBlocks: 1000 });
  });

  it('streams debounced workspace changes through the desktop local API bridge without recursive repo watches', async () => {
    vi.useFakeTimers();
    try {
      const close = vi.fn();
      let watcher: (() => void) | null = null;
      readWorkspaceRootSnapshotMock.mockReturnValue({ root: '/repo' });
      watchMock.mockImplementation((_path, listener) => {
        watcher = listener;
        return { close };
      });
      const events: unknown[] = [];

      const unsubscribe = await subscribeDesktopLocalApiStreamByUrl(
        new URL('http://local.test/api/workspace/events?cwd=%2Frepo'),
        (event) => events.push(event),
      );
      watcher?.();
      watcher?.();
      await vi.advanceTimersByTimeAsync(250);
      unsubscribe();

      expect(readWorkspaceRootSnapshotMock).toHaveBeenCalledWith('/repo');
      expect(watchMock).toHaveBeenCalledWith('/repo', expect.any(Function));
      expect(watchMock).not.toHaveBeenCalledWith('/repo', { recursive: true }, expect.any(Function));
      expect(events).toEqual([
        { type: 'open' },
        { type: 'message', data: JSON.stringify({ type: 'ready', root: '/repo' }) },
        { type: 'message', data: JSON.stringify({ type: 'workspace' }) },
        { type: 'close' },
      ]);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
