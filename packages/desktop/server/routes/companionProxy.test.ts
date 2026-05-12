import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCompanionUrlMock, logErrorMock } = vi.hoisted(() => ({
  getCompanionUrlMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('../daemon/client.js', () => ({
  getCompanionUrl: getCompanionUrlMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import { registerCompanionProxyRoutes } from './companionProxy.js';

type TestRequest = {
  method: string;
  originalUrl: string;
  body?: unknown;
  get: (name: string) => string | undefined;
};

type TestResponse = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

type TestHandler = (req: TestRequest, res: TestResponse) => Promise<void> | void;

describe('registerCompanionProxyRoutes', () => {
  beforeEach(() => {
    getCompanionUrlMock.mockReset();
    logErrorMock.mockReset();
    vi.restoreAllMocks();
  });

  function createHarness() {
    const handlers: Record<string, TestHandler> = {};
    const router = {
      get: vi.fn((path: string, handler: TestHandler) => {
        handlers[`GET ${path}`] = handler;
      }),
      post: vi.fn((path: string, handler: TestHandler) => {
        handlers[`POST ${path}`] = handler;
      }),
      patch: vi.fn((path: string, handler: TestHandler) => {
        handlers[`PATCH ${path}`] = handler;
      }),
      delete: vi.fn((path: string, handler: TestHandler) => {
        handlers[`DELETE ${path}`] = handler;
      }),
    };

    registerCompanionProxyRoutes(router as never);
    return handlers;
  }

  function createResponse(): TestResponse {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      send: vi.fn(),
    };
  }

  it('proxies companion API requests to the daemon companion server', async () => {
    const handlers = createHarness();
    getCompanionUrlMock.mockResolvedValue('http://127.0.0.1:3843');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    );

    const res = createResponse();
    await handlers['POST /api/companion/v1/*']!(
      {
        method: 'POST',
        originalUrl: '/api/companion/v1/admin/setup?refresh=1',
        body: { create: true },
        get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : undefined),
      },
      res,
    );

    expect(fetchMock).toHaveBeenCalledWith(new URL('http://127.0.0.1:3843/companion/v1/admin/setup?refresh=1'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ create: true }),
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/json; charset=utf-8');
    expect(res.send).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  });

  it('returns JSON instead of falling through to the SPA when companion is unavailable', async () => {
    const handlers = createHarness();
    getCompanionUrlMock.mockResolvedValue(null);

    const res = createResponse();
    await handlers['GET /api/companion/v1/*']!({ method: 'GET', originalUrl: '/api/companion/v1/hello', get: () => undefined }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Companion server is not available.' });
  });
});
