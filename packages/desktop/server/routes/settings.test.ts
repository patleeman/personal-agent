import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────

const mockRead = vi.hoisted(() => vi.fn());
const mockReadSchema = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock('../settings/settingsStore.js', () => ({
  createSettingsStore: vi.fn(() => ({
    read: mockRead,
    readSchema: mockReadSchema,
    readOverrides: vi.fn(),
    update: mockUpdate,
  })),
}));

vi.mock('../middleware/index.js', () => ({
  logError: vi.fn(),
}));

import { registerSettingsRoutes } from './settings.js';

describe('registerSettingsRoutes', () => {
  const routes = new Map<string, (req: Record<string, unknown>, res: Record<string, unknown>) => void>();

  function createMockRouter(method: 'get' | 'patch') {
    return (path: string, ...handlers: Array<(...args: unknown[]) => void>) => {
      const handler = handlers[handlers.length - 1];
      if (handler) {
        routes.set(`${method}:${path}`, handler as never);
      }
    };
  }

  beforeAll(() => {
    const router = { get: createMockRouter('get'), patch: createMockRouter('patch') };
    registerSettingsRoutes(router as never);
  });

  beforeEach(() => {
    mockRead.mockReset();
    mockReadSchema.mockReset();
    mockUpdate.mockReset();
  });

  function mockRes() {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    return res as unknown as ReturnType<typeof vi.fn>;
  }

  describe('GET /api/settings', () => {
    it('returns settings values', () => {
      mockRead.mockReturnValue({ 'app.timeout': 60, 'app.featureX': true });
      const handler = routes.get('get:/api/settings')!;
      const res = mockRes();
      handler({} as never, res as never);
      expect(mockRead).toHaveBeenCalledOnce();
      expect(res.json).toHaveBeenCalledWith({ 'app.timeout': 60, 'app.featureX': true });
    });

    it('returns 500 on error', () => {
      mockRead.mockImplementation(() => {
        throw new Error('boom');
      });
      const handler = routes.get('get:/api/settings')!;
      const res = mockRes();
      handler({} as never, res as never);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error: boom' });
    });
  });

  describe('GET /api/settings/schema', () => {
    it('returns schema', () => {
      mockReadSchema.mockReturnValue([{ key: 'test', type: 'boolean' }]);
      const handler = routes.get('get:/api/settings/schema')!;
      const res = mockRes();
      handler({} as never, res as never);
      expect(res.json).toHaveBeenCalledWith([{ key: 'test', type: 'boolean' }]);
    });

    it('returns 500 on error', () => {
      mockReadSchema.mockImplementation(() => {
        throw new Error('schema error');
      });
      const handler = routes.get('get:/api/settings/schema')!;
      const res = mockRes();
      handler({} as never, res as never);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('PATCH /api/settings', () => {
    it('updates and returns merged result', () => {
      mockUpdate.mockReturnValue({ 'app.timeout': 120 });
      const handler = routes.get('patch:/api/settings')!;
      const res = mockRes();
      handler({ body: { 'app.timeout': 120 } } as never, res as never);
      expect(mockUpdate).toHaveBeenCalledWith({ 'app.timeout': 120 });
      expect(res.json).toHaveBeenCalledWith({ 'app.timeout': 120 });
    });

    it('returns 400 for non-object body', () => {
      const handler = routes.get('patch:/api/settings')!;
      const res = mockRes();
      handler({ body: 'not an object' } as never, res as never);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Request body must be an object of key-value pairs.' });
    });

    it('returns 400 for array body', () => {
      const handler = routes.get('patch:/api/settings')!;
      const res = mockRes();
      handler({ body: [] } as never, res as never);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 on store error', () => {
      mockUpdate.mockImplementation(() => {
        throw new Error('update error');
      });
      const handler = routes.get('patch:/api/settings')!;
      const res = mockRes();
      handler({ body: { key: 'value' } } as never, res as never);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
