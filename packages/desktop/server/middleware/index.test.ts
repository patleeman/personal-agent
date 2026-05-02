import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logInfoMock } = vi.hoisted(() => ({
  logInfoMock: vi.fn(),
}));

vi.mock('../shared/logging.js', () => ({
  logError: vi.fn(),
  logInfo: logInfoMock,
  logWarn: vi.fn(),
  installProcessLogging: vi.fn(),
  webRequestLoggingMiddleware: vi.fn(),
}));

import {
  readCookieValue,
  logSlowConversationPerf,
  setServerTimingHeaders,
  writeSseHeaders,
} from './index.js';

describe('server middleware helpers', () => {
  beforeEach(() => {
    logInfoMock.mockReset();
  });

  it('sets Server-Timing headers and stores timing metadata', () => {
    const setHeader = vi.fn();
    const res = { setHeader, locals: {} } as unknown as { setHeader: typeof setHeader; locals: Record<string, unknown> };

    setServerTimingHeaders(res as never, [
      { name: 'sql', durationMs: 12.34, description: 'lookup "users"' },
      { name: 'render', durationMs: Number.NaN },
    ], { route: 'conversation' });

    expect(setHeader).toHaveBeenCalledWith('Server-Timing', 'sql;dur=12.3;desc="lookup users", render;dur=0.0');
    expect(res.locals.timingMeta).toEqual({ route: 'conversation' });
  });

  it('defaults unsafe Server-Timing durations to zero', () => {
    const setHeader = vi.fn();
    const res = { setHeader, locals: {} } as unknown as { setHeader: typeof setHeader; locals: Record<string, unknown> };

    setServerTimingHeaders(res as never, [
      { name: 'unsafe', durationMs: Number.MAX_SAFE_INTEGER + 1 },
    ]);

    expect(setHeader).toHaveBeenCalledWith('Server-Timing', 'unsafe;dur=0.0');
  });

  it('logs only slow conversation perf events', () => {
    logSlowConversationPerf('conversation.fast', { durationMs: 149 });
    logSlowConversationPerf('conversation.slow', { durationMs: 150, route: '/app' });
    logSlowConversationPerf('conversation.unsafe', { durationMs: Number.MAX_SAFE_INTEGER + 1 });

    expect(logInfoMock).toHaveBeenCalledTimes(1);
    expect(logInfoMock).toHaveBeenCalledWith('conversation.slow', { durationMs: 150, route: '/app' });
  });

  it('writes SSE headers and flushes them', () => {
    const setHeader = vi.fn();
    const flushHeaders = vi.fn();
    const res = { setHeader, flushHeaders } as unknown as { setHeader: typeof setHeader; flushHeaders: typeof flushHeaders };

    writeSseHeaders(res as never);

    expect(setHeader).toHaveBeenNthCalledWith(1, 'Content-Type', 'text/event-stream');
    expect(setHeader).toHaveBeenNthCalledWith(2, 'Cache-Control', 'no-cache');
    expect(setHeader).toHaveBeenNthCalledWith(3, 'Connection', 'keep-alive');
    expect(flushHeaders).toHaveBeenCalledTimes(1);
  });

  it('reads cookie values by name', () => {
    expect(readCookieValue({ headers: {} } as never, 'session')).toBe('');
    expect(readCookieValue({ headers: { cookie: 'theme=dark; session = abc123 ; other=value' } } as never, 'session')).toBe('abc123');
    expect(readCookieValue({ headers: { cookie: 'theme=dark; other=value' } } as never, 'session')).toBe('');
  });
});
