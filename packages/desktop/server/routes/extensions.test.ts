import { describe, expect, it, vi } from 'vitest';

import { registerExtensionRoutes } from './extensions.js';

type Handler = (req: { params?: Record<string, string> }, res: ReturnType<typeof createResponse>) => void;

function createResponse() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}

function createHarness() {
  const getHandlers = new Map<string, Handler>();
  const postHandlers = new Map<string, Handler>();
  const router = {
    get: vi.fn((path: string, handler: Handler) => getHandlers.set(path, handler)),
    post: vi.fn((path: string, handler: Handler) => postHandlers.set(path, handler)),
  };
  registerExtensionRoutes(router as never);
  return {
    getHandler: (path: string) => getHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
  };
}

describe('registerExtensionRoutes', () => {
  it('serves extension schema, registry, routes, and surfaces', () => {
    const harness = createHarness();

    const schemaRes = createResponse();
    harness.getHandler('/api/extensions/schema')({}, schemaRes);
    expect(schemaRes.json).toHaveBeenCalledWith(expect.objectContaining({ placements: expect.arrayContaining(['main', 'right']) }));

    const listRes = createResponse();
    harness.getHandler('/api/extensions')({}, listRes);
    expect(listRes.json).toHaveBeenCalledWith([expect.objectContaining({ id: 'system-automations', packageType: 'system' })]);

    const routesRes = createResponse();
    harness.getHandler('/api/extensions/routes')({}, routesRes);
    expect(routesRes.json).toHaveBeenCalledWith([
      { route: '/automations', extensionId: 'system-automations', surfaceId: 'page', packageType: 'system' },
    ]);

    const surfacesRes = createResponse();
    harness.getHandler('/api/extensions/surfaces')({}, surfacesRes);
    expect(surfacesRes.json).toHaveBeenCalledWith([
      expect.objectContaining({ extensionId: 'system-automations', placement: 'main', kind: 'page' }),
    ]);
  });

  it('accepts explicit reload calls for the static v0 registry', () => {
    const harness = createHarness();
    const reloadAllRes = createResponse();
    harness.postHandler('/api/extensions/reload')({}, reloadAllRes);
    expect(reloadAllRes.json).toHaveBeenCalledWith({ ok: true, reloaded: false, message: 'Static system extension registry is current.' });

    const reloadOneRes = createResponse();
    harness.postHandler('/api/extensions/:id/reload')({ params: { id: 'system-automations' } }, reloadOneRes);
    expect(reloadOneRes.json).toHaveBeenCalledWith({
      ok: true,
      id: 'system-automations',
      reloaded: false,
      message: 'Static system extension registry is current.',
    });
  });
});
