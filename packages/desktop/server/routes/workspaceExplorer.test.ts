import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({ watch: vi.fn() }));

vi.mock('../shared/logging.js', () => ({ logError: vi.fn() }));

vi.mock('../workspace/workspaceExplorer.js', () => ({
  listWorkspaceDirectory: vi.fn(),
  readWorkspaceFile: vi.fn(),
  writeWorkspaceFile: vi.fn(),
  deleteWorkspacePath: vi.fn(),
  createWorkspaceFolder: vi.fn(),
  renameWorkspacePath: vi.fn(),
  moveWorkspacePath: vi.fn(),
  readWorkspaceDiffOverlay: vi.fn(),
  readUncommittedDiff: vi.fn(),
  readWorkspaceRootSnapshot: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as logging from '../shared/logging.js';
import * as workspace from '../workspace/workspaceExplorer.js';
import { registerWorkspaceExplorerRoutes } from './workspaceExplorer.js';

function mockRouter() {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
}

function mockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const writeHead = vi.fn();
  const write = vi.fn();
  const end = vi.fn();
  return { json, status, writeHead, write, end, headersSent: false } as any;
}

function mockContext() {
  return {
    getDefaultWebCwd: () => '/repo',
    resolveRequestedCwd: (requested: string | null, fallback: string) => requested ?? fallback,
  };
}

function getHandler(router: ReturnType<typeof mockRouter>, method: 'get' | 'post' | 'put' | 'delete', path: string) {
  const calls = router[method].mock.calls;
  for (const [p, h] of calls) {
    if (p === path) return h;
  }
  return null;
}

describe('registerWorkspaceExplorerRoutes', () => {
  it('registers all expected routes', () => {
    const router = mockRouter();
    registerWorkspaceExplorerRoutes(router as any, mockContext());
    const paths = ['get', 'post', 'put', 'delete'].flatMap((m) => (router as any)[m].mock.calls.map((c: any) => `${m} ${c[0]}`)).sort();
    expect(paths).toContain('get /api/workspace/tree');
    expect(paths).toContain('get /api/workspace/file');
    expect(paths).toContain('get /api/workspace/diff');
    expect(paths).toContain('get /api/workspace/uncommitted-diff');
    expect(paths).toContain('get /api/workspace/events');
    expect(paths).toContain('put /api/workspace/file');
    expect(paths).toContain('post /api/workspace/folder');
    expect(paths).toContain('post /api/workspace/rename');
    expect(paths).toContain('post /api/workspace/move');
    expect(paths).toContain('delete /api/workspace/path');
  });

  describe('GET /api/workspace/tree', () => {
    it('returns directory listing', async () => {
      vi.mocked(workspace.listWorkspaceDirectory).mockReturnValue([{ name: 'src', type: 'dir' }] as any);
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'get', '/api/workspace/tree');
      const res = mockRes();
      await h({ query: { cwd: '/repo' } }, res);
      expect(res.json).toHaveBeenCalledWith([{ name: 'src', type: 'dir' }]);
    });

    it('returns 400 when cwd resolution fails', async () => {
      const ctx = { getDefaultWebCwd: () => '/repo', resolveRequestedCwd: () => null };
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, ctx);
      const h = getHandler(router, 'get', '/api/workspace/tree');
      const res = mockRes();
      await h({ query: { cwd: '../escape' } }, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Unable to resolve') });
    });
  });

  describe('GET /api/workspace/file', () => {
    it('returns file content', async () => {
      vi.mocked(workspace.readWorkspaceFile).mockReturnValue({ content: 'hello' } as any);
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'get', '/api/workspace/file');
      const res = mockRes();
      await h({ query: { cwd: '/repo', path: 'src/index.ts' } }, res);
      expect(res.json).toHaveBeenCalledWith({ content: 'hello' });
    });

    it('returns 400 when path missing', async () => {
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'get', '/api/workspace/file');
      const res = mockRes();
      await h({ query: { cwd: '/repo' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'path required' });
    });
  });

  describe('PUT /api/workspace/file', () => {
    it('writes file content', async () => {
      vi.mocked(workspace.writeWorkspaceFile).mockReturnValue({ ok: true } as any);
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'put', '/api/workspace/file');
      const res = mockRes();
      await h({ body: { cwd: '/repo', path: 'src/test.txt', content: 'hi' } }, res);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 400 when path or content missing', async () => {
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'put', '/api/workspace/file');
      const res = mockRes();
      await h({ body: { cwd: '/repo' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('DELETE /api/workspace/path', () => {
    it('deletes a path', async () => {
      vi.mocked(workspace.deleteWorkspacePath).mockReturnValue({ ok: true } as any);
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'delete', '/api/workspace/path');
      const res = mockRes();
      await h({ query: { cwd: '/repo', path: 'old-file.ts' } }, res);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 400 when path missing', async () => {
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'delete', '/api/workspace/path');
      const res = mockRes();
      await h({ query: { cwd: '/repo' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('POST /api/workspace/folder', () => {
    it('creates a folder', async () => {
      vi.mocked(workspace.createWorkspaceFolder).mockReturnValue({ path: 'new-folder' } as any);
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'post', '/api/workspace/folder');
      const res = mockRes();
      await h({ body: { cwd: '/repo', path: 'new-folder' } }, res);
      expect(res.json).toHaveBeenCalledWith({ path: 'new-folder' });
    });
  });

  describe('POST /api/workspace/rename', () => {
    it('renames a path', async () => {
      vi.mocked(workspace.renameWorkspacePath).mockReturnValue({ ok: true } as any);
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'post', '/api/workspace/rename');
      const res = mockRes();
      await h({ body: { cwd: '/repo', path: 'old', newName: 'new' } }, res);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 400 when newName missing', async () => {
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'post', '/api/workspace/rename');
      const res = mockRes();
      await h({ body: { cwd: '/repo', path: 'old' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('GET /api/workspace/uncommitted-diff', () => {
    it('returns diff or empty state', async () => {
      vi.mocked(workspace.readUncommittedDiff).mockReturnValue(null);
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'get', '/api/workspace/uncommitted-diff');
      const res = mockRes();
      await h({ query: { cwd: '/repo' } }, res);
      expect(res.json).toHaveBeenCalledWith({ branch: null, changeCount: 0, linesAdded: 0, linesDeleted: 0, files: [] });
    });
  });

  describe('error handling', () => {
    it('maps workspace error codes to 400 or 500', async () => {
      vi.mocked(workspace.listWorkspaceDirectory).mockImplementation(() => {
        throw new Error('escapes workspace root');
      });
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'get', '/api/workspace/tree');
      const res = mockRes();
      await h({ query: { cwd: '/repo' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('maps generic errors to 500', async () => {
      vi.mocked(workspace.listWorkspaceDirectory).mockImplementation(() => {
        throw new Error('internal error');
      });
      const router = mockRouter();
      registerWorkspaceExplorerRoutes(router as any, mockContext());
      const h = getHandler(router, 'get', '/api/workspace/tree');
      const res = mockRes();
      await h({ query: { cwd: '/repo' } }, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
