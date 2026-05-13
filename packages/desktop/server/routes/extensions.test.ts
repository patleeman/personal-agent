import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerExtensionRoutes } from './extensions.js';

const originalResourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

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

function setPackagedResourcesPath(value = '/Applications/Personal Agent.app/Contents/Resources') {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

afterEach(() => {
  delete process.env.PERSONAL_AGENT_STATE_ROOT;
  delete process.env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE;
  if (originalResourcesPathDescriptor) {
    Object.defineProperty(process, 'resourcesPath', originalResourcesPathDescriptor);
  } else {
    Reflect.deleteProperty(process, 'resourcesPath');
  }
});

describe('registerExtensionRoutes', () => {
  it('serves extension schema, registry, routes, and surfaces', () => {
    const harness = createHarness();

    const schemaRes = createResponse();
    harness.getHandler('/api/extensions/schema')({}, schemaRes);
    expect(schemaRes.json).toHaveBeenCalledWith(expect.objectContaining({ placements: expect.arrayContaining(['main', 'right']) }));

    const listRes = createResponse();
    harness.getHandler('/api/extensions')({}, listRes);
    expect(listRes.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'system-automations', packageType: 'system' }),
        expect.objectContaining({ id: 'system-gateways', packageType: 'system' }),
        expect.objectContaining({ id: 'system-telemetry', packageType: 'system' }),
        expect.objectContaining({ id: 'system-files', packageType: 'system' }),
        expect.objectContaining({ id: 'system-diffs', packageType: 'system' }),
        expect.objectContaining({ id: 'system-runs', packageType: 'system' }),
      ]),
    );

    const installedRes = createResponse();
    harness.getHandler('/api/extensions/installed')({}, installedRes);
    expect(installedRes.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'system-automations', enabled: true }),
        expect.objectContaining({ id: 'system-gateways', enabled: true }),
        expect.objectContaining({ id: 'system-telemetry', enabled: true }),
        expect.objectContaining({ id: 'system-files', enabled: true }),
        expect.objectContaining({ id: 'system-diffs', enabled: true }),
        expect.objectContaining({ id: 'system-runs', enabled: true }),
      ]),
    );

    const routesRes = createResponse();
    harness.getHandler('/api/extensions/routes')({}, routesRes);
    expect(routesRes.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        { route: '/automations', extensionId: 'system-automations', surfaceId: 'page', packageType: 'system' },
        { route: '/gateways', extensionId: 'system-gateways', surfaceId: 'page', packageType: 'system' },
        { route: '/telemetry', extensionId: 'system-telemetry', surfaceId: 'page', packageType: 'system' },
      ]),
    );

    const surfacesRes = createResponse();
    harness.getHandler('/api/extensions/surfaces')({}, surfacesRes);
    expect(surfacesRes.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ extensionId: 'system-automations', location: 'main', component: 'AutomationsPage' }),
        expect.objectContaining({ extensionId: 'system-gateways', location: 'main', component: 'GatewaysPage' }),
        expect.objectContaining({ extensionId: 'system-telemetry', location: 'main', component: 'TelemetryPage' }),
        expect.objectContaining({ extensionId: 'system-files', location: 'rightRail', component: 'WorkspaceFilesPanel' }),
        expect.objectContaining({ extensionId: 'system-files', location: 'workbench', component: 'WorkspaceFileDetailPanel' }),
        expect.objectContaining({ extensionId: 'system-diffs', location: 'rightRail', component: 'ConversationDiffsPanel' }),
        expect.objectContaining({ extensionId: 'system-diffs', location: 'workbench', component: 'ConversationDiffDetailPanel' }),
        expect.objectContaining({ extensionId: 'system-runs', location: 'rightRail', component: 'ConversationRunsPanel' }),
        expect.objectContaining({ extensionId: 'system-runs', location: 'workbench', component: 'ConversationRunDetailPanel' }),
      ]),
    );
  });

  it('serves per-extension manifest and surfaces', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(extensionRoot, { recursive: true });
    const view = { id: 'page', title: 'Agent Board', location: 'main', route: '/ext/agent-board', component: 'AgentBoardPage' };
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'agent-board',
        name: 'Agent Board',
        frontend: { entry: 'dist/frontend.js' },
        contributes: { views: [view] },
      }),
    );

    const harness = createHarness();
    const manifestRes = createResponse();
    harness.getHandler('/api/extensions/:id/manifest')({ params: { id: 'agent-board' } }, manifestRes);
    expect(manifestRes.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-board', contributes: { views: [view] } }));

    const surfacesRes = createResponse();
    harness.getHandler('/api/extensions/:id/surfaces')({ params: { id: 'agent-board' } }, surfacesRes);
    expect(surfacesRes.json).toHaveBeenCalledWith([view]);
  });

  it('serves runtime extension bundles inside the package root', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(join(extensionRoot, 'dist'), { recursive: true });
    writeFileSync(join(extensionRoot, 'extension.json'), JSON.stringify({ schemaVersion: 2, id: 'agent-board', name: 'Agent Board' }));
    writeFileSync(join(extensionRoot, 'dist', 'frontend.js'), 'export function AgentBoardPage() {}');

    const harness = createHarness();
    const res = createResponse();
    harness.getHandler('/api/extensions/:id/files/*')({ params: { id: 'agent-board', 0: 'dist/frontend.js' } }, res);

    expect(res.type).toHaveBeenCalledWith('text/javascript; charset=utf-8');
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('AgentBoardPage'));
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
        schemaVersion: 2,
        id: 'agent-board',
        name: 'Agent Board',
        contributes: {
          commands: [{ id: 'plan', title: 'Plan board sprint', action: 'planSprint', icon: 'kanban' }],
          slashCommands: [{ name: 'task', description: 'Create a board task', action: 'createTask' }],
        },
      }),
    );

    const harness = createHarness();
    const commandsRes = createResponse();
    harness.getHandler('/api/extensions/commands')({}, commandsRes);
    expect(commandsRes.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          extensionId: 'agent-board',
          surfaceId: 'plan',
          packageType: 'user',
          title: 'Plan board sprint',
          action: 'planSprint',
          icon: 'kanban',
        },
      ]),
    );

    const slashRes = createResponse();
    harness.getHandler('/api/extensions/slash-commands')({}, slashRes);
    expect(slashRes.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          extensionId: 'agent-board',
          surfaceId: 'task',
          packageType: 'user',
          name: 'task',
          description: 'Create a board task',
          action: 'createTask',
        },
      ]),
    );
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

  it('validates runtime extensions through the extension doctor route', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const harness = createHarness();

    const createRes = createResponse();
    harness.postHandler('/api/extensions')({ body: { id: 'agent-board', name: 'Agent Board' } }, createRes);

    const res = createResponse();
    await harness.postHandler('/api/extensions/:id/validate')({ params: { id: 'agent-board' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        extensionId: 'agent-board',
        findings: expect.arrayContaining([expect.objectContaining({ code: 'missing-frontend-dist' })]),
      }),
    );
  });

  it('creates paired workbench starter runtime extensions', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const harness = createHarness();

    const res = createResponse();
    harness.postHandler('/api/extensions')({ body: { id: 'agent-board', name: 'Agent Board', template: 'workbench-detail' } }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      packageRoot: join(stateRoot, 'extensions', 'agent-board'),
      extension: expect.objectContaining({
        id: 'agent-board',
        routes: [],
        manifest: expect.objectContaining({
          contributes: expect.objectContaining({
            views: expect.arrayContaining([
              expect.objectContaining({ id: 'rail', location: 'rightRail', detailView: 'detail' }),
              expect.objectContaining({ id: 'detail', location: 'workbench' }),
            ]),
          }),
        }),
      }),
    });
  });

  it('exports and imports runtime extension bundles', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(join(extensionRoot, 'dist'), { recursive: true });
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'agent-board',
        name: 'Agent Board',
        frontend: { entry: 'dist/frontend.js' },
        contributes: {
          views: [{ id: 'page', title: 'Agent Board', location: 'main', route: '/ext/agent-board', component: 'AgentBoardPage' }],
        },
      }),
    );
    writeFileSync(join(extensionRoot, 'dist', 'frontend.js'), 'export function AgentBoardPage() {}');

    const harness = createHarness();
    const exportRes = createResponse();
    harness.postHandler('/api/extensions/:id/export')({ params: { id: 'agent-board' } }, exportRes);
    const exportPayload = exportRes.json.mock.calls[0]?.[0] as { exportPath: string };

    expect(exportRes.status).toHaveBeenCalledWith(201);
    expect(existsSync(exportPayload.exportPath)).toBe(true);

    process.env.PERSONAL_AGENT_STATE_ROOT = mkdtempSync(join(tmpdir(), 'pa-ext-route-import-'));
    const importHarness = createHarness();
    const importRes = createResponse();
    importHarness.postHandler('/api/extensions/import')({ body: { zipPath: exportPayload.exportPath } }, importRes);

    expect(importRes.status).toHaveBeenCalledWith(201);
    expect(importRes.json).toHaveBeenCalledWith({
      ok: true,
      packageRoot: join(process.env.PERSONAL_AGENT_STATE_ROOT, 'extensions', 'agent-board'),
      extension: expect.objectContaining({ id: 'agent-board', name: 'Agent Board' }),
    });
  });

  it('rejects unsafe extension bundles', () => {
    const zipRoot = mkdtempSync(join(tmpdir(), 'pa-ext-unsafe-'));
    const unsafeZip = join(zipRoot, 'unsafe.zip');
    const payloadRoot = join(zipRoot, 'payload');
    writeFileSync(join(zipRoot, 'escape.txt'), 'nope');
    mkdirSync(join(payloadRoot, 'agent-board'), { recursive: true });
    writeFileSync(
      join(payloadRoot, 'agent-board', 'extension.json'),
      JSON.stringify({ schemaVersion: 1, id: 'agent-board', name: 'Agent Board' }),
    );
    execFileSync('zip', ['-q', unsafeZip, '../escape.txt', 'agent-board/extension.json'], { cwd: payloadRoot });

    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const harness = createHarness();
    const res = createResponse();
    harness.postHandler('/api/extensions/import')({ body: { zipPath: unsafeZip } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Extension bundle contains unsafe paths.' });
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

  it('rejects toggles and reloads for invalid runtime extensions', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'bad-board');
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'bad-board',
        name: 'Bad Board',
        contributes: { views: [{ id: 'page', title: 'Bad', location: 'somewhere', component: 'BadPage' }] },
      }),
    );

    const harness = createHarness();
    const toggleRes = createResponse();
    harness.patchHandler('/api/extensions/:id')({ params: { id: 'bad-board' }, body: { enabled: false } }, toggleRes);
    expect(toggleRes.status).toHaveBeenCalledWith(400);
    expect(toggleRes.json).toHaveBeenCalledWith({ error: expect.stringContaining('contributes.views[0].location') });

    const reloadRes = createResponse();
    await harness.postHandler('/api/extensions/:id/reload')({ params: { id: 'bad-board' } }, reloadRes);
    expect(reloadRes.status).toHaveBeenCalledWith(400);
    expect(reloadRes.json).toHaveBeenCalledWith({ error: expect.stringContaining('contributes.views[0].location') });
  });

  it('toggles system extensions', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const harness = createHarness();
    const res = createResponse();
    harness.patchHandler('/api/extensions/:id')({ params: { id: 'system-automations' }, body: { enabled: false } }, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, extension: expect.objectContaining({ id: 'system-automations', enabled: false }) });
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

    writeFileSync(join(extensionRoot, 'backend', 'index.ts'), `export async function saveTask(`);
    const staleRes = createResponse();
    await harness.postHandler('/api/extensions/:id/actions/:actionId')(
      { params: { id: 'agent-board', actionId: 'saveTask' }, body: { title: 'Still works from cache' } },
      staleRes,
    );

    expect(staleRes.json).toHaveBeenCalledWith({
      ok: true,
      result: expect.objectContaining({ saved: { title: 'Still works from cache' } }),
    });
  });

  it('rejects runtime extension builds in packaged desktop mode', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(join(extensionRoot, 'src'), { recursive: true });
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'agent-board',
        name: 'Agent Board',
        frontend: { entry: 'dist/frontend.js', styles: [] },
        backend: { entry: 'dist/backend.mjs', actions: [{ id: 'ping', handler: 'ping' }] },
      }),
    );
    writeFileSync(join(extensionRoot, 'src', 'frontend.tsx'), 'export function AgentBoard() { return null; }');
    writeFileSync(join(extensionRoot, 'src', 'backend.ts'), 'export async function ping() { return { ok: true }; }');
    setPackagedResourcesPath();

    const harness = createHarness();
    const res = createResponse();
    await harness.postHandler('/api/extensions/:id/build')({ params: { id: 'agent-board' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.stringContaining('Packaged desktop builds do not compile extensions at runtime.'),
    });
  });

  it('reloads prebuilt runtime extension backends without rebuilding in packaged desktop mode', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-route-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(join(extensionRoot, 'dist'), { recursive: true });
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'agent-board',
        name: 'Agent Board',
        backend: { entry: 'dist/backend.mjs', actions: [{ id: 'ping', handler: 'ping' }] },
      }),
    );
    writeFileSync(join(extensionRoot, 'dist', 'backend.mjs'), 'export async function ping() { return { ok: true }; }');
    setPackagedResourcesPath();

    const harness = createHarness();
    const res = createResponse();
    await harness.postHandler('/api/extensions/:id/reload')({ params: { id: 'agent-board' } }, res);

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      id: 'agent-board',
      reloaded: true,
      message: 'Extension backend reloaded.',
    });
  });

  it('accepts explicit reload calls for runtime manifests', async () => {
    const harness = createHarness();
    const reloadAllRes = createResponse();
    harness.postHandler('/api/extensions/reload')({}, reloadAllRes);
    expect(reloadAllRes.json).toHaveBeenCalledWith({ ok: true, reloaded: false, message: 'Runtime manifests are read on demand.' });

    const reloadOneRes = createResponse();
    await harness.postHandler('/api/extensions/:id/reload')({ params: { id: 'system-extension-manager' } }, reloadOneRes);
    expect(reloadOneRes.json).toHaveBeenCalledWith({
      ok: true,
      id: 'system-extension-manager',
      reloaded: false,
      message: 'Runtime manifests are read on demand.',
    });
  });
});
