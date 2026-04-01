import type { Express, NextFunction, Request, Response } from 'express';
import {
  createCompanionPairingCode,
  exchangeCompanionPairingCode,
  readCompanionAuthAdminState,
  readCompanionSession,
  revokeCompanionSession,
  revokeCompanionSessionByToken,
} from '../companionAuth.js';
import { createInMemoryRateLimit, resolveRequestOrigin } from '../middleware/index.js';

const DESKTOP_SESSION_COOKIE = 'pa_web';
const COMPANION_SESSION_COOKIE = 'pa_companion';

const companionAuthExchangeRateLimit = createInMemoryRateLimit({
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

function isTailnetDesktopRequest(req: Request): boolean {
  const host = normalizeAuthHost(req.get('x-forwarded-host') ?? req.get('host') ?? null);
  if (host.endsWith('.ts.net')) {
    return true;
  }

  return ['tailscale-user-login', 'tailscale-user-name', 'tailscale-user-profile-pic', 'tailscale-app-capabilities']
    .some((headerName) => typeof req.get(headerName) === 'string' && req.get(headerName)!.trim().length > 0);
}

function setDesktopSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(DESKTOP_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureAuthCookie(req),
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearDesktopSessionCookie(req: Request, res: Response): void {
  res.clearCookie(DESKTOP_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureAuthCookie(req),
    path: '/',
  });
}

function readDesktopSession(req: Request, res: Response): ReturnType<typeof readCompanionSession> {
  const sessionToken = readCookieValue(req, DESKTOP_SESSION_COOKIE);
  const session = readCompanionSession(sessionToken, { surface: 'desktop' });
  if (!session) {
    clearDesktopSessionCookie(req, res);
    return null;
  }

  return session;
}

function ensureDesktopSession(req: Request, res: Response): ReturnType<typeof readCompanionSession> {
  const session = readDesktopSession(req, res);
  if (!session) {
    res.status(401).json({ error: 'Desktop sign-in required.' });
    return null;
  }

  return session;
}

function shouldRequireDesktopSession(req: Request): boolean {
  return isTailnetDesktopRequest(req);
}

function setCompanionSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(COMPANION_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureAuthCookie(req),
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearCompanionSessionCookie(req: Request, res: Response): void {
  res.clearCookie(COMPANION_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureAuthCookie(req),
    path: '/',
  });
}

function ensureCompanionSession(req: Request, res: Response): ReturnType<typeof readCompanionSession> {
  const sessionToken = readCookieValue(req, COMPANION_SESSION_COOKIE);
  const session = readCompanionSession(sessionToken, { surface: 'companion' });
  if (!session) {
    clearCompanionSessionCookie(req, res);
    res.status(401).json({ error: 'Companion sign-in required.' });
    return null;
  }

  return session;
}

function handleDesktopAuthSessionRequest(req: Request, res: Response): void {
  const required = shouldRequireDesktopSession(req);
  if (!required) {
    res.json({ required: false, session: null });
    return;
  }

  const session = readDesktopSession(req, res);
  res.json({ required: true, session });
}

function handleDesktopAuthExchangeRequest(req: Request, res: Response): void {
  try {
    const { code, deviceLabel } = req.body as { code?: unknown; deviceLabel?: unknown };
    if (typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({ error: 'Pairing code required.' });
      return;
    }

    const exchanged = exchangeCompanionPairingCode(code, {
      ...(typeof deviceLabel === 'string' ? { deviceLabel } : {}),
      surface: 'desktop',
    });
    setDesktopSessionCookie(req, res, exchanged.sessionToken);
    res.status(201).json({ required: true, session: exchanged.session });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes('invalid or expired') ? 400 : 500).json({ error: message });
  }
}

function handleDesktopAuthLogoutRequest(req: Request, res: Response): void {
  revokeCompanionSessionByToken(readCookieValue(req, DESKTOP_SESSION_COOKIE));
  clearDesktopSessionCookie(req, res);
  res.json({ ok: true });
}

function handleCompanionAuthExchangeRequest(req: Request, res: Response): void {
  try {
    const { code, deviceLabel } = req.body as { code?: unknown; deviceLabel?: unknown };
    if (typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({ error: 'Pairing code required.' });
      return;
    }

    const exchanged = exchangeCompanionPairingCode(code, {
      ...(typeof deviceLabel === 'string' ? { deviceLabel } : {}),
      surface: 'companion',
    });
    setCompanionSessionCookie(req, res, exchanged.sessionToken);
    res.status(201).json({ session: exchanged.session });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes('invalid or expired') ? 400 : 500).json({ error: message });
  }
}

function handleCompanionAuthSessionRequest(req: Request, res: Response): void {
  const session = ensureCompanionSession(req, res);
  if (!session) {
    return;
  }

  res.json({ session });
}

function handleCompanionAuthLogoutRequest(req: Request, res: Response): void {
  revokeCompanionSessionByToken(readCookieValue(req, COMPANION_SESSION_COOKIE));
  clearCompanionSessionCookie(req, res);
  res.json({ ok: true });
}

function handleCompanionAuthStateRequest(_req: Request, res: Response): void {
  try {
    res.json(readCompanionAuthAdminState());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

function handleCompanionAuthCreatePairingCodeRequest(_req: Request, res: Response): void {
  try {
    res.status(201).json(createCompanionPairingCode());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

function handleCompanionAuthRevokeSessionRequest(req: Request, res: Response): void {
  try {
    revokeCompanionSession(req.params.sessionId);
    res.json({ ok: true, state: readCompanionAuthAdminState() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

function handleDesktopAuthGate(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/desktop-auth/session' || req.path === '/desktop-auth/exchange' || req.path === '/desktop-auth/logout') {
    next();
    return;
  }

  if (!shouldRequireDesktopSession(req)) {
    next();
    return;
  }

  if (!ensureDesktopSession(req, res)) {
    return;
  }

  next();
}

function handleCompanionAuthGate(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/companion-auth/session' || req.path === '/companion-auth/exchange' || req.path === '/companion-auth/logout') {
    next();
    return;
  }

  if (!ensureCompanionSession(req, res)) {
    return;
  }

  next();
}

export function registerAuthRoutes(app: Express): void {
  app.get('/api/desktop-auth/session', handleDesktopAuthSessionRequest);
  app.post('/api/desktop-auth/exchange', companionAuthExchangeRateLimit, handleDesktopAuthExchangeRequest);
  app.post('/api/desktop-auth/logout', handleDesktopAuthLogoutRequest);

  app.use('/api', (req, res, next) => {
    handleDesktopAuthGate(req, res, next);
  });
}

export function registerCompanionAuthRoutes(app: Express): void {
  app.post('/api/companion-auth/exchange', companionAuthExchangeRateLimit, handleCompanionAuthExchangeRequest);
  app.get('/api/companion-auth/session', handleCompanionAuthSessionRequest);
  app.post('/api/companion-auth/logout', handleCompanionAuthLogoutRequest);
  app.get('/api/companion-auth', handleCompanionAuthStateRequest);
  app.post('/api/companion-auth/pairing-code', handleCompanionAuthCreatePairingCodeRequest);
  app.delete('/api/companion-auth/sessions/:sessionId', handleCompanionAuthRevokeSessionRequest);

  app.use('/api', (req, res, next) => {
    handleCompanionAuthGate(req, res, next);
  });
}
