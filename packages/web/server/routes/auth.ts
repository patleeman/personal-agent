import type { Express, NextFunction, Request, Response } from 'express';
import {
  createRemoteAccessPairingCode,
  exchangeRemoteAccessPairingCode,
  readRemoteAccessAdminState,
  readRemoteAccessSession,
  revokeRemoteAccessSession,
  revokeRemoteAccessSessionByToken,
} from '../ui/remoteAccessAuth.js';
import { createInMemoryRateLimit, resolveRequestOrigin } from '../middleware/index.js';

const REMOTE_ACCESS_SESSION_COOKIE = 'pa_web';

const remoteAccessExchangeRateLimit = createInMemoryRateLimit({
  windowMs: 60_000,
  maxRequests: 10,
  key: (req) => req.ip || req.socket.remoteAddress || 'unknown',
  message: 'Too many pairing attempts. Try again in a minute.',
});

function readCookieValue(req: Request, cookieName: string): string {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string' || cookieHeader.trim().length === 0) {
    return '';
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [rawName, ...valueParts] = pair.split('=');
    if (rawName?.trim() !== cookieName) {
      continue;
    }

    return decodeURIComponent(valueParts.join('=').trim());
  }

  return '';
}

function shouldUseSecureAuthCookie(req: Request): boolean {
  const origin = resolveRequestOrigin({
    host: req.get('host'),
    forwardedHost: req.get('x-forwarded-host'),
    protocol: req.protocol,
    forwardedProto: req.get('x-forwarded-proto'),
  });

  return origin?.startsWith('https://') === true;
}

function normalizeAuthHost(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return '';
  }

  const token = value.split(',')[0]?.trim().toLowerCase() ?? '';
  return token.replace(/^\[/, '').replace(/\]$/, '').replace(/:\d+$/, '');
}

function isTailnetRemoteAccessRequest(req: Request): boolean {
  const host = normalizeAuthHost(req.get('x-forwarded-host') ?? req.get('host') ?? null);
  if (host.endsWith('.ts.net')) {
    return true;
  }

  return ['tailscale-user-login', 'tailscale-user-name', 'tailscale-user-profile-pic', 'tailscale-app-capabilities']
    .some((headerName) => typeof req.get(headerName) === 'string' && req.get(headerName)!.trim().length > 0);
}

function setRemoteAccessSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(REMOTE_ACCESS_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureAuthCookie(req),
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearRemoteAccessSessionCookie(req: Request, res: Response): void {
  res.clearCookie(REMOTE_ACCESS_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureAuthCookie(req),
    path: '/',
  });
}

function readCurrentRemoteAccessSession(req: Request, res: Response): ReturnType<typeof readRemoteAccessSession> {
  const sessionToken = readCookieValue(req, REMOTE_ACCESS_SESSION_COOKIE);
  const session = readRemoteAccessSession(sessionToken);
  if (!session) {
    clearRemoteAccessSessionCookie(req, res);
    return null;
  }

  setRemoteAccessSessionCookie(req, res, sessionToken);
  return session;
}

function ensureRemoteAccessSession(req: Request, res: Response): ReturnType<typeof readRemoteAccessSession> {
  const session = readCurrentRemoteAccessSession(req, res);
  if (!session) {
    res.status(401).json({ error: 'Remote access sign-in required.' });
    return null;
  }

  return session;
}

function shouldRequireRemoteAccessSession(req: Request): boolean {
  return isTailnetRemoteAccessRequest(req);
}

function handleRemoteAccessSessionRequest(req: Request, res: Response): void {
  const required = shouldRequireRemoteAccessSession(req);
  if (!required) {
    res.json({ required: false, session: null });
    return;
  }

  const session = readCurrentRemoteAccessSession(req, res);
  res.json({ required: true, session });
}

function handleRemoteAccessExchangeRequest(req: Request, res: Response): void {
  try {
    const { code, deviceLabel } = req.body as { code?: unknown; deviceLabel?: unknown };
    if (typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({ error: 'Pairing code required.' });
      return;
    }

    const exchanged = exchangeRemoteAccessPairingCode(code, {
      ...(typeof deviceLabel === 'string' ? { deviceLabel } : {}),
    });
    setRemoteAccessSessionCookie(req, res, exchanged.sessionToken);
    res.status(201).json({ required: true, session: exchanged.session });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes('invalid or expired') ? 400 : 500).json({ error: message });
  }
}

function handleRemoteAccessLogoutRequest(req: Request, res: Response): void {
  revokeRemoteAccessSessionByToken(readCookieValue(req, REMOTE_ACCESS_SESSION_COOKIE));
  clearRemoteAccessSessionCookie(req, res);
  res.json({ ok: true });
}

function handleRemoteAccessStateRequest(_req: Request, res: Response): void {
  try {
    res.json(readRemoteAccessAdminState());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

function handleRemoteAccessCreatePairingCodeRequest(_req: Request, res: Response): void {
  try {
    res.status(201).json(createRemoteAccessPairingCode());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

function handleRemoteAccessRevokeSessionRequest(req: Request, res: Response): void {
  try {
    revokeRemoteAccessSession(req.params.sessionId);
    res.json({ ok: true, state: readRemoteAccessAdminState() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

function handleRemoteAccessGate(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/remote-access/session' || req.path === '/remote-access/exchange' || req.path === '/remote-access/logout') {
    next();
    return;
  }

  if (!shouldRequireRemoteAccessSession(req)) {
    next();
    return;
  }

  if (!ensureRemoteAccessSession(req, res)) {
    return;
  }

  next();
}

function registerRemoteAccessAdminRoutes(app: Express): void {
  app.get('/api/remote-access', handleRemoteAccessStateRequest);
  app.post('/api/remote-access/pairing-code', handleRemoteAccessCreatePairingCodeRequest);
  app.delete('/api/remote-access/sessions/:sessionId', handleRemoteAccessRevokeSessionRequest);
}

export function registerAuthRoutes(app: Express): void {
  app.get('/api/remote-access/session', handleRemoteAccessSessionRequest);
  app.post('/api/remote-access/exchange', remoteAccessExchangeRateLimit, handleRemoteAccessExchangeRequest);
  app.post('/api/remote-access/logout', handleRemoteAccessLogoutRequest);

  app.use('/api', (req, res, next) => {
    handleRemoteAccessGate(req, res, next);
  });

  registerRemoteAccessAdminRoutes(app);
}
