import { resolve } from 'node:path';

import { defaultFileSystemAuthority, type FileAccess, type ScopedFileSystem } from '../filesystem/filesystemAuthority.js';

function workspaceRootId(cwd: string): string {
  return resolve(cwd);
}

export function createExtensionFilesystemCapability(extensionId: string, toolContext?: { cwd?: string }) {
  async function requestWorkspace(cwd: string, access: FileAccess[], reason: string): Promise<ScopedFileSystem> {
    return defaultFileSystemAuthority.requestRoot({
      subject: { type: 'extension', extensionId },
      root: { kind: 'workspace', id: workspaceRootId(cwd), path: cwd, displayName: cwd },
      access,
      reason,
    });
  }

  return {
    async requestRoot(input: { kind?: 'workspace'; cwd?: string; access?: FileAccess[]; reason?: string }): Promise<ScopedFileSystem> {
      const kind = input.kind ?? 'workspace';
      if (kind !== 'workspace') throw new Error(`Unsupported extension filesystem root kind: ${kind}`);
      const cwd = input.cwd ?? toolContext?.cwd;
      if (!cwd) throw new Error('Workspace cwd required.');
      return requestWorkspace(cwd, input.access ?? ['read', 'list', 'metadata'], input.reason ?? 'extension filesystem access');
    },

    async workspace(input?: { cwd?: string; access?: FileAccess[]; reason?: string }): Promise<ScopedFileSystem> {
      const cwd = input?.cwd ?? toolContext?.cwd;
      if (!cwd) throw new Error('Workspace cwd required.');
      return requestWorkspace(cwd, input?.access ?? ['read', 'list', 'metadata'], input?.reason ?? 'extension workspace access');
    },

    async temp(input?: { access?: FileAccess[]; reason?: string; prefix?: string }): Promise<ScopedFileSystem> {
      return defaultFileSystemAuthority.createTempRoot({
        subject: { type: 'extension', extensionId },
        access: input?.access ?? ['read', 'write', 'delete', 'list', 'metadata'],
        reason: input?.reason ?? 'extension temp workspace',
        prefix: input?.prefix,
      });
    },
  };
}
