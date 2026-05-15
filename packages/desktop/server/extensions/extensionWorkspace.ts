import { createHash } from 'node:crypto';

import type { FileAccess } from '../filesystem/filesystemAuthority.js';
import { createExtensionFilesystemCapability } from './extensionFilesystem.js';

export function createExtensionWorkspaceCapability(extensionId = 'unknown-extension', toolContext?: { cwd?: string }) {
  const filesystem = createExtensionFilesystemCapability(extensionId, toolContext);

  async function workspace(cwd: string, access: FileAccess[], reason: string) {
    return filesystem.workspace({ cwd, access, reason });
  }

  return {
    async readText(input: { cwd: string; path: string; maxBytes?: number }): Promise<{ path: string; content: string; sha256: string }> {
      const root = await workspace(input.cwd, ['read'], 'extension workspace readText');
      const buffer = Buffer.from(await root.readBytes(input.path, { maxBytes: input.maxBytes ?? 1024 * 1024 }));
      const normalizedPath = root.relativePath(root.resolvePath(input.path)) ?? input.path;
      return {
        path: normalizedPath,
        content: buffer.toString('utf-8'),
        sha256: createHash('sha256').update(buffer).digest('hex'),
      };
    },

    async writeText(input: { cwd: string; path: string; content: string }): Promise<{ path: string; bytes: number }> {
      const root = await workspace(input.cwd, ['write'], 'extension workspace writeText');
      await root.writeText(input.path, input.content);
      return { path: root.relativePath(root.resolvePath(input.path)) ?? input.path, bytes: Buffer.byteLength(input.content) };
    },

    async list(input: {
      cwd: string;
      path?: string;
      depth?: number;
    }): Promise<Array<{ path: string; type: 'file' | 'directory'; size?: number }>> {
      const root = await workspace(input.cwd, ['list', 'metadata'], 'extension workspace list');
      const entries = await root.list(input.path ?? '.', { depth: input.depth ?? 1, excludeNames: ['node_modules', '.git'] });
      return entries
        .filter((entry) => entry.type === 'file' || entry.type === 'directory')
        .map((entry) => ({
          path: entry.path,
          type: entry.type as 'file' | 'directory',
          ...(entry.size !== undefined ? { size: entry.size } : {}),
        }));
    },
  };
}
