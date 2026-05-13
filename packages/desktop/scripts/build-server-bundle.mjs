#!/usr/bin/env node

import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(currentDir, '..');
const outdir = resolve(packageRoot, 'server', 'dist');

rmSync(outdir, { recursive: true, force: true });

const createRequireBanner =
  'import { createRequire as __paCreateRequire } from "node:module"; const require = __paCreateRequire(import.meta.url);';

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
    '@earendil-works/pi-coding-agent',
    '@xenova/transformers',
    'better-sqlite3',
    'electron',
    'esbuild',
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
      js: createRequireBanner,
    },
  }),
  // Conversation inspect worker — runs synchronous file I/O off the main thread
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/conversations/conversationInspectWorker.ts')],
    outfile: resolve(outdir, 'conversations/conversationInspectWorker.js'),
    banner: {
      js: createRequireBanner,
    },
  }),
  // Trace worker — runs all trace-db writes off the main thread
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/traces/traceWorker.ts')],
    outfile: resolve(outdir, 'traces/traceWorker.js'),
  }),
  // Daemon barrel used by @personal-agent/daemon and iOS companion dev host.
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/daemon/index.ts')],
    outfile: resolve(outdir, 'daemon/index.js'),
    banner: {
      js: createRequireBanner,
    },
  }),
]);
