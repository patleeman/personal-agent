/**
 * Folder picker route
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import { pickFolderCapability } from '../workspace/workspaceDesktopCapability.js';

let _getDefaultWebCwd: () => string = () => process.cwd();
let _resolveRequestedCwd: (cwd: string | null | undefined, defaultCwd?: string) => string | undefined = () => undefined;

function initializeFolderPickerRoutesContext(
  context: Pick<ServerRouteContext, 'getDefaultWebCwd' | 'resolveRequestedCwd'>,
): void {
  _getDefaultWebCwd = context.getDefaultWebCwd;
  _resolveRequestedCwd = context.resolveRequestedCwd;
}

export function registerFolderPickerRoutes(
  router: Pick<Express, 'post'>,
  context: Pick<ServerRouteContext, 'getDefaultWebCwd' | 'resolveRequestedCwd'>,
): void {
  initializeFolderPickerRoutesContext(context);
  router.post('/api/folder-picker', (req, res) => {
    const { cwd } = req.body as { cwd?: string | null };
    res.json(pickFolderCapability({ cwd }, {
      getDefaultWebCwd: _getDefaultWebCwd,
      resolveRequestedCwd: _resolveRequestedCwd,
    }));
  });
}
