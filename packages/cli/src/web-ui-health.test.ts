import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateWebUiRoutes } from './web-ui-health.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('validateWebUiRoutes', () => {
  it('accepts a healthy status route plus basic SPA routes', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/api/status')) {
        return new Response(JSON.stringify({ webUiSlot: 'green', webUiRevision: 'rev-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(validateWebUiRoutes('http://127.0.0.1:3741', { slot: 'green', revision: 'rev-123' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails when /api/status is served by the wrong release', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/api/status')) {
        return new Response(JSON.stringify({ webUiSlot: 'blue', webUiRevision: 'rev-old' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(validateWebUiRoutes('http://127.0.0.1:3741', { slot: 'green', revision: 'rev-123' })).rejects.toThrow(
      'expected slot green but got blue',
    );
  });
});
