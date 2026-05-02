import { afterEach, describe, expect, it, vi } from 'vitest';

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function normalizeFetchKey(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return `${input.pathname}${input.search}`;
  }

  return input.url;
}

function createFetchRouter(routes: Record<string, Response>) {
  return vi.fn((input: RequestInfo | URL) => {
    const key = normalizeFetchKey(input);
    const response = routes[key];
    if (!response) {
      throw new Error(`Unexpected fetch: ${key}`);
    }

    return Promise.resolve(response.clone());
  });
}

describe('api desktop reads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses app-protocol fetches for desktop reads instead of bridge fast paths', async () => {
    const fetchMock = createFetchRouter({
      '/api/status': createJsonResponse({ profile: 'assistant', repoRoot: '/repo', appRevision: 'rev-1' }),
      '/api/sessions': createJsonResponse([{ id: 'conversation-1', title: 'Conversation 1' }]),
      '/api/conversations/conversation-1/bootstrap?tailBlocks=12': createJsonResponse({
        conversationId: 'conversation-1',
        sessionDetail: null,
        liveSession: { live: false },
      }),
      '/api/conversations/conversation-1/attachments': createJsonResponse({
        conversationId: 'conversation-1',
        attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
      }),
      '/api/live-sessions/live-1/context': createJsonResponse({ cwd: '/repo', branch: 'main', git: null }),
      '/api/ui/open-conversations': createJsonResponse({
        sessionIds: ['conversation-1'],
        pinnedSessionIds: [],
        archivedSessionIds: [],
        workspacePaths: ['/repo'],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      location: { pathname: '/' },
      sessionStorage: { getItem: () => null },
    } as unknown as Window & typeof globalThis);
    vi.stubGlobal('document', {
      documentElement: { dataset: {} },
    } as unknown as Document);
    vi.stubGlobal('navigator', { userAgent: 'Electron' } as Navigator);

    const { api } = await import('./api');
    const status = await api.status();
    const sessions = await api.sessions();
    const bootstrap = await api.conversationBootstrap('conversation-1', { tailBlocks: 12 });
    const attachments = await api.conversationAttachments('conversation-1');
    const context = await api.liveSessionContext('live-1');
    const openTabs = await api.openConversationTabs();

    expect(status).toMatchObject({ profile: 'assistant' });
    expect(sessions).toEqual([{ id: 'conversation-1', title: 'Conversation 1' }]);
    expect(bootstrap.liveSession.live).toBe(false);
    expect(attachments.attachments).toHaveLength(1);
    expect(context.cwd).toBe('/repo');
    expect(openTabs.sessionIds).toEqual(['conversation-1']);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.map(([input]) => normalizeFetchKey(input))).toEqual([
      '/api/status',
      '/api/sessions',
      '/api/conversations/conversation-1/bootstrap?tailBlocks=12',
      '/api/conversations/conversation-1/attachments',
      '/api/live-sessions/live-1/context',
      '/api/ui/open-conversations',
    ]);
  });

  it('uses app-protocol fetches for search-index and fork-entry reads on local desktop', async () => {
    const fetchMock = createFetchRouter({
      '/api/sessions/search-index': createJsonResponse({ index: { 'conversation-1': 'hello world' } }),
      '/api/live-sessions/live-1/fork-entries': createJsonResponse([{ entryId: 'entry-1', text: 'fork from here' }]),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      location: { pathname: '/' },
      sessionStorage: { getItem: () => null },
    } as unknown as Window & typeof globalThis);
    vi.stubGlobal('document', {
      documentElement: { dataset: {} },
    } as unknown as Document);
    vi.stubGlobal('navigator', { userAgent: 'Electron' } as Navigator);

    const { api } = await import('./api');
    const searchIndex = await api.sessionSearchIndex(['conversation-1']);
    const forkEntries = await api.forkEntries('live-1');

    expect(searchIndex.index['conversation-1']).toBe('hello world');
    expect(forkEntries[0]?.entryId).toBe('entry-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/search-index');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/live-sessions/live-1/fork-entries');
  });
});
