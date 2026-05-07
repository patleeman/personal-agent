import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api.extensions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads extension command registrations', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ extensionId: 'agent-board', surfaceId: 'task', name: 'task' }]));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    await expect(api.extensionSlashCommands()).resolves.toEqual([{ extensionId: 'agent-board', surfaceId: 'task', name: 'task' }]);

    expect(fetchMock).toHaveBeenCalledWith('/api/extensions/slash-commands', { method: 'GET', cache: 'no-store' });
  });
});

describe('api.memory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dedupes concurrent memory requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ skills: [], memoryDocs: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    const [first, second] = await Promise.all([api.memory(), api.memory()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ skills: [], memoryDocs: [] });
    expect(second).toEqual(first);
  });

  it('ignores legacy profile arguments for memory requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ skills: [], memoryDocs: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    await Promise.all([api.memory(), api.memory()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/memory');
  });
});
