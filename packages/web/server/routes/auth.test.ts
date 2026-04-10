import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createRemoteAccessPairingCodeMock,
  createInMemoryRateLimitMock,
  exchangeRemoteAccessPairingCodeMock,
  rateLimitMiddlewareMock,
  readRemoteAccessAdminStateMock,
  readRemoteAccessSessionMock,
  resolveRequestOriginMock,
  revokeRemoteAccessSessionByTokenMock,
  revokeRemoteAccessSessionMock,
} = vi.hoisted(() => {
  const rateLimitMiddlewareMock = vi.fn((_req: unknown, _res: unknown, next: () => void) => {
    next();
  });

  return {
    createRemoteAccessPairingCodeMock: vi.fn(),
    createInMemoryRateLimitMock: vi.fn(() => rateLimitMiddlewareMock),
    exchangeRemoteAccessPairingCodeMock: vi.fn(),
    rateLimitMiddlewareMock,
    readRemoteAccessAdminStateMock: vi.fn(),
    readRemoteAccessSessionMock: vi.fn(),
    resolveRequestOriginMock: vi.fn(),
    revokeRemoteAccessSessionByTokenMock: vi.fn(),
    revokeRemoteAccessSessionMock: vi.fn(),
  };
});

vi.mock('../ui/remoteAccessAuth.js', () => ({
  createRemoteAccessPairingCode: createRemoteAccessPairingCodeMock,
  exchangeRemoteAccessPairingCode: exchangeRemoteAccessPairingCodeMock,
  readRemoteAccessAdminState: readRemoteAccessAdminStateMock,
  readRemoteAccessSession: readRemoteAccessSessionMock,
  revokeRemoteAccessSession: revokeRemoteAccessSessionMock,
  revokeRemoteAccessSessionByToken: revokeRemoteAccessSessionByTokenMock,
}));

vi.mock('../middleware/index.js', () => ({
  createInMemoryRateLimit: createInMemoryRateLimitMock,
  resolveRequestOrigin: resolveRequestOriginMock,
}));

import { registerAuthRoutes } from './auth.js';

type Handler = (req: unknown, res: unknown, next?: () => void) => Promise<void> | void;

function createRequest(options: {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  path?: string;
  protocol?: string;
} = {}) {
  const headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));

  return {
    body: options.body ?? {},
    headers,
    params: options.params ?? {},
    path: options.path ?? '/',
    protocol: options.protocol ?? 'http',
    ip: '127.0.0.1',
    socket: { remoteAddress: '203.0.113.5' },
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  };
}

function createResponse() {
  return {
    clearCookie: vi.fn(),
    cookie: vi.fn(),
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}

function createHarness() {
  const getHandlers = new Map<string, Handler[]>();
  const postHandlers = new Map<string, Handler[]>();
  const deleteHandlers = new Map<string, Handler[]>();
  const useHandlers = new Map<string, Handler[]>();
  const app = {
    delete: vi.fn((path: string, ...handlers: Handler[]) => {
      deleteHandlers.set(path, handlers);
    }),
    get: vi.fn((path: string, ...handlers: Handler[]) => {
      getHandlers.set(path, handlers);
    }),
    post: vi.fn((path: string, ...handlers: Handler[]) => {
      postHandlers.set(path, handlers);
    }),
    use: vi.fn((path: string, ...handlers: Handler[]) => {
      useHandlers.set(path, handlers);
    }),
  };

  registerAuthRoutes(app as never);

  return {
    deleteHandler: (path: string) => deleteHandlers.get(path) ?? [],
    getHandler: (path: string) => getHandlers.get(path) ?? [],
    postHandler: (path: string) => postHandlers.get(path) ?? [],
    useHandler: (path: string) => useHandlers.get(path) ?? [],
  };
}

describe('auth routes', () => {
  beforeEach(() => {
    createRemoteAccessPairingCodeMock.mockReset();
    createInMemoryRateLimitMock.mockClear();
    exchangeRemoteAccessPairingCodeMock.mockReset();
    rateLimitMiddlewareMock.mockClear();
    rateLimitMiddlewareMock.mockImplementation((_req: unknown, _res: unknown, next: () => void) => {
      next();
    });
    readRemoteAccessAdminStateMock.mockReset();
    readRemoteAccessSessionMock.mockReset();
    resolveRequestOriginMock.mockReset();
    resolveRequestOriginMock.mockImplementation(({ forwardedHost, host, forwardedProto, protocol }) => {
      const resolvedHost = forwardedHost ?? host;
      if (!resolvedHost) {
        return null;
      }
      return `${forwardedProto ?? protocol ?? 'http'}://${resolvedHost}`;
    });
    revokeRemoteAccessSessionByTokenMock.mockReset();
    revokeRemoteAccessSessionMock.mockReset();
  });

  it('handles remote access session lookups for public requests, expired tailnet sessions, and valid sessions', () => {
    const harness = createHarness();
    const [sessionHandler] = harness.getHandler('/api/remote-access/session');

    const publicRes = createResponse();
    sessionHandler(createRequest({ headers: { host: 'localhost:3000' } }), publicRes);
    expect(publicRes.json).toHaveBeenCalledWith({ required: false, session: null });
    expect(readRemoteAccessSessionMock).not.toHaveBeenCalled();

    readRemoteAccessSessionMock.mockReturnValueOnce(null);
    const expiredRes = createResponse();
    sessionHandler(createRequest({
      headers: {
        cookie: 'foo=bar; pa_web=desktop%3Dtoken',
        host: 'localhost:3000',
        'x-forwarded-host': 'device.ts.net:443, proxy',
        'x-forwarded-proto': 'https',
      },
    }), expiredRes);
    expect(readRemoteAccessSessionMock).toHaveBeenCalledWith('desktop=token');
    expect(expiredRes.clearCookie).toHaveBeenCalledWith('pa_web', expect.objectContaining({ secure: true, path: '/' }));
    expect(expiredRes.json).toHaveBeenCalledWith({ required: true, session: null });

    const session = { id: 'desktop-session' };
    readRemoteAccessSessionMock.mockReturnValueOnce(session);
    const validRes = createResponse();
    sessionHandler(createRequest({
      headers: {
        cookie: 'pa_web=desktop%3Dtoken',
        host: 'device.ts.net',
      },
      protocol: 'https',
    }), validRes);
    expect(validRes.cookie).toHaveBeenCalledWith('pa_web', 'desktop=token', expect.objectContaining({
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    }));
    expect(validRes.json).toHaveBeenCalledWith({ required: true, session });
  });

  it('handles remote access exchange, logout, and admin routes', () => {
    const harness = createHarness();
    const desktopExchangeHandlers = harness.postHandler('/api/remote-access/exchange');
    const desktopLogoutHandlers = harness.postHandler('/api/remote-access/logout');
    const [adminStateHandler] = harness.getHandler('/api/remote-access');
    const [pairingCodeHandler] = harness.postHandler('/api/remote-access/pairing-code');
    const [revokeSessionHandler] = harness.deleteHandler('/api/remote-access/sessions/:sessionId');

    expect(desktopExchangeHandlers).toHaveLength(2);
    expect(desktopExchangeHandlers[0]).toBe(rateLimitMiddlewareMock);

    const missingCodeRes = createResponse();
    desktopExchangeHandlers[1]!(createRequest({ body: {} }), missingCodeRes);
    expect(missingCodeRes.status).toHaveBeenCalledWith(400);
    expect(missingCodeRes.json).toHaveBeenCalledWith({ error: 'Pairing code required.' });

    const session = { id: 'desktop-session' };
    exchangeRemoteAccessPairingCodeMock.mockReturnValueOnce({ sessionToken: 'desktop=token', session });
    const successRes = createResponse();
    desktopExchangeHandlers[1]!(createRequest({
      body: { code: 'PAIR-1234', deviceLabel: 'Mac mini' },
      headers: { host: 'device.ts.net' },
      protocol: 'https',
    }), successRes);
    expect(exchangeRemoteAccessPairingCodeMock).toHaveBeenCalledWith('PAIR-1234', { deviceLabel: 'Mac mini' });
    expect(successRes.cookie).toHaveBeenCalledWith('pa_web', 'desktop=token', expect.objectContaining({ secure: true }));
    expect(successRes.status).toHaveBeenCalledWith(201);
    expect(successRes.json).toHaveBeenCalledWith({ required: true, session });

    exchangeRemoteAccessPairingCodeMock.mockImplementationOnce(() => {
      throw new Error('Pairing code is invalid or expired.');
    });
    const expiredRes = createResponse();
    desktopExchangeHandlers[1]!(createRequest({ body: { code: 'expired' } }), expiredRes);
    expect(expiredRes.status).toHaveBeenCalledWith(400);
    expect(expiredRes.json).toHaveBeenCalledWith({ error: 'Pairing code is invalid or expired.' });

    exchangeRemoteAccessPairingCodeMock.mockImplementationOnce(() => {
      throw new Error('desktop exchange failed');
    });
    const failingExchangeRes = createResponse();
    desktopExchangeHandlers[1]!(createRequest({ body: { code: 'PAIR-9999' } }), failingExchangeRes);
    expect(failingExchangeRes.status).toHaveBeenCalledWith(500);
    expect(failingExchangeRes.json).toHaveBeenCalledWith({ error: 'desktop exchange failed' });

    const logoutRes = createResponse();
    desktopLogoutHandlers[0]!(createRequest({ headers: { cookie: 'pa_web=desktop%3Dtoken', host: 'localhost:3000' } }), logoutRes);
    expect(revokeRemoteAccessSessionByTokenMock).toHaveBeenCalledWith('desktop=token');
    expect(logoutRes.clearCookie).toHaveBeenCalledWith('pa_web', expect.objectContaining({ secure: false, path: '/' }));
    expect(logoutRes.json).toHaveBeenCalledWith({ ok: true });

    const adminState = { sessions: [{ id: 'session-1' }], pendingPairings: [] };
    readRemoteAccessAdminStateMock.mockReturnValueOnce(adminState);
    const adminStateRes = createResponse();
    adminStateHandler(createRequest(), adminStateRes);
    expect(adminStateRes.json).toHaveBeenCalledWith(adminState);

    const pairingCode = { id: 'pair-1', code: 'ABCD-EFGH-JKLM' };
    createRemoteAccessPairingCodeMock.mockReturnValueOnce(pairingCode);
    const pairingCodeRes = createResponse();
    pairingCodeHandler(createRequest(), pairingCodeRes);
    expect(pairingCodeRes.status).toHaveBeenCalledWith(201);
    expect(pairingCodeRes.json).toHaveBeenCalledWith(pairingCode);

    readRemoteAccessAdminStateMock.mockReturnValueOnce({ sessions: [], pendingPairings: [] });
    const revokeRes = createResponse();
    revokeSessionHandler(createRequest({ params: { sessionId: 'session-1' } }), revokeRes);
    expect(revokeRemoteAccessSessionMock).toHaveBeenCalledWith('session-1');
    expect(revokeRes.json).toHaveBeenCalledWith({ ok: true, state: { sessions: [], pendingPairings: [] } });

    readRemoteAccessAdminStateMock.mockImplementationOnce(() => {
      throw new Error('state failed');
    });
    const failingAdminStateRes = createResponse();
    adminStateHandler(createRequest(), failingAdminStateRes);
    expect(failingAdminStateRes.status).toHaveBeenCalledWith(500);
    expect(failingAdminStateRes.json).toHaveBeenCalledWith({ error: 'Error: state failed' });

    createRemoteAccessPairingCodeMock.mockImplementationOnce(() => {
      throw new Error('pairing failed');
    });
    const failingPairingRes = createResponse();
    pairingCodeHandler(createRequest(), failingPairingRes);
    expect(failingPairingRes.status).toHaveBeenCalledWith(500);
    expect(failingPairingRes.json).toHaveBeenCalledWith({ error: 'Error: pairing failed' });

    revokeRemoteAccessSessionMock.mockImplementationOnce(() => {
      throw new Error('revoke failed');
    });
    const failingRevokeRes = createResponse();
    revokeSessionHandler(createRequest({ params: { sessionId: 'session-1' } }), failingRevokeRes);
    expect(failingRevokeRes.status).toHaveBeenCalledWith(500);
    expect(failingRevokeRes.json).toHaveBeenCalledWith({ error: 'Error: revoke failed' });
  });

  it('applies the remote access gate for auth endpoints, public requests, blocked tailnet requests, and valid sessions', () => {
    const harness = createHarness();
    const [desktopGate] = harness.useHandler('/api');

    const authPathNext = vi.fn();
    desktopGate(createRequest({ path: '/remote-access/session' }), createResponse(), authPathNext);
    expect(authPathNext).toHaveBeenCalledTimes(1);

    const publicNext = vi.fn();
    desktopGate(createRequest({ path: '/tasks', headers: { host: 'localhost:3000' } }), createResponse(), publicNext);
    expect(publicNext).toHaveBeenCalledTimes(1);

    readRemoteAccessSessionMock.mockReturnValueOnce(null);
    const blockedRes = createResponse();
    const blockedNext = vi.fn();
    desktopGate(createRequest({
      path: '/tasks',
      headers: {
        cookie: 'pa_web=desktop%3Dtoken',
        host: 'localhost:3000',
        'tailscale-user-login': 'patrick',
      },
    }), blockedRes, blockedNext);
    expect(readRemoteAccessSessionMock).toHaveBeenCalledWith('desktop=token');
    expect(blockedRes.status).toHaveBeenCalledWith(401);
    expect(blockedRes.json).toHaveBeenCalledWith({ error: 'Remote access sign-in required.' });
    expect(blockedRes.clearCookie).toHaveBeenCalledWith('pa_web', expect.objectContaining({ secure: false, path: '/' }));
    expect(blockedNext).not.toHaveBeenCalled();

    readRemoteAccessSessionMock.mockReturnValueOnce({ id: 'desktop-session' });
    const allowedRes = createResponse();
    const allowedNext = vi.fn();
    desktopGate(createRequest({
      path: '/tasks',
      headers: {
        cookie: 'pa_web=desktop%3Dtoken',
        host: 'device.ts.net',
      },
      protocol: 'https',
    }), allowedRes, allowedNext);
    expect(allowedRes.cookie).toHaveBeenCalledWith('pa_web', 'desktop=token', expect.objectContaining({ secure: true }));
    expect(allowedNext).toHaveBeenCalledTimes(1);
  });
});
