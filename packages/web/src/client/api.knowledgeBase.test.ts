import { afterEach, describe, expect, it, vi } from 'vitest';

describe('api.knowledgeBase', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('reuses the in-flight knowledge base request across concurrent callers', async () => {
    let resolveFetch: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api');

    const first = api.knowledgeBase();
    const second = api.knowledgeBase();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(new Response(JSON.stringify({
      repoUrl: 'https://github.com/patleeman/knowledge-base.git',
      branch: 'main',
      configured: true,
      effectiveRoot: '/vault',
      managedRoot: '/runtime/knowledge-base/repo',
      usesManagedRoot: true,
      syncStatus: 'idle',
      recoveredEntryCount: 0,
      recoveryDir: '/runtime/knowledge-base/recovered',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(first).resolves.toMatchObject({ configured: true, branch: 'main' });
    await expect(second).resolves.toMatchObject({ configured: true, branch: 'main' });
  });
});
