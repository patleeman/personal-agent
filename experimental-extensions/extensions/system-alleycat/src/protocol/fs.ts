import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import type { MethodHandler } from '../codexJsonRpcServer.js';

/**
 * Codex `fs/*` handler functions.
 * These operate on absolute paths (host file system).
 * The extension runs in the desktop server process and has Node.js fs access.
 */

function fuzzySearchFiles(params: unknown) {
  const p = params as Record<string, unknown> | undefined;
  const query = typeof p?.query === 'string' ? p.query.toLowerCase() : '';
  const roots = Array.isArray(p?.roots) ? p.roots.filter((root): root is string => typeof root === 'string' && root.trim().length > 0) : [];
  const files: Array<{ root: string; path: string; matchType: 'file' | 'directory'; fileName: string; score: number; indices?: number[] }> =
    [];
  const maxPerRoot = 80;

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const stack = [root];
    let count = 0;
    while (stack.length && count < maxPerRoot) {
      const dir = stack.pop()!;
      let entries: ReturnType<typeof readdirSync>;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'target') continue;
        const fullPath = join(dir, entry.name);
        const rel = relative(root, fullPath) || entry.name;
        const haystack = `${entry.name}\n${rel}`.toLowerCase();
        if (query && !haystack.includes(query)) {
          if (entry.isDirectory()) stack.push(fullPath);
          continue;
        }
        files.push({
          root,
          path: fullPath,
          matchType: entry.isDirectory() ? 'directory' : 'file',
          fileName: basename(fullPath),
          score: query ? Math.max(1, 1000 - haystack.indexOf(query)) : 1,
        });
        count += 1;
        if (entry.isDirectory()) stack.push(fullPath);
        if (count >= maxPerRoot) break;
      }
    }
  }

  return { files };
}

export const fs = {
  /**
   * `fs/readFile` — read a file and return base64-encoded data.
   */
  readFile: (async (params) => {
    const path = (params as Record<string, unknown> | undefined)?.path as string | undefined;
    if (!path) throw new Error('path is required');
    const data = readFileSync(path);
    return { dataBase64: data.toString('base64') };
  }) as MethodHandler,

  /**
   * `fs/writeFile` — write a file from base64-encoded data.
   */
  writeFile: (async (params) => {
    const p = params as Record<string, unknown> | undefined;
    const path = p?.path as string | undefined;
    const dataBase64 = p?.dataBase64 as string | undefined;
    if (!path) throw new Error('path is required');
    if (!dataBase64) throw new Error('dataBase64 is required');
    writeFileSync(path, Buffer.from(dataBase64, 'base64'));
    return {};
  }) as MethodHandler,

  /**
   * `fs/getMetadata` — get file/directory metadata.
   */
  getMetadata: (async (params) => {
    const path = (params as Record<string, unknown> | undefined)?.path as string | undefined;
    if (!path) throw new Error('path is required');
    const stats = statSync(path);
    return {
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      isSymlink: stats.isSymbolicLink(),
      createdAtMs: stats.birthtimeMs,
      modifiedAtMs: stats.mtimeMs,
    };
  }) as MethodHandler,

  /**
   * `fs/createDirectory` — create a directory.
   */
  createDirectory: (async (params) => {
    const p = params as Record<string, unknown> | undefined;
    const path = p?.path as string | undefined;
    const recursive = p?.recursive !== false;
    if (!path) throw new Error('path is required');
    mkdirSync(path, { recursive });
    return {};
  }) as MethodHandler,

  /**
   * `fs/remove` — remove a file or directory.
   */
  remove: (async (params) => {
    const p = params as Record<string, unknown> | undefined;
    const path = p?.path as string | undefined;
    const recursive = p?.recursive !== false;
    const force = p?.force !== false;
    if (!path) throw new Error('path is required');
    try {
      rmSync(path, { recursive, force });
    } catch {
      /* ok */
    }
    return {};
  }) as MethodHandler,

  /**
   * `fs/copy` — copy a file or directory.
   */
  copy: (async (params) => {
    const p = params as Record<string, unknown> | undefined;
    const from = p?.from as string | undefined;
    const to = p?.to as string | undefined;
    const recursive = p?.recursive === true;
    if (!from) throw new Error('from is required');
    if (!to) throw new Error('to is required');
    cpSync(from, to, { recursive });
    return {};
  }) as MethodHandler,

  /**
   * `fs/readDirectory` — list directory entries.
   */
  fuzzyFileSearch: (async (params) => fuzzySearchFiles(params)) as MethodHandler,

  readDirectory: (async (params) => {
    const path = (params as Record<string, unknown> | undefined)?.path as string | undefined;
    if (!path) throw new Error('path is required');
    const entries = readdirSync(path, { withFileTypes: true });
    return {
      data: entries.map((entry) => ({
        fileName: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      })),
    };
  }) as MethodHandler,
};
