import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationBootstrapState } from './types';

function createBootstrapState(overrides?: Partial<ConversationBootstrapState>): ConversationBootstrapState {
  return {
    conversationId: 'conversation-1',
    sessionDetail: null,
    liveSession: { live: false },
    ...overrides,
  };
}

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('api desktop transport', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', {
      location: { pathname: '/' },
    });
  });

  it('uses the desktop local API bridge on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invokeLocalApi = vi.fn()
      .mockResolvedValueOnce({
        profile: 'assistant',
        repoRoot: '/repo',
        activityCount: 0,
        projectCount: 0,
      })
      .mockResolvedValueOnce({ ok: true });
    const readConversationBootstrap = vi.fn().mockResolvedValue(createBootstrapState());
    const createLiveSession = vi.fn().mockResolvedValue({ id: 'live-1', sessionFile: '/tmp/live-1.jsonl' });
    const resumeLiveSession = vi.fn().mockResolvedValue({ id: 'live-1' });
    const takeOverLiveSession = vi.fn().mockResolvedValue({
      surfaces: [],
      controllerSurfaceId: 'surface-1',
      controllerSurfaceType: 'desktop_web',
      controllerAcquiredAt: '2026-04-04T00:00:00.000Z',
    });
    const submitLiveSessionPrompt = vi.fn().mockResolvedValue({ ok: true, accepted: true, delivery: 'started' });
    const abortLiveSession = vi.fn().mockResolvedValue({ ok: true });
    const getEnvironment = vi.fn().mockResolvedValue({
      isElectron: true,
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
      activeHostSummary: 'Local backend is healthy.',
      canManageConnections: true,
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment,
        invokeLocalApi,
        readConversationBootstrap,
        createLiveSession,
        resumeLiveSession,
        takeOverLiveSession,
        submitLiveSessionPrompt,
        abortLiveSession,
      },
    });

    const { api } = await import('./api');
    const status = await api.status();
    const bootstrap = await api.conversationBootstrap('conversation-1', {
      knownSessionSignature: 'sig-1',
      tailBlocks: 12,
    });
    const created = await api.createLiveSession('/repo', undefined, { model: 'gpt-5.4' });
    const resumed = await api.resumeSession('/tmp/live-1.jsonl');
    const takeover = await api.takeoverLiveSession('live-1', 'surface-1');
    const prompted = await api.promptSession('live-1', 'hello', 'followUp', [], [], 'surface-1');
    const aborted = await api.abortSession('live-1', 'surface-1');
    const destroyed = await api.destroySession('conversation-1', 'surface-1');

    expect(getEnvironment).toHaveBeenCalledTimes(1);
    expect(invokeLocalApi).toHaveBeenNthCalledWith(1, 'GET', '/api/status', undefined);
    expect(readConversationBootstrap).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      tailBlocks: 12,
      knownSessionSignature: 'sig-1',
    });
    expect(createLiveSession).toHaveBeenCalledWith({ cwd: '/repo', model: 'gpt-5.4' });
    expect(resumeLiveSession).toHaveBeenCalledWith('/tmp/live-1.jsonl');
    expect(takeOverLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', surfaceId: 'surface-1' });
    expect(submitLiveSessionPrompt).toHaveBeenCalledWith({
      conversationId: 'live-1',
      text: 'hello',
      behavior: 'followUp',
      surfaceId: 'surface-1',
      images: [],
      attachmentRefs: [],
    });
    expect(abortLiveSession).toHaveBeenCalledWith('live-1');
    expect(invokeLocalApi).toHaveBeenNthCalledWith(2, 'DELETE', '/api/live-sessions/conversation-1', { surfaceId: 'surface-1' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status).toMatchObject({ profile: 'assistant' });
    expect(bootstrap).toEqual(createBootstrapState());
    expect(created).toEqual({ id: 'live-1', sessionFile: '/tmp/live-1.jsonl' });
    expect(resumed).toEqual({ id: 'live-1' });
    expect(takeover).toMatchObject({ controllerSurfaceId: 'surface-1' });
    expect(prompted).toEqual({ ok: true, accepted: true, delivery: 'started' });
    expect(aborted).toEqual({ ok: true });
    expect(destroyed).toEqual({ ok: true });
  });

  it('falls back to HTTP for non-local desktop hosts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(createBootstrapState({
      conversationId: 'remote-conversation',
    })));
    vi.stubGlobal('fetch', fetchMock);
    const invokeLocalApi = vi.fn();
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'web-1',
          activeHostLabel: 'Tailnet',
          activeHostKind: 'web',
          activeHostSummary: 'Remote host reachable.',
          canManageConnections: true,
        }),
        invokeLocalApi,
      },
    });

    const { api } = await import('./api');
    const result = await api.conversationBootstrap('remote-conversation', {
      knownSessionSignature: 'sig-2',
      tailBlocks: 5,
    });

    expect(invokeLocalApi).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/remote-conversation/bootstrap?tailBlocks=5&knownSessionSignature=sig-2',
      { method: 'GET', cache: 'no-store' },
    );
    expect(result.conversationId).toBe('remote-conversation');
  });
});
