import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

function assertInside(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(resolvedRoot, candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Path escapes workspace root.');
  }
  return resolvedCandidate;
}

function normalizeWorkspaceRoot(cwd: string): string {
  const resolved = resolve(cwd);
  if (!existsSync(resolved)) {
    throw new Error(`Workspace does not exist: ${cwd}`);
  }
  return resolved;
}

export function createExtensionWorkspaceCapability() {
  return {
    async readText(input: { cwd: string; path: string; maxBytes?: number }): Promise<{ path: string; content: string; sha256: string }> {
      const root = normalizeWorkspaceRoot(input.cwd);
      const filePath = assertInside(root, input.path);
      const buffer = await readFile(filePath);
      const maxBytes = input.maxBytes ?? 1024 * 1024;
      if (buffer.byteLength > maxBytes) {
        throw new Error(`File is too large (${buffer.byteLength} bytes, max ${maxBytes}).`);
      }
      return {
        path: relative(root, filePath),
        content: buffer.toString('utf-8'),
        sha256: createHash('sha256').update(buffer).digest('hex'),
      };
    },

    async writeText(input: { cwd: string; path: string; content: string }): Promise<{ path: string; bytes: number }> {
      const root = normalizeWorkspaceRoot(input.cwd);
      const filePath = assertInside(root, input.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, input.content, 'utf-8');
      return { path: relative(root, filePath), bytes: Buffer.byteLength(input.content) };
    },

    async list(input: {
      cwd: string;
      path?: string;
      depth?: number;
    }): Promise<Array<{ path: string; type: 'file' | 'directory'; size?: number }>> {
      const root = normalizeWorkspaceRoot(input.cwd);
      const start = assertInside(root, input.path ?? '.');
      const maxDepth = input.depth ?? 1;
      const entries: Array<{ path: string; type: 'file' | 'directory'; size?: number }> = [];

      async function visit(directory: string, depth: number): Promise<void> {
        for (const dirent of await readdir(directory, { withFileTypes: true })) {
          if (dirent.name === 'node_modules' || dirent.name === '.git') continue;
          const fullPath = join(directory, dirent.name);
          const relativePath = relative(root, fullPath);
          if (dirent.isDirectory()) {
            entries.push({ path: relativePath, type: 'directory' });
            if (depth < maxDepth) await visit(fullPath, depth + 1);
          } else if (dirent.isFile()) {
            const fileStat = await stat(fullPath);
            entries.push({ path: relativePath, type: 'file', size: fileStat.size });
          }
        }
      }

      const startStat = await stat(start);
      if (startStat.isDirectory()) {
        await visit(start, 0);
      } else if (startStat.isFile()) {
        entries.push({ path: relative(root, start), type: 'file', size: startStat.size });
      }
      return entries;
    },
  };
}
