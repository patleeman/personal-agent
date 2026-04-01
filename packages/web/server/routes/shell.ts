/**
 * Shell execution route
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import { execSync } from 'node:child_process';

let _getDefaultWebCwd: () => string = () => process.cwd();
let _resolveRequestedCwd: (cwd: string | undefined, defaultCwd: string) => string | undefined = () => undefined;

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
    const defaultWebCwd = _getDefaultWebCwd();
    const { command, cwd: runCwd } = req.body as { command: string; cwd?: string };
    if (!command) { res.status(400).json({ error: 'command required' }); return; }
    const resolvedRunCwd = _resolveRequestedCwd(runCwd, defaultWebCwd) ?? defaultWebCwd;
    let output = '';
    let exitCode = 0;
    try {
      output = execSync(command, {
        cwd: resolvedRunCwd,
        timeout: 30_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      const e = err as { stderr?: string; stdout?: string; status?: number; message?: string };
      output = (e.stdout ?? '') + (e.stderr ?? e.message ?? '');
      exitCode = e.status ?? 1;
    }
    res.json({ output, exitCode, cwd: resolvedRunCwd });
  });
}
