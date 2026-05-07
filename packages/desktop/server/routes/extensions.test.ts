import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerExtensionRoutes } from './extensions.js';

type Handler = (
  req: { params?: Record<string, string>; body?: unknown; query?: Record<string, string> },
  res: ReturnType<typeof createResponse>,
) => void | Promise<void>;

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
  const putHandlers = new Map<string, Handler>();
  const deleteHandlers = new Map<string, Handler>();
  const router = {
    get: vi.fn((path: string, handler: Handler) => getHandlers.set(path, handler)),
    post: vi.fn((path: string, handler: Handler) => postHandlers.set(path, handler)),
    patch: vi.fn((path: string, handler: Handler) => patchHandlers.set(path, handler)),
    put: vi.fn((path: string, handler: Handler) => putHandlers.set(path, handler)),
    delete: vi.fn((path: string, handler: Handler) => deleteHandlers.set(path, handler)),
  };
  registerExtensionRoutes(router as never);
  return {
    getHandler: (path: string) => getHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
    patchHandler: (path: string) => patchHandlers.get(path)!,
    putHandler: (path: string) => putHandlers.get(path)!,
    deleteHandler: (path: string) => deleteHandlers.get(path)!,
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

  it('serves command and slash command registrations for enabled extensions', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'agent-board',
        name: 'Agent Board',
        surfaces: [
          { id: 'plan', placement: 'command', kind: 'command', title: 'Plan board sprint', action: 'planSprint', icon: 'kanban' },
          { id: 'task', placement: 'slash', kind: 'slashCommand', name: 'task', description: 'Create a board task', action: 'createTask' },
        ],
      }),
    );

    const harness = createHarness();
    const commandsRes = createResponse();
    harness.getHandler('/api/extensions/commands')({}, commandsRes);
    expect(commandsRes.json).toHaveBeenCalledWith([
      {
        extensionId: 'agent-board',
        surfaceId: 'plan',
        packageType: 'user',
        title: 'Plan board sprint',
        action: 'planSprint',
        icon: 'kanban',
      },
    ]);

    const slashRes = createResponse();
    harness.getHandler('/api/extensions/slash-commands')({}, slashRes);
    expect(slashRes.json).toHaveBeenCalledWith([
      {
        extensionId: 'agent-board',
        surfaceId: 'task',
        packageType: 'user',
        name: 'task',
        description: 'Create a board task',
        action: 'createTask',
      },
    ]);
  });

  it('serves extension state documents with optimistic concurrency', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const harness = createHarness();

    const putRes = createResponse();
    harness.putHandler('/api/extensions/:id/state/*')(
      { params: { id: 'agent-board', 0: 'tasks/one' }, body: { value: { title: 'Ship it' } } },
      putRes,
    );
    expect(putRes.json).toHaveBeenCalledWith(expect.objectContaining({ key: 'tasks/one', value: { title: 'Ship it' }, version: 1 }));

    const getRes = createResponse();
    harness.getHandler('/api/extensions/:id/state/*')({ params: { id: 'agent-board', 0: 'tasks/one' } }, getRes);
    expect(getRes.json).toHaveBeenCalledWith(expect.objectContaining({ key: 'tasks/one', value: { title: 'Ship it' }, version: 1 }));

    const conflictRes = createResponse();
    harness.putHandler('/api/extensions/:id/state/*')(
      { params: { id: 'agent-board', 0: 'tasks/one' }, body: { value: { title: 'Nope' }, expectedVersion: 99 } },
      conflictRes,
    );
    expect(conflictRes.status).toHaveBeenCalledWith(409);
    expect(conflictRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Extension state version conflict.' }));

    const listRes = createResponse();
    harness.getHandler('/api/extensions/:id/state')({ params: { id: 'agent-board' }, query: { prefix: 'tasks/' } }, listRes);
    expect(listRes.json).toHaveBeenCalledWith([expect.objectContaining({ key: 'tasks/one' })]);

    const deleteRes = createResponse();
    harness.deleteHandler('/api/extensions/:id/state/*')({ params: { id: 'agent-board', 0: 'tasks/one' } }, deleteRes);
    expect(deleteRes.json).toHaveBeenCalledWith({ ok: true, deleted: true });
  });

  it('creates starter runtime extensions', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const harness = createHarness();

    const res = createResponse();
    harness.postHandler('/api/extensions')({ body: { id: 'agent-board', name: 'Agent Board', description: 'Track work' } }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      packageRoot: join(stateRoot, 'extensions', 'agent-board'),
      extension: expect.objectContaining({
        id: 'agent-board',
        name: 'Agent Board',
        packageRoot: join(stateRoot, 'extensions', 'agent-board'),
        routes: [{ route: '/ext/agent-board', surfaceId: 'page' }],
      }),
    });
  });

  it('snapshots runtime extensions', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(join(extensionRoot, 'extension.json'), JSON.stringify({ schemaVersion: 1, id: 'agent-board', name: 'Agent Board' }));

    const harness = createHarness();
    const res = createResponse();
    harness.postHandler('/api/extensions/:id/snapshot')({ params: { id: 'agent-board' } }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      extensionId: 'agent-board',
      snapshotPath: expect.stringContaining(join('extension-snapshots', 'agent-board')),
    });
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
      `export async function saveTask(input, ctx) { await ctx.storage.put('tasks/one', input); return { saved: await ctx.storage.get('tasks/one'), automationsList: typeof ctx.automations.list, runsStart: typeof ctx.runs.start, vaultRead: typeof ctx.vault.read, conversationsList: typeof ctx.conversations.list }; }`,
    );

    const harness = createHarness();
    const res = createResponse();
    await harness.postHandler('/api/extensions/:id/actions/:actionId')(
      { params: { id: 'agent-board', actionId: 'saveTask' }, body: { title: 'Ship it' } },
      res,
    );

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      result: {
        saved: { title: 'Ship it' },
        automationsList: 'function',
        runsStart: 'function',
        vaultRead: 'function',
        conversationsList: 'function',
      },
    });
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
