import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('web logging', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats structured fields for info, warn, and error logs', async () => {
    const { logError, logInfo, logWarn } = await import('./logging.js');
    const circular: { self?: unknown } = {};
    circular.self = circular;

    logInfo('request completed', {
      method: 'GET',
      status: 200,
      details: { ok: true },
      missing: undefined,
      nil: null,
      circular,
    });
    logWarn('slow request', { durationMs: 250.4 });
    logError('request failed', { error: 'boom' });

    const infoLine = vi.mocked(console.log).mock.calls[0]?.[0];
    expect(infoLine).toContain('[web] [info] request completed');
    expect(infoLine).toContain('method=GET');
    expect(infoLine).toContain('status=200');
    expect(infoLine).toContain('details={"ok":true}');
    expect(infoLine).toContain('nil=null');
    expect(infoLine).toContain('circular=[object Object]');
    expect(infoLine).not.toContain('missing=');

    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toContain('[web] [warn] slow request durationMs=250.4');
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toContain('[web] [error] request failed error=boom');
  });

  it('skips request logging for non-api routes', async () => {
    const { webRequestLoggingMiddleware } = await import('./logging.js');
    const next = vi.fn();
    const res = {
      on: vi.fn(),
      getHeader: vi.fn(),
    };

    webRequestLoggingMiddleware(
      {
        path: '/app',
        method: 'GET',
        originalUrl: '/app',
        url: '/app',
      } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.on).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs successful api requests at info level', async () => {
    const bigintSpy = vi.spyOn(process.hrtime, 'bigint');
    bigintSpy.mockReturnValueOnce(0n);
    bigintSpy.mockReturnValueOnce(123_456_789n);
    const { webRequestLoggingMiddleware } = await import('./logging.js');
    const next = vi.fn();
    let finishHandler: (() => void) | undefined;
    const res = {
      statusCode: 200,
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') {
          finishHandler = handler;
        }
      }),
      getHeader: vi.fn(() => '42'),
    };

    webRequestLoggingMiddleware(
      {
        path: '/api/runs',
        method: 'GET',
        originalUrl: '/api/runs?limit=1',
        url: '/api/runs?limit=1',
      } as never,
      res as never,
      next,
    );
    finishHandler?.();

    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.log).mock.calls[0]?.[0]).toContain(
      'request completed method=GET path=/api/runs?limit=1 status=200 durationMs=123.5 contentLength=42',
    );
  });

  it('logs client and server api failures at warn and error levels', async () => {
    const bigintSpy = vi.spyOn(process.hrtime, 'bigint');
    bigintSpy.mockReturnValueOnce(0n).mockReturnValueOnce(50_000_000n).mockReturnValueOnce(0n).mockReturnValueOnce(80_000_000n);
    const { webRequestLoggingMiddleware } = await import('./logging.js');

    const warnNext = vi.fn();
    let warnFinishHandler: (() => void) | undefined;
    const warnRes = {
      statusCode: 404,
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') {
          warnFinishHandler = handler;
        }
      }),
      getHeader: vi.fn(() => null),
    };
    webRequestLoggingMiddleware(
      {
        path: '/api/tasks',
        method: 'POST',
        originalUrl: '',
        url: '/api/tasks',
      } as never,
      warnRes as never,
      warnNext,
    );
    warnFinishHandler?.();

    const errorNext = vi.fn();
    let errorFinishHandler: (() => void) | undefined;
    const errorRes = {
      statusCode: 500,
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') {
          errorFinishHandler = handler;
        }
      }),
      getHeader: vi.fn(() => '0'),
    };
    webRequestLoggingMiddleware(
      {
        path: '/api/tasks',
        method: 'DELETE',
        originalUrl: '/api/tasks/123',
        url: '/api/tasks/123',
      } as never,
      errorRes as never,
      errorNext,
    );
    errorFinishHandler?.();

    expect(warnNext).toHaveBeenCalledTimes(1);
    expect(errorNext).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toContain(
      'request completed method=POST path=/api/tasks status=404 durationMs=50 contentLength=null',
    );
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toContain(
      'request failed method=DELETE path=/api/tasks/123 status=500 durationMs=80 contentLength=0',
    );
  });

  it('installs process logging handlers once and routes emitted events through the logger', async () => {
    const processOnSpy = vi.spyOn(process, 'on');
    const handlers = new Map<string, (...args: unknown[]) => void>();
    processOnSpy.mockImplementation(((event: string | symbol, handler: (...args: unknown[]) => void) => {
      handlers.set(String(event), handler);
      return process;
    }) as never);

    const { installProcessLogging } = await import('./logging.js');
    installProcessLogging();
    installProcessLogging();

    expect(processOnSpy).toHaveBeenCalledTimes(4);
    expect([...handlers.keys()]).toEqual(['uncaughtExceptionMonitor', 'unhandledRejection', 'SIGTERM', 'SIGINT']);

    const brokenPipe = new Error('write EPIPE') as NodeJS.ErrnoException;
    brokenPipe.code = 'EPIPE';
    handlers.get('uncaughtExceptionMonitor')?.(brokenPipe);
    handlers.get('uncaughtExceptionMonitor')?.(new Error('boom'));
    handlers.get('unhandledRejection')?.(new Error('reject'));
    handlers.get('unhandledRejection')?.('plain rejection');
    handlers.get('SIGTERM')?.();
    handlers.get('SIGINT')?.();

    const errorLines = vi.mocked(console.error).mock.calls.map(([line]) => String(line));
    const infoLines = vi.mocked(console.log).mock.calls.map(([line]) => String(line));

    expect(errorLines.some((line) => line.includes('uncaught exception') && line.includes('message=boom'))).toBe(true);
    expect(errorLines.some((line) => line.includes('unhandled rejection') && line.includes('reason={"message":"reject"'))).toBe(true);
    expect(errorLines.some((line) => line.includes('unhandled rejection') && line.includes('reason=plain rejection'))).toBe(true);
    expect(infoLines.some((line) => line.includes('received SIGTERM'))).toBe(true);
    expect(infoLines.some((line) => line.includes('received SIGINT'))).toBe(true);
  });
});
