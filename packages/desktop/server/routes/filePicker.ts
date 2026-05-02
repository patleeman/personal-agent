import type { Express } from 'express';

import { pickFilesCapability } from '../workspace/workspaceDesktopCapability.js';
import type { ServerRouteContext } from './context.js';

let _getDefaultWebCwd: () => string = () => process.cwd();
let _resolveRequestedCwd: (cwd: string | null | undefined, defaultCwd?: string) => string | undefined = () => undefined;

function initializeFilePickerRoutesContext(context: Pick<ServerRouteContext, 'getDefaultWebCwd' | 'resolveRequestedCwd'>): void {
  _getDefaultWebCwd = context.getDefaultWebCwd;
  _resolveRequestedCwd = context.resolveRequestedCwd;
}

export function registerFilePickerRoutes(
  router: Pick<Express, 'post'>,
  context: Pick<ServerRouteContext, 'getDefaultWebCwd' | 'resolveRequestedCwd'>,
): void {
  initializeFilePickerRoutesContext(context);
  router.post('/api/file-picker', (req, res) => {
    const { cwd } = req.body as { cwd?: string | null };
    res.json(
      pickFilesCapability(
        { cwd },
        {
          getDefaultWebCwd: _getDefaultWebCwd,
          resolveRequestedCwd: _resolveRequestedCwd,
        },
      ),
    );
  });
}
