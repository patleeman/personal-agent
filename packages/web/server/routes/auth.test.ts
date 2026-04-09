import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createCompanionPairingCodeMock,
  createInMemoryRateLimitMock,
  exchangeCompanionPairingCodeMock,
  rateLimitMiddlewareMock,
  readCompanionAuthAdminStateMock,
  readCompanionSessionMock,
  resolveRequestOriginMock,
  revokeCompanionSessionByTokenMock,
  revokeCompanionSessionMock,
} = vi.hoisted(() => {
  const rateLimitMiddlewareMock = vi.fn((_req: unknown, _res: unknown, next: () => void) => {
    next();
  });

  return {
    createCompanionPairingCodeMock: vi.fn(),
    createInMemoryRateLimitMock: vi.fn(() => rateLimitMiddlewareMock),
    exchangeCompanionPairingCodeMock: vi.fn(),
    rateLimitMiddlewareMock,
    readCompanionAuthAdminStateMock: vi.fn(),
    readCompanionSessionMock: vi.fn(),
    resolveRequestOriginMock: vi.fn(),
    revokeCompanionSessionByTokenMock: vi.fn(),
    revokeCompanionSessionMock: vi.fn(),
  };
});

vi.mock('../ui/companionAuth.js', () => ({
  createCompanionPairingCode: createCompanionPairingCodeMock,
  exchangeCompanionPairingCode: exchangeCompanionPairingCodeMock,
  readCompanionAuthAdminState: readCompanionAuthAdminStateMock,
  readCompanionSession: readCompanionSessionMock,
  revokeCompanionSession: revokeCompanionSessionMock,
  revokeCompanionSessionByToken: revokeCompanionSessionByTokenMock,
}));

vi.mock('../middleware/index.js', () => ({
  createInMemoryRateLimit: createInMemoryRateLimitMock,
  resolveRequestOrigin: resolveRequestOriginMock,
}));

import { registerAuthRoutes, registerCompanionAuthRoutes } from './auth.js';

type Handler = (req: any, res: any, next?: () => void) => Promise<void> | void;

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

function createDesktopHarness() {
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

function createCompanionHarness() {
  const getHandlers = new Map<string, Handler[]>();
  const postHandlers = new Map<string, Handler[]>();
  const useHandlers = new Map<string, Handler[]>();
  const app = {
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

  registerCompanionAuthRoutes(app as never);

  return {
    getHandler: (path: string) => getHandlers.get(path) ?? [],
    postHandler: (path: string) => postHandlers.get(path) ?? [],
    useHandler: (path: string) => useHandlers.get(path) ?? [],
  };
}

describe('auth routes', () => {
  beforeEach(() => {
    createCompanionPairingCodeMock.mockReset();
    createInMemoryRateLimitMock.mockClear();
    exchangeCompanionPairingCodeMock.mockReset();
    rateLimitMiddlewareMock.mockClear();
    rateLimitMiddlewareMock.mockImplementation((_req: unknown, _res: unknown, next: () => void) => {
      next();
    });
    readCompanionAuthAdminStateMock.mockReset();
    readCompanionSessionMock.mockReset();
    resolveRequestOriginMock.mockReset();
    resolveRequestOriginMock.mockImplementation(({ forwardedHost, host, forwardedProto, protocol }) => {
      const resolvedHost = forwardedHost ?? host;
      if (!resolvedHost) {
        return null;
      }
      return `${forwardedProto ?? protocol ?? 'http'}://${resolvedHost}`;
    });
    revokeCompanionSessionByTokenMock.mockReset();
    revokeCompanionSessionMock.mockReset();
  });

  it('handles desktop session lookups for public requests, expired tailnet sessions, and valid desktop sessions', () => {
    const harness = createDesktopHarness();
    const [sessionHandler] = harness.getHandler('/api/desktop-auth/session');

    const publicRes = createResponse();
    sessionHandler(createRequest({ headers: { host: 'localhost:3000' } }), publicRes);
    expect(publicRes.json).toHaveBeenCalledWith({ required: false, session: null });
    expect(readCompanionSessionMock).not.toHaveBeenCalled();

    readCompanionSessionMock.mockReturnValueOnce(null);
    const expiredRes = createResponse();
    sessionHandler(createRequest({
      headers: {
        cookie: 'foo=bar; pa_web=desktop%3Dtoken',
        host: 'localhost:3000',
        'x-forwarded-host': 'device.ts.net:443, proxy',
        'x-forwarded-proto': 'https',
      },
    }), expiredRes);
    expect(readCompanionSessionMock).toHaveBeenCalledWith('desktop=token', { surface: 'desktop' });
    expect(expiredRes.clearCookie).toHaveBeenCalledWith('pa_web', expect.objectContaining({ secure: true, path: '/' }));
    expect(expiredRes.json).toHaveBeenCalledWith({ required: true, session: null });

    const session = { id: 'desktop-session' };
    readCompanionSessionMock.mockReturnValueOnce(session);
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

  it('handles desktop auth exchange, logout, and companion admin routes', () => {
    const harness = createDesktopHarness();
    const desktopExchangeHandlers = harness.postHandler('/api/desktop-auth/exchange');
    const desktopLogoutHandlers = harness.postHandler('/api/desktop-auth/logout');
    const [adminStateHandler] = harness.getHandler('/api/companion-auth');
    const [pairingCodeHandler] = harness.postHandler('/api/companion-auth/pairing-code');
    const [revokeSessionHandler] = harness.deleteHandler('/api/companion-auth/sessions/:sessionId');

    expect(desktopExchangeHandlers).toHaveLength(2);
    expect(desktopExchangeHandlers[0]).toBe(rateLimitMiddlewareMock);

    const missingCodeRes = createResponse();
    desktopExchangeHandlers[1]!(createRequest({ body: {} }), missingCodeRes);
    expect(missingCodeRes.status).toHaveBeenCalledWith(400);
    expect(missingCodeRes.json).toHaveBeenCalledWith({ error: 'Pairing code required.' });

    const session = { id: 'desktop-session' };
    exchangeCompanionPairingCodeMock.mockReturnValueOnce({ sessionToken: 'desktop=token', session });
    const successRes = createResponse();
    desktopExchangeHandlers[1]!(createRequest({
      body: { code: 'PAIR-1234', deviceLabel: 'Mac mini' },
      headers: { host: 'device.ts.net' },
      protocol: 'https',
    }), successRes);
    expect(exchangeCompanionPairingCodeMock).toHaveBeenCalledWith('PAIR-1234', { deviceLabel: 'Mac mini', surface: 'desktop' });
    expect(successRes.cookie).toHaveBeenCalledWith('pa_web', 'desktop=token', expect.objectContaining({ secure: true }));
    expect(successRes.status).toHaveBeenCalledWith(201);
    expect(successRes.json).toHaveBeenCalledWith({ required: true, session });

    exchangeCompanionPairingCodeMock.mockImplementationOnce(() => {
      throw new Error('Pairing code is invalid or expired.');
    });
    const expiredRes = createResponse();
    desktopExchangeHandlers[1]!(createRequest({ body: { code: 'expired' } }), expiredRes);
    expect(expiredRes.status).toHaveBeenCalledWith(400);
    expect(expiredRes.json).toHaveBeenCalledWith({ error: 'Pairing code is invalid or expired.' });

    exchangeCompanionPairingCodeMock.mockImplementationOnce(() => {
      throw new Error('desktop exchange failed');
    });
    const failingExchangeRes = createResponse();
    desktopExchangeHandlers[1]!(createRequest({ body: { code: 'PAIR-9999' } }), failingExchangeRes);
    expect(failingExchangeRes.status).toHaveBeenCalledWith(500);
    expect(failingExchangeRes.json).toHaveBeenCalledWith({ error: 'desktop exchange failed' });

    const logoutRes = createResponse();
    desktopLogoutHandlers[0]!(createRequest({ headers: { cookie: 'pa_web=desktop%3Dtoken', host: 'localhost:3000' } }), logoutRes);
    expect(revokeCompanionSessionByTokenMock).toHaveBeenCalledWith('desktop=token');
    expect(logoutRes.clearCookie).toHaveBeenCalledWith('pa_web', expect.objectContaining({ secure: false, path: '/' }));
    expect(logoutRes.json).toHaveBeenCalledWith({ ok: true });

    const adminState = { sessions: [{ id: 'session-1' }], pendingPairings: [] };
    readCompanionAuthAdminStateMock.mockReturnValueOnce(adminState);
    const adminStateRes = createResponse();
    adminStateHandler(createRequest(), adminStateRes);
    expect(adminStateRes.json).toHaveBeenCalledWith(adminState);

    const pairingCode = { id: 'pair-1', code: 'ABCD-EFGH-JKLM' };
    createCompanionPairingCodeMock.mockReturnValueOnce(pairingCode);
    const pairingCodeRes = createResponse();
    pairingCodeHandler(createRequest(), pairingCodeRes);
    expect(pairingCodeRes.status).toHaveBeenCalledWith(201);
    expect(pairingCodeRes.json).toHaveBeenCalledWith(pairingCode);

    readCompanionAuthAdminStateMock.mockReturnValueOnce({ sessions: [], pendingPairings: [] });
    const revokeRes = createResponse();
    revokeSessionHandler(createRequest({ params: { sessionId: 'session-1' } }), revokeRes);
    expect(revokeCompanionSessionMock).toHaveBeenCalledWith('session-1');
    expect(revokeRes.json).toHaveBeenCalledWith({ ok: true, state: { sessions: [], pendingPairings: [] } });

    readCompanionAuthAdminStateMock.mockImplementationOnce(() => {
      throw new Error('state failed');
    });
    const failingAdminStateRes = createResponse();
    adminStateHandler(createRequest(), failingAdminStateRes);
    expect(failingAdminStateRes.status).toHaveBeenCalledWith(500);
    expect(failingAdminStateRes.json).toHaveBeenCalledWith({ error: 'Error: state failed' });

    createCompanionPairingCodeMock.mockImplementationOnce(() => {
      throw new Error('pairing failed');
    });
    const failingPairingRes = createResponse();
    pairingCodeHandler(createRequest(), failingPairingRes);
    expect(failingPairingRes.status).toHaveBeenCalledWith(500);
    expect(failingPairingRes.json).toHaveBeenCalledWith({ error: 'Error: pairing failed' });

    revokeCompanionSessionMock.mockImplementationOnce(() => {
      throw new Error('revoke failed');
    });
    const failingRevokeRes = createResponse();
    revokeSessionHandler(createRequest({ params: { sessionId: 'session-1' } }), failingRevokeRes);
    expect(failingRevokeRes.status).toHaveBeenCalledWith(500);
    expect(failingRevokeRes.json).toHaveBeenCalledWith({ error: 'Error: revoke failed' });
  });

  it('applies the desktop auth gate for auth endpoints, public requests, blocked tailnet requests, and valid desktop sessions', () => {
    const harness = createDesktopHarness();
    const [desktopGate] = harness.useHandler('/api');

    const authPathNext = vi.fn();
    desktopGate(createRequest({ path: '/desktop-auth/session' }), createResponse(), authPathNext);
    expect(authPathNext).toHaveBeenCalledTimes(1);

    const publicNext = vi.fn();
    desktopGate(createRequest({ path: '/tasks', headers: { host: 'localhost:3000' } }), createResponse(), publicNext);
    expect(publicNext).toHaveBeenCalledTimes(1);

    readCompanionSessionMock.mockReturnValueOnce(null);
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
    expect(readCompanionSessionMock).toHaveBeenCalledWith('desktop=token', { surface: 'desktop' });
    expect(blockedRes.status).toHaveBeenCalledWith(401);
    expect(blockedRes.json).toHaveBeenCalledWith({ error: 'Desktop sign-in required.' });
    expect(blockedRes.clearCookie).toHaveBeenCalledWith('pa_web', expect.objectContaining({ secure: false, path: '/' }));
    expect(blockedNext).not.toHaveBeenCalled();

    readCompanionSessionMock.mockReturnValueOnce({ id: 'desktop-session' });
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

  it('handles companion auth exchange, session lookups, and logout', () => {
    const harness = createCompanionHarness();
    const companionExchangeHandlers = harness.postHandler('/api/companion-auth/exchange');
    const [companionSessionHandler] = harness.getHandler('/api/companion-auth/session');
    const [companionLogoutHandler] = harness.postHandler('/api/companion-auth/logout');

    expect(companionExchangeHandlers).toHaveLength(2);
    expect(companionExchangeHandlers[0]).toBe(rateLimitMiddlewareMock);

    const missingCodeRes = createResponse();
    companionExchangeHandlers[1]!(createRequest({ body: {} }), missingCodeRes);
    expect(missingCodeRes.status).toHaveBeenCalledWith(400);
    expect(missingCodeRes.json).toHaveBeenCalledWith({ error: 'Pairing code required.' });

    const companionSession = { id: 'companion-session' };
    exchangeCompanionPairingCodeMock.mockReturnValueOnce({ sessionToken: 'companion=token', session: companionSession });
    const exchangeRes = createResponse();
    companionExchangeHandlers[1]!(createRequest({
      body: { code: 'PAIR-5678', deviceLabel: 'iPhone' },
      headers: { host: 'localhost:3000' },
    }), exchangeRes);
    expect(exchangeCompanionPairingCodeMock).toHaveBeenCalledWith('PAIR-5678', { deviceLabel: 'iPhone', surface: 'companion' });
    expect(exchangeRes.cookie).toHaveBeenCalledWith('pa_companion', 'companion=token', expect.objectContaining({ secure: false }));
    expect(exchangeRes.status).toHaveBeenCalledWith(201);
    expect(exchangeRes.json).toHaveBeenCalledWith({ session: companionSession });

    exchangeCompanionPairingCodeMock.mockImplementationOnce(() => {
      throw new Error('Pairing code is invalid or expired.');
    });
    const invalidExchangeRes = createResponse();
    companionExchangeHandlers[1]!(createRequest({ body: { code: 'expired' } }), invalidExchangeRes);
    expect(invalidExchangeRes.status).toHaveBeenCalledWith(400);
    expect(invalidExchangeRes.json).toHaveBeenCalledWith({ error: 'Pairing code is invalid or expired.' });

    readCompanionSessionMock.mockReturnValueOnce(null);
    const missingSessionRes = createResponse();
    companionSessionHandler(createRequest({ headers: { host: 'localhost:3000' } }), missingSessionRes);
    expect(missingSessionRes.status).toHaveBeenCalledWith(401);
    expect(missingSessionRes.json).toHaveBeenCalledWith({ error: 'Companion sign-in required.' });

    readCompanionSessionMock.mockReturnValueOnce(companionSession);
    const sessionRes = createResponse();
    companionSessionHandler(createRequest({
      headers: {
        cookie: 'pa_companion=companion%3Dtoken',
        host: 'device.ts.net',
      },
      protocol: 'https',
    }), sessionRes);
    expect(readCompanionSessionMock).toHaveBeenCalledWith('companion=token', { surface: 'companion' });
    expect(sessionRes.cookie).toHaveBeenCalledWith('pa_companion', 'companion=token', expect.objectContaining({ secure: true }));
    expect(sessionRes.json).toHaveBeenCalledWith({ session: companionSession });

    const logoutRes = createResponse();
    companionLogoutHandler(createRequest({ headers: { cookie: 'pa_companion=companion%3Dtoken', host: 'localhost:3000' } }), logoutRes);
    expect(revokeCompanionSessionByTokenMock).toHaveBeenCalledWith('companion=token');
    expect(logoutRes.clearCookie).toHaveBeenCalledWith('pa_companion', expect.objectContaining({ secure: false, path: '/' }));
    expect(logoutRes.json).toHaveBeenCalledWith({ ok: true });
  });

  it('applies the companion auth gate for auth endpoints, blocked requests, and valid sessions', () => {
    const harness = createCompanionHarness();
    const [companionGate] = harness.useHandler('/api');

    const authPathNext = vi.fn();
    companionGate(createRequest({ path: '/companion-auth/exchange' }), createResponse(), authPathNext);
    expect(authPathNext).toHaveBeenCalledTimes(1);

    readCompanionSessionMock.mockReturnValueOnce(null);
    const blockedRes = createResponse();
    const blockedNext = vi.fn();
    companionGate(createRequest({
      path: '/tasks',
      headers: {
        cookie: 'pa_companion=companion%3Dtoken',
        host: 'localhost:3000',
      },
    }), blockedRes, blockedNext);
    expect(readCompanionSessionMock).toHaveBeenCalledWith('companion=token', { surface: 'companion' });
    expect(blockedRes.status).toHaveBeenCalledWith(401);
    expect(blockedRes.json).toHaveBeenCalledWith({ error: 'Companion sign-in required.' });
    expect(blockedRes.clearCookie).toHaveBeenCalledWith('pa_companion', expect.objectContaining({ secure: false, path: '/' }));
    expect(blockedNext).not.toHaveBeenCalled();

    readCompanionSessionMock.mockReturnValueOnce({ id: 'companion-session' });
    const allowedRes = createResponse();
    const allowedNext = vi.fn();
    companionGate(createRequest({
      path: '/tasks',
      headers: {
        cookie: 'pa_companion=companion%3Dtoken',
        host: 'device.ts.net',
      },
      protocol: 'https',
    }), allowedRes, allowedNext);
    expect(allowedRes.cookie).toHaveBeenCalledWith('pa_companion', 'companion=token', expect.objectContaining({ secure: true }));
    expect(allowedNext).toHaveBeenCalledTimes(1);
  });
});
