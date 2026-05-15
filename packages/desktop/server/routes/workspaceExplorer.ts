import { watch } from 'node:fs';

import type { Express } from 'express';

import { logError } from '../shared/logging.js';
import {
  createWorkspaceFolder,
  deleteWorkspacePath,
  listWorkspaceDirectory,
  moveWorkspacePath,
  readUncommittedDiffAsync,
  readWorkspaceDiffOverlay,
  readWorkspaceFile,
  readWorkspaceRootSnapshot,
  renameWorkspacePath,
  writeWorkspaceFile,
} from '../workspace/workspaceExplorer.js';
import type { ServerRouteContext } from './context.js';

function resolveRequestCwd(context: Pick<ServerRouteContext, 'getDefaultWebCwd' | 'resolveRequestedCwd'>, cwd: unknown): string {
  const requested = typeof cwd === 'string' ? cwd : null;
  const resolved = context.resolveRequestedCwd(requested, context.getDefaultWebCwd());
  if (!resolved) {
    throw new Error('Unable to resolve workspace cwd');
  }
  return resolved;
}

function readQueryString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function writeWorkspaceError(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const status = /escapes workspace root|not a directory|no such file|ENOENT/i.test(message) ? 400 : 500;
  res.status(status).json({ error: message });
}

function publishHostEvent(source: string, payload: unknown): void {
  void import('../extensions/extensionSubscriptions.js')
    .then(({ publishExtensionHostEvent }) => publishExtensionHostEvent(source, payload))
    .catch((error) => {
      logError('extension host event publish failed', { message: error instanceof Error ? error.message : String(error) });
    });
}

export function registerWorkspaceExplorerRoutes(
  router: Pick<Express, 'delete' | 'get' | 'post' | 'put'>,
  context: Pick<ServerRouteContext, 'getDefaultWebCwd' | 'resolveRequestedCwd'>,
): void {
  router.get('/api/workspace/tree', (req, res) => {
    try {
      const cwd = resolveRequestCwd(context, req.query.cwd);
      res.json(listWorkspaceDirectory(cwd, readQueryString(req.query.path)));
    } catch (error) {
      logError('workspace tree request failed', { message: error instanceof Error ? error.message : String(error) });
      writeWorkspaceError(res, error);
    }
  });

  router.get('/api/workspace/file', (req, res) => {
    try {
      const cwd = resolveRequestCwd(context, req.query.cwd);
      const path = readQueryString(req.query.path);
      if (!path) {
        res.status(400).json({ error: 'path required' });
        return;
      }
      res.json(readWorkspaceFile(cwd, path, req.query.force === '1'));
    } catch (error) {
      logError('workspace file request failed', { message: error instanceof Error ? error.message : String(error) });
      writeWorkspaceError(res, error);
    }
  });

  router.put('/api/workspace/file', (req, res) => {
    try {
      const cwd = resolveRequestCwd(context, req.body?.cwd);
      const path = readQueryString(req.body?.path);
      const content = typeof req.body?.content === 'string' ? req.body.content : null;
      if (!path || content === null) {
        res.status(400).json({ error: 'cwd, path, and content required' });
        return;
      }
      const result = writeWorkspaceFile(cwd, path, content);
      publishHostEvent('workspaceFiles', { action: 'write', cwd, path });
      res.json(result);
    } catch (error) {
      logError('workspace file write failed', { message: error instanceof Error ? error.message : String(error) });
      writeWorkspaceError(res, error);
    }
  });

  router.delete('/api/workspace/path', (req, res) => {
    try {
      const cwd = resolveRequestCwd(context, req.query.cwd);
      const path = readQueryString(req.query.path);
      if (!path) {
        res.status(400).json({ error: 'path required' });
        return;
      }
      const result = deleteWorkspacePath(cwd, path);
      publishHostEvent('workspaceFiles', { action: 'delete', cwd, path });
      res.json(result);
    } catch (error) {
      logError('workspace path delete failed', { message: error instanceof Error ? error.message : String(error) });
      writeWorkspaceError(res, error);
    }
  });

  router.post('/api/workspace/folder', (req, res) => {
    try {
      const cwd = resolveRequestCwd(context, req.body?.cwd);
      const path = readQueryString(req.body?.path);
      if (!path) {
        res.status(400).json({ error: 'path required' });
        return;
      }
      const result = createWorkspaceFolder(cwd, path);
      publishHostEvent('workspaceFiles', { action: 'createFolder', cwd, path });
      res.json(result);
    } catch (error) {
      logError('workspace folder create failed', { message: error instanceof Error ? error.message : String(error) });
      writeWorkspaceError(res, error);
    }
  });

  router.post('/api/workspace/rename', (req, res) => {
    try {
      const cwd = resolveRequestCwd(context, req.body?.cwd);
      const path = readQueryString(req.body?.path);
      const newName = readQueryString(req.body?.newName);
      if (!path || !newName) {
        res.status(400).json({ error: 'path and newName required' });
        return;
      }
      const result = renameWorkspacePath(cwd, path, newName);
      publishHostEvent('workspaceFiles', { action: 'rename', cwd, path, newName });
      res.json(result);
    } catch (error) {
      logError('workspace path rename failed', { message: error instanceof Error ? error.message : String(error) });
      writeWorkspaceError(res, error);
    }
  });

  router.post('/api/workspace/move', (req, res) => {
    try {
      const cwd = resolveRequestCwd(context, req.body?.cwd);
      const path = readQueryString(req.body?.path);
      const targetDir = typeof req.body?.targetDir === 'string' ? req.body.targetDir : '';
      if (!path) {
        res.status(400).json({ error: 'path required' });
        return;
      }
      const result = moveWorkspacePath(cwd, path, targetDir);
      publishHostEvent('workspaceFiles', { action: 'move', cwd, path, targetDir });
      res.json(result);
    } catch (error) {
      logError('workspace path move failed', { message: error instanceof Error ? error.message : String(error) });
      writeWorkspaceError(res, error);
    }
  });

  router.get('/api/workspace/diff', (req, res) => {
    try {
      const cwd = resolveRequestCwd(context, req.query.cwd);
      const path = readQueryString(req.query.path);
      if (!path) {
        res.status(400).json({ error: 'path required' });
        return;
      }
      res.json(readWorkspaceDiffOverlay(cwd, path));
    } catch (error) {
      logError('workspace diff request failed', { message: error instanceof Error ? error.message : String(error) });
      writeWorkspaceError(res, error);
    }
  });

  router.get('/api/workspace/uncommitted-diff', async (req, res) => {
    try {
      const cwd = resolveRequestCwd(context, req.query.cwd);
      const result = await readUncommittedDiffAsync(cwd);
      if (!result) {
        res.json({ branch: null, changeCount: 0, linesAdded: 0, linesDeleted: 0, files: [] });
        return;
      }
      res.json(result);
    } catch (error) {
      logError('workspace uncommitted diff request failed', { message: error instanceof Error ? error.message : String(error) });
      writeWorkspaceError(res, error);
    }
  });

  router.get('/api/workspace/events', (req, res) => {
    let watcher: ReturnType<typeof watch> | null = null;
    try {
      const cwd = resolveRequestCwd(context, req.query.cwd);
      const snapshot = readWorkspaceRootSnapshot(cwd);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(`event: ready\ndata: ${JSON.stringify({ root: snapshot.root })}\n\n`);

      watcher = watch(snapshot.root, { recursive: true }, (eventType, filename) => {
        res.write(`event: workspace\ndata: ${JSON.stringify({ eventType, path: typeof filename === 'string' ? filename : null })}\n\n`);
      });

      req.on('close', () => {
        watcher?.close();
        watcher = null;
      });
    } catch (error) {
      watcher?.close();
      logError('workspace events request failed', { message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) {
        writeWorkspaceError(res, error);
      } else {
        res.end();
      }
    }
  });
}
