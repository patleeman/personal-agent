#!/usr/bin/env node
/* eslint-env node */
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(fileURLToPath(import.meta.url), '..', '..');

// Build main process bundle
await build({
  entryPoints: [resolve(dir, 'src', 'main.ts')],
  outdir: resolve(dir, 'dist'),
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: {
    js: `import { createRequire as __paCreateRequire } from 'node:module';var require=__paCreateRequire(import.meta.url);`,
  },
  external: ['electron', 'fsevents'],
  logLevel: 'info',
  nodePaths: [resolve(dir, '..', '..', 'node_modules')],
});

// Build preload script (must be CommonJS for Electron sandbox)
await build({
  entryPoints: [resolve(dir, 'src', 'preload.cts')],
  outfile: resolve(dir, 'dist', 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  logLevel: 'info',
  nodePaths: [resolve(dir, '..', '..', 'node_modules')],
});

// Build local API workers (runs the server bundle in worker threads)
await build({
  entryPoints: [resolve(dir, 'src', 'local-api-worker.ts')],
  outfile: resolve(dir, 'dist', 'local-api-worker.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['electron'],
  logLevel: 'info',
  nodePaths: [resolve(dir, '..', '..', 'node_modules')],
});
await build({
  entryPoints: [resolve(dir, 'src', 'readonly-local-api-worker.ts')],
  outfile: resolve(dir, 'dist', 'readonly-local-api-worker.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['electron'],
  logLevel: 'info',
  nodePaths: [resolve(dir, '..', '..', 'node_modules')],
});
