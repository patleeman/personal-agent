import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerExtensionRoutes } from './extensions.js';

type Handler = (req: { params?: Record<string, string>; body?: unknown }, res: ReturnType<typeof createResponse>) => void | Promise<void>;

function createResponse() {
  return {
    json: vi.fn(),
    send: vi.fn(),
    sendFile: vi.fn(),
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
  };
}

function createHarness() {
  const getHandlers = new Map<string, Handler>();
  const postHandlers = new Map<string, Handler>();
  const patchHandlers = new Map<string, Handler>();
  const router = {
    get: vi.fn((path: string, handler: Handler) => getHandlers.set(path, handler)),
    post: vi.fn((path: string, handler: Handler) => postHandlers.set(path, handler)),
    patch: vi.fn((path: string, handler: Handler) => patchHandlers.set(path, handler)),
  };
  registerExtensionRoutes(router as never);
  return {
    getHandler: (path: string) => getHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
    patchHandler: (path: string) => patchHandlers.get(path)!,
  };
}

afterEach(() => {
  delete process.env.PERSONAL_AGENT_STATE_ROOT;
});

describe('registerExtensionRoutes', () => {
  it('serves extension schema, registry, routes, and surfaces', () => {
    const harness = createHarness();

    const schemaRes = createResponse();
    harness.getHandler('/api/extensions/schema')({}, schemaRes);
    expect(schemaRes.json).toHaveBeenCalledWith(expect.objectContaining({ placements: expect.arrayContaining(['main', 'right']) }));

    const listRes = createResponse();
    harness.getHandler('/api/extensions')({}, listRes);
    expect(listRes.json).toHaveBeenCalledWith([expect.objectContaining({ id: 'system-automations', packageType: 'system' })]);

    const installedRes = createResponse();
    harness.getHandler('/api/extensions/installed')({}, installedRes);
    expect(installedRes.json).toHaveBeenCalledWith([expect.objectContaining({ id: 'system-automations', enabled: true })]);

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

  it('serves runtime extension files inside the package root', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(join(extensionRoot, 'frontend'), { recursive: true });
    writeFileSync(join(extensionRoot, 'extension.json'), JSON.stringify({ schemaVersion: 1, id: 'agent-board', name: 'Agent Board' }));
    writeFileSync(join(extensionRoot, 'frontend', 'page.html'), '<h1>Agent Board</h1>');

    const harness = createHarness();
    const res = createResponse();
    harness.getHandler('/api/extensions/:id/files/*')({ params: { id: 'agent-board', 0: 'frontend/page.html' } }, res);

    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('<h1>Agent Board</h1>'));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('/pa/client.js'));
  });

  it('rejects extension file traversal', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(join(extensionRoot, 'extension.json'), JSON.stringify({ schemaVersion: 1, id: 'agent-board', name: 'Agent Board' }));

    const harness = createHarness();
    const res = createResponse();
    harness.getHandler('/api/extensions/:id/files/*')({ params: { id: 'agent-board', 0: '../escape.html' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Extension file path escapes package root.' });
  });

  it('toggles runtime extensions', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(join(extensionRoot, 'extension.json'), JSON.stringify({ schemaVersion: 1, id: 'agent-board', name: 'Agent Board' }));

    const harness = createHarness();
    const res = createResponse();
    harness.patchHandler('/api/extensions/:id')({ params: { id: 'agent-board' }, body: { enabled: false } }, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, extension: expect.objectContaining({ id: 'agent-board', enabled: false }) });
  });

  it('rejects disabling system extensions', () => {
    const harness = createHarness();
    const res = createResponse();
    harness.patchHandler('/api/extensions/:id')({ params: { id: 'system-automations' }, body: { enabled: false } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'System extensions cannot be disabled.' });
  });

  it('invokes runtime extension backend actions', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(join(extensionRoot, 'backend'), { recursive: true });
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'agent-board',
        name: 'Agent Board',
        backend: { entry: 'backend/index.ts', actions: [{ id: 'saveTask', handler: 'saveTask' }] },
      }),
    );
    writeFileSync(
      join(extensionRoot, 'backend', 'index.ts'),
      `export async function saveTask(input, ctx) { await ctx.storage.put('tasks/one', input); return { saved: await ctx.storage.get('tasks/one'), automationsList: typeof ctx.automations.list }; }`,
    );

    const harness = createHarness();
    const res = createResponse();
    await harness.postHandler('/api/extensions/:id/actions/:actionId')(
      { params: { id: 'agent-board', actionId: 'saveTask' }, body: { title: 'Ship it' } },
      res,
    );

    expect(res.json).toHaveBeenCalledWith({ ok: true, result: { saved: { title: 'Ship it' }, automationsList: 'function' } });
  });

  it('accepts explicit reload calls for runtime manifests', () => {
    const harness = createHarness();
    const reloadAllRes = createResponse();
    harness.postHandler('/api/extensions/reload')({}, reloadAllRes);
    expect(reloadAllRes.json).toHaveBeenCalledWith({ ok: true, reloaded: false, message: 'Runtime manifests are read on demand.' });

    const reloadOneRes = createResponse();
    harness.postHandler('/api/extensions/:id/reload')({ params: { id: 'system-automations' } }, reloadOneRes);
    expect(reloadOneRes.json).toHaveBeenCalledWith({
      ok: true,
      id: 'system-automations',
      reloaded: false,
      message: 'Runtime manifests are read on demand.',
    });
  });
});
