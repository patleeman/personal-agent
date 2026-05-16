const {
  exportAppTelemetryLogBundleMock,
  listAppTelemetryLogFilesMock,
  maintainAppTelemetryDbMock,
  maintainTraceDbMock,
  persistAppTelemetryEventMock,
  resolveAppTelemetryLogDirMock,
} = vi.hoisted(() => ({
  exportAppTelemetryLogBundleMock: vi.fn(),
  listAppTelemetryLogFilesMock: vi.fn(),
  maintainAppTelemetryDbMock: vi.fn(),
  maintainTraceDbMock: vi.fn(),
  persistAppTelemetryEventMock: vi.fn(),
  resolveAppTelemetryLogDirMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  exportAppTelemetryLogBundle: exportAppTelemetryLogBundleMock,
  listAppTelemetryLogFiles: listAppTelemetryLogFilesMock,
  maintainAppTelemetryDb: maintainAppTelemetryDbMock,
  maintainTraceDb: maintainTraceDbMock,
  resolveAppTelemetryLogDir: resolveAppTelemetryLogDirMock,
}));

vi.mock('../traces/appTelemetry.js', () => ({
  persistAppTelemetryEvent: persistAppTelemetryEventMock,
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAppTelemetryRoutes } from './appTelemetry.js';

describe('app telemetry routes', () => {
  beforeEach(() => {
    exportAppTelemetryLogBundleMock.mockReset();
    listAppTelemetryLogFilesMock.mockReset();
    maintainAppTelemetryDbMock.mockReset();
    maintainTraceDbMock.mockReset();
    persistAppTelemetryEventMock.mockReset();
    resolveAppTelemetryLogDirMock.mockReset();
    listAppTelemetryLogFilesMock.mockReturnValue([]);
    maintainAppTelemetryDbMock.mockReturnValue({
      dbPath: '/tmp/pa/observability/observability.db',
      maxEvents: 50000,
      deletedRows: 1,
      remainingRows: 2,
      vacuumed: true,
    });
    maintainTraceDbMock.mockReturnValue({
      dbPath: '/tmp/pa/observability/observability.db',
      maxRowsPerTable: 50000,
      deletedRows: { trace_stats: 3 },
      vacuumed: true,
    });
    resolveAppTelemetryLogDirMock.mockReturnValue('/tmp/pa/logs/telemetry');
  });

  it('accepts renderer telemetry events', () => {
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    registerAppTelemetryRoutes({
      get: (path: string, handler: unknown) => {
        routes[path] = handler;
      },
      post: (path: string, handler: unknown) => {
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

  it('reports telemetry log diagnostics', () => {
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const files = [
      {
        path: '/tmp/pa/logs/telemetry/app-telemetry-2026-05-14.jsonl',
        name: 'app-telemetry-2026-05-14.jsonl',
        sizeBytes: 42,
        modifiedAt: '2026-05-14T00:00:00.000Z',
      },
    ];
    listAppTelemetryLogFilesMock.mockReturnValue(files);
    registerAppTelemetryRoutes({
      get: (path: string, handler: unknown) => void (routes[path] = handler),
      post: (path: string, handler: unknown) => void (routes[path] = handler),
    });
    const json = vi.fn();

    routes['/api/telemetry/logs']({ body: {}, headers: {} }, { status: vi.fn().mockReturnThis(), json });

    expect(json).toHaveBeenCalledWith({ logDir: '/tmp/pa/logs/telemetry', fileCount: 1, sizeBytes: 42, files });
  });

  it('exports telemetry log bundles', () => {
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    exportAppTelemetryLogBundleMock.mockReturnValue({
      path: '/tmp/pa/exports/telemetry/app-telemetry.jsonl',
      fileCount: 1,
      eventCount: 2,
      sizeBytes: 99,
    });
    registerAppTelemetryRoutes({
      get: (path: string, handler: unknown) => void (routes[path] = handler),
      post: (path: string, handler: unknown) => void (routes[path] = handler),
    });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    routes['/api/telemetry/logs/export']({ body: { since: '2026-05-14T00:00:00.000Z' }, headers: {} }, { status, json });

    expect(exportAppTelemetryLogBundleMock).toHaveBeenCalledWith({ since: '2026-05-14T00:00:00.000Z' });
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      path: '/tmp/pa/exports/telemetry/app-telemetry.jsonl',
      fileCount: 1,
      eventCount: 2,
      sizeBytes: 99,
    });
  });

  it('runs telemetry database maintenance', () => {
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    registerAppTelemetryRoutes({
      get: (path: string, handler: unknown) => void (routes[path] = handler),
      post: (path: string, handler: unknown) => void (routes[path] = handler),
    });
    const json = vi.fn();

    routes['/api/telemetry/db/maintenance']({ body: {}, headers: {} }, { status: vi.fn().mockReturnThis(), json });

    expect(maintainAppTelemetryDbMock).toHaveBeenCalledWith();
    expect(maintainTraceDbMock).toHaveBeenCalledWith();
    expect(json).toHaveBeenCalledWith({
      appTelemetry: {
        dbPath: '/tmp/pa/observability/observability.db',
        maxEvents: 50000,
        deletedRows: 1,
        remainingRows: 2,
        vacuumed: true,
      },
      trace: { dbPath: '/tmp/pa/observability/observability.db', maxRowsPerTable: 50000, deletedRows: { trace_stats: 3 }, vacuumed: true },
    });
  });

  it('rejects events missing category or name', () => {
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    registerAppTelemetryRoutes({
      get: (path: string, handler: unknown) => void (routes[path] = handler),
      post: (path: string, handler: unknown) => void (routes[path] = handler),
    });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    routes['/api/telemetry/event']({ body: { category: 'navigation' }, headers: {} }, { status, json });

    expect(status).toHaveBeenCalledWith(400);
    expect(persistAppTelemetryEventMock).not.toHaveBeenCalled();
  });
});
