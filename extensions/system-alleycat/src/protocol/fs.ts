import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

import type { MethodHandler } from '../codexJsonRpcServer.js';

/**
 * Codex `fs/*` handler functions.
 * These operate on absolute paths (host file system).
 * The extension runs in the desktop server process and has Node.js fs access.
 */

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
