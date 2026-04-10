/**
 * Shell execution route
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import { runShellCommandCapability } from '../workspace/shellRunCapability.js';

let _getDefaultWebCwd: () => string = () => process.cwd();
let _resolveRequestedCwd: (cwd: string | null | undefined, defaultCwd?: string) => string | undefined = () => undefined;

function initializeShellRoutesContext(
  context: Pick<ServerRouteContext, 'getDefaultWebCwd' | 'resolveRequestedCwd'>,
): void {
  _getDefaultWebCwd = context.getDefaultWebCwd;
  _resolveRequestedCwd = context.resolveRequestedCwd;
}

export function registerShellRoutes(
  router: Pick<Express, 'post'>,
  context: Pick<ServerRouteContext, 'getDefaultWebCwd' | 'resolveRequestedCwd'>,
): void {
  initializeShellRoutesContext(context);
  router.post('/api/run', (req, res) => {
    try {
      res.json(runShellCommandCapability(req.body as { command?: string; cwd?: string | null }, {
        getDefaultWebCwd: _getDefaultWebCwd,
        resolveRequestedCwd: _resolveRequestedCwd,
      }));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
