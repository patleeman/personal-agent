import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlResponse(body = '<!doctype html><html><body>SPA fallback</body></html>', status = 200): Response {
  return new Response(body, {
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    headers: { 'Content-Type': 'text/html' },
  });
}

function resetApiTestGlobals(): void {
  vi.resetModules();
}

describe('api request parsing', () => {
  beforeEach(resetApiTestGlobals);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the API path when an OK response is HTML instead of JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse()),
    );

    const { api } = await import('./api.js');
    await expect(api.status()).rejects.toThrow('Expected JSON from /api/status, received text/html: <!doctype html>');
  });

  it('includes non-JSON error body previews', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse('<!doctype html><html><body>Missing route</body></html>', 404)),
    );

    const { api } = await import('./api.js');
    await expect(api.status()).rejects.toThrow('404 Not Found from /api/status: <!doctype html>');
  });
});

describe('api.extensions', () => {
  beforeEach(resetApiTestGlobals);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads extension command registrations', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ extensionId: 'agent-board', surfaceId: 'task', name: 'task' }]));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    await expect(api.extensionSlashCommands()).resolves.toEqual([{ extensionId: 'agent-board', surfaceId: 'task', name: 'task' }]);

    expect(fetchMock).toHaveBeenCalledWith('/api/extensions/slash-commands', { method: 'GET', cache: 'no-store' });
  });

  it('creates extension packages', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, packageRoot: '/tmp/extensions/agent-board' }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    await expect(api.createExtension({ id: 'agent-board', name: 'Agent Board' })).resolves.toEqual({
      ok: true,
      packageRoot: '/tmp/extensions/agent-board',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/extensions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'agent-board', name: 'Agent Board' }),
    });
  });

  it('imports extension packages', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, packageRoot: '/tmp/extensions/agent-board' }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    await expect(api.importExtension({ zipPath: '/tmp/agent-board.zip' })).resolves.toEqual({
      ok: true,
      packageRoot: '/tmp/extensions/agent-board',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/extensions/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zipPath: '/tmp/agent-board.zip' }),
    });
  });

  it('snapshots extension packages', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, extensionId: 'agent-board', snapshotPath: '/tmp/snapshots/agent-board' }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    await expect(api.snapshotExtension('agent-board')).resolves.toEqual({
      ok: true,
      extensionId: 'agent-board',
      snapshotPath: '/tmp/snapshots/agent-board',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/extensions/agent-board/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('exports extension packages', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, extensionId: 'agent-board', exportPath: '/tmp/agent-board.zip' }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    await expect(api.exportExtension('agent-board')).resolves.toEqual({
      ok: true,
      extensionId: 'agent-board',
      exportPath: '/tmp/agent-board.zip',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/extensions/agent-board/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('invokes extension actions', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, result: { text: 'created' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    await expect(api.invokeExtensionAction('agent-board', 'createTask', { argument: 'Ship it' })).resolves.toEqual({
      ok: true,
      result: { text: 'created' },
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/extensions/agent-board/actions/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ argument: 'Ship it' }),
    });
  });
});

describe('api.memory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dedupes concurrent memory requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ skills: [], memoryDocs: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    const [first, second] = await Promise.all([api.memory(), api.memory()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ skills: [], memoryDocs: [] });
    expect(second).toEqual(first);
  });

  it('ignores legacy profile arguments for memory requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ skills: [], memoryDocs: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api.js');
    await Promise.all([api.memory(), api.memory()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/memory');
  });
});
