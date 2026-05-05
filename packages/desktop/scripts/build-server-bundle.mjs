#!/usr/bin/env node

import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(currentDir, '..');
const outdir = resolve(packageRoot, 'server', 'dist');

rmSync(outdir, { recursive: true, force: true });

const sharedEsbuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  external: [
    '@personal-agent/core',
    '@personal-agent/daemon',
    '@mariozechner/pi-coding-agent',
    '@xenova/transformers',
    'better-sqlite3',
    'electron',
    'jsdom',
  ],
};

await Promise.all([
  // Main server bundle
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/app/localApi.ts')],
    outfile: resolve(outdir, 'app/localApi.js'),
    banner: {
      js: 'import { createRequire as __paCreateRequire } from "node:module"; const require = __paCreateRequire(import.meta.url);',
    },
  }),
  // Conversation inspect worker — runs synchronous file I/O off the main thread
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/conversations/conversationInspectWorker.ts')],
    outfile: resolve(outdir, 'conversations/conversationInspectWorker.js'),
  }),
  // Trace worker — runs all trace-db writes off the main thread
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/traces/traceWorker.ts')],
    outfile: resolve(outdir, 'traces/traceWorker.js'),
  }),
]);
