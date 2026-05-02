#!/usr/bin/env node

import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(currentDir, '..');
const outdir = resolve(packageRoot, 'server', 'dist');

rmSync(outdir, { recursive: true, force: true });

await build({
  entryPoints: [resolve(packageRoot, 'server/app/localApi.ts')],
  outfile: resolve(outdir, 'app/localApi.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: {
    js: 'import { createRequire as __paCreateRequire } from "node:module"; const require = __paCreateRequire(import.meta.url);',
  },
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
});
