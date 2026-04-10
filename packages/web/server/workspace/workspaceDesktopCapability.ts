import { getVaultRoot } from '@personal-agent/core';
import type { FolderPickerResult } from './folderPicker.js';
import { pickFolder } from './folderPicker.js';
import { listVaultFiles } from '../knowledge/vaultFiles.js';

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
  input: { cwd?: string | null | undefined },
  context: WorkspaceDesktopCapabilityContext,
): FolderPickerResult {
  const defaultWebCwd = context.getDefaultWebCwd();
  return pickFolder({
    initialDirectory: context.resolveRequestedCwd(input.cwd, defaultWebCwd) ?? defaultWebCwd,
    prompt: 'Choose working directory',
  });
}
