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

describe('api.conversationBootstrap desktop transport', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', {
      location: { pathname: '/' },
    });
  });

  it('uses the desktop bridge on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const readConversationBootstrap = vi.fn().mockResolvedValue(createBootstrapState());
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
        readConversationBootstrap,
      },
    });

    const { api } = await import('./api');
    const result = await api.conversationBootstrap('conversation-1', {
      knownSessionSignature: 'sig-1',
      tailBlocks: 12,
    });

    expect(getEnvironment).toHaveBeenCalledTimes(1);
    expect(readConversationBootstrap).toHaveBeenCalledWith('conversation-1', {
      knownSessionSignature: 'sig-1',
      tailBlocks: 12,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual(createBootstrapState());
  });

  it('falls back to HTTP for non-local desktop hosts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(createBootstrapState({
      conversationId: 'remote-conversation',
    })));
    vi.stubGlobal('fetch', fetchMock);
    const readConversationBootstrap = vi.fn();
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
        readConversationBootstrap,
      },
    });

    const { api } = await import('./api');
    const result = await api.conversationBootstrap('remote-conversation', {
      knownSessionSignature: 'sig-2',
      tailBlocks: 5,
    });

    expect(readConversationBootstrap).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/remote-conversation/bootstrap?tailBlocks=5&knownSessionSignature=sig-2',
      { cache: 'no-store' },
    );
    expect(result.conversationId).toBe('remote-conversation');
  });
});
