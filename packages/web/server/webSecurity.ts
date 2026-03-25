import type { NextFunction, Request, RequestHandler, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: data:",
  "form-action 'self'",
].join('; ');

function readForwardedToken(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const token = value.split(',')[0]?.trim();
  return token ? token : null;
}

function normalizeProto(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/:$/, '').toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeHost(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function resolveRequestOrigin(input: {
  host?: string | null;
  forwardedHost?: string | null;
  protocol?: string | null;
  forwardedProto?: string | null;
}): string | null {
  const host = normalizeHost(readForwardedToken(input.forwardedHost ?? undefined) ?? input.host ?? null);
  const proto = normalizeProto(readForwardedToken(input.forwardedProto ?? undefined) ?? input.protocol ?? null);

  if (!host || !proto) {
    return null;
  }

  return `${proto}://${host}`;
}

export function isTrustedOrigin(
  originHeader: string | null | undefined,
  requestOrigin: string | null,
): boolean {
  if (!requestOrigin || typeof originHeader !== 'string' || originHeader.trim().length === 0) {
    return false;
  }

  try {
    const parsedOrigin = new URL(originHeader);
    return parsedOrigin.origin.toLowerCase() === requestOrigin.toLowerCase();
  } catch {
    return false;
  }
}

function requestOriginFromExpress(req: Request): string | null {
  return resolveRequestOrigin({
    host: req.get('host'),
    forwardedHost: req.get('x-forwarded-host'),
    protocol: req.protocol,
    forwardedProto: req.get('x-forwarded-proto'),
  });
}

function isSecureRequest(req: Request): boolean {
  const origin = requestOriginFromExpress(req);
  return origin?.startsWith('https://') === true;
}

export function applyWebSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', DEFAULT_CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (isSecureRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

export function enforceSameOriginUnsafeRequests(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const requestOrigin = requestOriginFromExpress(req);
  const originHeader = req.get('origin');
  if (!isTrustedOrigin(originHeader, requestOrigin)) {
    res.status(403).json({ error: 'Cross-origin request rejected.' });
    return;
  }

  next();
}

export function createInMemoryRateLimit(options: {
  windowMs: number;
  maxRequests: number;
  key: (req: Request) => string;
  message?: string;
}): RequestHandler {
  const hits = new Map<string, number[]>();

  return (req, res, next) => {
    const now = Date.now();
    const windowStart = now - options.windowMs;
    const key = options.key(req);
    const retained = (hits.get(key) ?? []).filter((value) => value > windowStart);

    if (retained.length >= options.maxRequests) {
      const retryAfterMs = Math.max(1, options.windowMs - (now - retained[0]!));
      res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      res.status(429).json({ error: options.message ?? 'Too many requests. Try again later.' });
      return;
    }

    retained.push(now);
    hits.set(key, retained);
    next();
  };
}
