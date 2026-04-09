import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateWebUiRoutes, waitForWebUiHealthy } from './web-ui-health.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('validateWebUiRoutes', () => {
  it('accepts a healthy status route plus basic SPA routes', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/api/status')) {
        return new Response(JSON.stringify({ webUiRevision: 'rev-123' }), {
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

    await expect(validateWebUiRoutes('http://127.0.0.1:3741', { revision: 'rev-123' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails when /api/status is served by the wrong release', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/api/status')) {
        return new Response(JSON.stringify({ webUiRevision: 'rev-old' }), {
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

    await expect(validateWebUiRoutes('http://127.0.0.1:3741', { revision: 'rev-123' })).rejects.toThrow(
      'expected revision rev-123 but got rev-old',
    );
  });

  it('fails when /api/status returns a non-OK response and trims trailing slashes', async () => {
    const fetchMock = vi.fn(async () => new Response('busy', { status: 503 }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(validateWebUiRoutes('http://127.0.0.1:3741/')).rejects.toThrow('/api/status returned HTTP 503');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3741/api/status',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('fails when /api/status does not expose the expected revision', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/api/status')) {
        return new Response(JSON.stringify({}), {
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

    await expect(validateWebUiRoutes('http://127.0.0.1:3741', { revision: 'rev-123' })).rejects.toThrow(
      'expected revision rev-123 but got unknown',
    );
  });

  it('fails when a SPA route returns a non-OK response', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/api/status')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.endsWith('/conversations/new')) {
        return new Response('missing', { status: 404 });
      }

      return new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(validateWebUiRoutes('http://127.0.0.1:3741')).rejects.toThrow('/conversations/new returned HTTP 404');
  });

  it('fails when a SPA route is not served as html', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/api/status')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.endsWith('/')) {
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': '' },
        });
      }

      return new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(validateWebUiRoutes('http://127.0.0.1:3741')).rejects.toThrow('/ returned an unexpected content type');
  });

  it('fails when a SPA route does not render the root shell', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/api/status')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.endsWith('/conversations/new')) {
        return new Response('<!doctype html><html><body><main>missing root</main></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }

      return new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(validateWebUiRoutes('http://127.0.0.1:3741')).rejects.toThrow(
      '/conversations/new did not render the SPA shell',
    );
  });
});

describe('waitForWebUiHealthy', () => {
  it('retries until the web ui becomes healthy', async () => {
    vi.useFakeTimers();

    let statusAttempts = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/api/status')) {
        statusAttempts += 1;
        if (statusAttempts === 1) {
          throw new Error('still booting');
        }

        return new Response(JSON.stringify({}), {
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

    const healthyPromise = waitForWebUiHealthy(3741);
    await vi.advanceTimersByTimeAsync(500);

    await expect(healthyPromise).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('times out with the last non-Error failure and expected release suffix', async () => {
    vi.useFakeTimers();

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw 'socket hang up';
    }));

    const healthyPromise = waitForWebUiHealthy(3741, 1_000, { revision: 'rev-123' });
    const assertion = expect(healthyPromise).rejects.toThrow(
      'Web UI health check failed on http://localhost:3741 (rev-123): socket hang up',
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});
