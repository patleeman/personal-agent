import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api.memory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dedupes concurrent requests for the same profile', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ skills: [], memoryDocs: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    const [first, second] = await Promise.all([
      api.memory(),
      api.memory(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ skills: [], memoryDocs: [] });
    expect(second).toEqual(first);
  });

  it('keeps profile-scoped requests separate', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ skills: [], memoryDocs: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    await Promise.all([
      api.memory({ profile: 'assistant' }),
      api.memory({ profile: 'shared' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/memory?viewProfile=assistant');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/memory?viewProfile=shared');
  });
});
