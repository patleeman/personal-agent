import { getVaultRoot } from '@personal-agent/core';

import { listVaultFiles } from '../knowledge/vaultFiles.js';
import type { FilePickerResult } from './filePicker.js';
import { pickFiles } from './filePicker.js';
import type { FolderPickerResult } from './folderPicker.js';
import { pickFolder } from './folderPicker.js';

export interface WorkspaceDesktopCapabilityContext {
  getDefaultWebCwd: () => string;
  resolveRequestedCwd: (cwd: string | null | undefined, defaultCwd?: string) => string | undefined;
}

export function readVaultFilesCapability() {
  const root = getVaultRoot();
  return {
    root,
    files: listVaultFiles(root),
  };
}

export function pickFolderCapability(
  input: { cwd?: string | null | undefined; prompt?: string | null | undefined },
  context: WorkspaceDesktopCapabilityContext,
): FolderPickerResult {
  const defaultWebCwd = context.getDefaultWebCwd();
  return pickFolder({
    initialDirectory: context.resolveRequestedCwd(input.cwd, defaultWebCwd) ?? defaultWebCwd,
    prompt: typeof input.prompt === 'string' && input.prompt.trim().length > 0 ? input.prompt.trim() : 'Choose working directory',
  });
}

export function pickFilesCapability(
  input: { cwd?: string | null | undefined; prompt?: string | null | undefined },
  context: WorkspaceDesktopCapabilityContext,
): FilePickerResult {
  const defaultWebCwd = context.getDefaultWebCwd();
  return pickFiles({
    initialDirectory: context.resolveRequestedCwd(input.cwd, defaultWebCwd) ?? defaultWebCwd,
    prompt: typeof input.prompt === 'string' && input.prompt.trim().length > 0 ? input.prompt.trim() : 'Choose instruction files',
  });
}
