const { persistAppTelemetryEventMock } = vi.hoisted(() => ({
  persistAppTelemetryEventMock: vi.fn(),
}));

vi.mock('../traces/appTelemetry.js', () => ({
  persistAppTelemetryEvent: persistAppTelemetryEventMock,
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAppTelemetryRoutes } from './appTelemetry.js';

describe('app telemetry routes', () => {
  beforeEach(() => {
    persistAppTelemetryEventMock.mockReset();
  });

  it('accepts renderer telemetry events', () => {
    const routes: Record<string, (req: any, res: any) => void> = {};
    registerAppTelemetryRoutes({
      post: (path: string, handler: any) => {
        routes[path] = handler;
      },
    });

    const json = vi.fn();
    routes['/api/telemetry/event'](
      {
        body: { category: 'navigation', name: 'route_view', route: '/telemetry', durationMs: 14, metadata: { referrerRoute: '/' } },
        headers: { 'user-agent': 'test-agent' },
      },
      { status: vi.fn().mockReturnThis(), json },
    );

    expect(persistAppTelemetryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'renderer',
        category: 'navigation',
        name: 'route_view',
        route: '/telemetry',
        durationMs: 14,
        metadata: expect.objectContaining({ referrerRoute: '/', userAgent: 'test-agent' }),
      }),
    );
    expect(json).toHaveBeenCalledWith({ ok: true });
  });

  it('rejects events missing category or name', () => {
    const routes: Record<string, (req: any, res: any) => void> = {};
    registerAppTelemetryRoutes({ post: (path: string, handler: any) => void (routes[path] = handler) });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    routes['/api/telemetry/event']({ body: { category: 'navigation' }, headers: {} }, { status, json });

    expect(status).toHaveBeenCalledWith(400);
    expect(persistAppTelemetryEventMock).not.toHaveBeenCalled();
  });
});
