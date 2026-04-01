/**
 * Folder picker route
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import { pickFolder } from '../workspace/folderPicker.js';

let _getDefaultWebCwd: () => string = () => process.cwd();
let _resolveRequestedCwd: (cwd: string | undefined, defaultCwd: string) => string | undefined = () => undefined;

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
    const defaultWebCwd = _getDefaultWebCwd();
    const { cwd } = req.body as { cwd?: string };
    const result = pickFolder({
      initialDirectory: _resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd,
      prompt: 'Choose working directory',
    });
    res.json(result);
  });
}
