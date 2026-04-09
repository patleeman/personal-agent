import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyWebSecurityHeaders,
  createInMemoryRateLimit,
  enforceSameOriginUnsafeRequests,
  isTrustedOrigin,
  resolveRequestOrigin,
} from './webSecurity.js';

function createRequest(input: {
  method?: string;
  protocol?: string;
  headers?: Record<string, string | undefined>;
} = {}): Request {
  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    method: input.method ?? 'GET',
    protocol: input.protocol ?? 'http',
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as Request;
}

function createResponse(): Response & {
  headers: Map<string, string>;
  statusCode?: number;
  jsonBody?: unknown;
} {
  const headers = new Map<string, string>();
  const response = {
    headers,
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, String(value));
      return response;
    }),
    status: vi.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.jsonBody = body;
      return response;
    }),
  } as Response & {
    headers: Map<string, string>;
    statusCode?: number;
    jsonBody?: unknown;
  };

  return response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveRequestOrigin', () => {
  it('prefers forwarded host and protocol when present', () => {
    expect(resolveRequestOrigin({
      host: '127.0.0.1:3742',
      protocol: 'http',
      forwardedHost: 'agent.tail.ts.net',
      forwardedProto: 'https',
    })).toBe('https://agent.tail.ts.net');
  });

  it('uses the first forwarded token and normalizes casing', () => {
    expect(resolveRequestOrigin({
      host: '127.0.0.1:3741',
      protocol: 'http',
      forwardedHost: ' Agent.Tail.Ts.Net:443 , ignored.example ',
      forwardedProto: ' HTTPS:, http ',
    })).toBe('https://agent.tail.ts.net:443');
  });

  it('falls back to direct host and protocol', () => {
    expect(resolveRequestOrigin({
      host: '127.0.0.1:3741',
      protocol: 'http',
    })).toBe('http://127.0.0.1:3741');
  });

  it('returns null when host or protocol are missing', () => {
    expect(resolveRequestOrigin({ host: null, protocol: 'http' })).toBeNull();
    expect(resolveRequestOrigin({ host: 'agent.tail.ts.net', protocol: null })).toBeNull();
  });
});

describe('isTrustedOrigin', () => {
  it('accepts matching origins', () => {
    expect(isTrustedOrigin('https://agent.tail.ts.net', 'https://agent.tail.ts.net')).toBe(true);
  });

  it('matches request origins case-insensitively', () => {
    expect(isTrustedOrigin('https://Agent.Tail.Ts.Net/path?q=1', 'https://agent.tail.ts.net')).toBe(true);
  });

  it('rejects missing or mismatched origins', () => {
    expect(isTrustedOrigin(undefined, 'https://agent.tail.ts.net')).toBe(false);
    expect(isTrustedOrigin('https://evil.example', 'https://agent.tail.ts.net')).toBe(false);
    expect(isTrustedOrigin('not-a-url', 'https://agent.tail.ts.net')).toBe(false);
  });
});

describe('applyWebSecurityHeaders', () => {
  it('sets the standard headers and HSTS for secure forwarded requests', () => {
    const req = createRequest({
      protocol: 'http',
      headers: {
        host: '127.0.0.1:3742',
        'x-forwarded-host': 'agent.tail.ts.net',
        'x-forwarded-proto': 'https',
      },
    });
    const res = createResponse();
    const next = vi.fn();

    applyWebSecurityHeaders(req, res, next);

    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips HSTS on insecure requests', () => {
    const req = createRequest({
      protocol: 'http',
      headers: {
        host: '127.0.0.1:3742',
      },
    });
    const res = createResponse();

    applyWebSecurityHeaders(req, res, vi.fn());

    expect(res.headers.has('Strict-Transport-Security')).toBe(false);
  });
});

describe('enforceSameOriginUnsafeRequests', () => {
  it('allows safe methods without an origin check', () => {
    const req = createRequest({ method: 'head' });
    const res = createResponse();
    const next = vi.fn();

    enforceSameOriginUnsafeRequests(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows unsafe requests from the trusted origin', () => {
    const req = createRequest({
      method: 'post',
      protocol: 'http',
      headers: {
        host: '127.0.0.1:3742',
        'x-forwarded-host': 'agent.tail.ts.net',
        'x-forwarded-proto': 'https',
        origin: 'https://agent.tail.ts.net/workspace',
      },
    });
    const res = createResponse();
    const next = vi.fn();

    enforceSameOriginUnsafeRequests(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects unsafe cross-origin requests', () => {
    const req = createRequest({
      method: 'delete',
      protocol: 'https',
      headers: {
        host: 'agent.tail.ts.net',
        origin: 'https://evil.example',
      },
    });
    const res = createResponse();

    enforceSameOriginUnsafeRequests(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cross-origin request rejected.' });
  });
});

describe('createInMemoryRateLimit', () => {
  it('tracks hits per key and drops requests outside the window', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_050)
      .mockReturnValueOnce(2_500);

    const handler = createInMemoryRateLimit({
      windowMs: 1_000,
      maxRequests: 2,
      key: (req) => req.get('x-client-id') ?? 'anonymous',
    });
    const next = vi.fn();

    handler(createRequest({ headers: { 'x-client-id': 'alpha' } }), createResponse(), next);
    handler(createRequest({ headers: { 'x-client-id': 'beta' } }), createResponse(), next);
    handler(createRequest({ headers: { 'x-client-id': 'alpha' } }), createResponse(), next);

    expect(next).toHaveBeenCalledTimes(3);
  });

  it('rejects requests over the limit and returns retry metadata', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_600);

    const handler = createInMemoryRateLimit({
      windowMs: 1_000,
      maxRequests: 1,
      key: () => 'alpha',
      message: 'Hold on.',
    });
    const next = vi.fn();

    handler(createRequest(), createResponse(), next);
    const limitedResponse = createResponse();
    handler(createRequest(), limitedResponse, next);

    expect(next).toHaveBeenCalledOnce();
    expect(limitedResponse.headers.get('Retry-After')).toBe('1');
    expect(limitedResponse.status).toHaveBeenCalledWith(429);
    expect(limitedResponse.json).toHaveBeenCalledWith({ error: 'Hold on.' });
  });
});
