/**
 * Folder picker route
 */

import type { Express } from 'express';
import { pickFolder } from '../workspace/folderPicker.js';

let _getDefaultWebCwd: () => string = () => process.cwd();
let _resolveRequestedCwd: (cwd: string | undefined, defaultCwd: string) => string | undefined = () => undefined;

export function setFolderPickerCwdGetters(
  getDefaultWebCwd: () => string,
  resolveRequestedCwd: (cwd: string | undefined, defaultCwd: string) => string | undefined,
): void {
  _getDefaultWebCwd = getDefaultWebCwd;
  _resolveRequestedCwd = resolveRequestedCwd;
}

export function registerFolderPickerRoutes(router: Pick<Express, 'post'>): void {
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
