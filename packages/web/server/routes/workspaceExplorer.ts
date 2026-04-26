import type { Express } from 'express';
import { watch } from 'node:fs';
import type { ServerRouteContext } from './context.js';
import { listWorkspaceDirectory, readWorkspaceDiffOverlay, readWorkspaceFile, readWorkspaceRootSnapshot } from '../workspace/workspaceExplorer.js';
import { logError } from '../shared/logging.js';

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

export function registerWorkspaceExplorerRoutes(
  router: Pick<Express, 'get'>,
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
