import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDurableRunLogCursorMock,
  getDurableRunSnapshotMock,
  inlineConversationSessionSnapshotAssetsCapabilityMock,
  readDurableRunLogDeltaMock,
  readWorkspaceRootSnapshotMock,
  subscribeLiveSessionMock,
  subscribeProviderOAuthLoginMock,
  watchMock,
} = vi.hoisted(() => ({
  getDurableRunLogCursorMock: vi.fn(),
  getDurableRunSnapshotMock: vi.fn(),
  inlineConversationSessionSnapshotAssetsCapabilityMock: vi.fn((_: string, event: unknown) => event),
  readDurableRunLogDeltaMock: vi.fn(),
  readWorkspaceRootSnapshotMock: vi.fn(),
  subscribeLiveSessionMock: vi.fn(),
  subscribeProviderOAuthLoginMock: vi.fn(),
  watchMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
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

  it('streams workspace file changes through the desktop local API bridge', async () => {
    const close = vi.fn();
    let watcher: ((eventType: string, filename: string) => void) | null = null;
    readWorkspaceRootSnapshotMock.mockReturnValue({ root: '/repo' });
    watchMock.mockImplementation((_path, _options, listener) => {
      watcher = listener;
      return { close };
    });
    const events: unknown[] = [];

    const unsubscribe = await subscribeDesktopLocalApiStreamByUrl(new URL('http://local.test/api/workspace/events?cwd=%2Frepo'), (event) =>
      events.push(event),
    );
    watcher?.('change', 'README.md');
    unsubscribe();

    expect(readWorkspaceRootSnapshotMock).toHaveBeenCalledWith('/repo');
    expect(watchMock).toHaveBeenCalledWith('/repo', { recursive: true }, expect.any(Function));
    expect(events).toEqual([
      { type: 'open' },
      { type: 'message', data: JSON.stringify({ type: 'ready', root: '/repo' }) },
      { type: 'message', data: JSON.stringify({ type: 'workspace', eventType: 'change', path: 'README.md' }) },
      { type: 'close' },
    ]);
    expect(close).toHaveBeenCalledOnce();
  });
});
