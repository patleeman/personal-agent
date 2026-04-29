#!/usr/bin/env node

import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(currentDir, '..');
const outdir = resolve(packageRoot, 'dist-server');

rmSync(outdir, { recursive: true, force: true });

await build({
  entryPoints: [resolve(packageRoot, 'server/app/localApi.ts')],
  outfile: resolve(outdir, 'app/localApi.js'),
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
    'better-sqlite3',
    'electron',
    'jsdom',
  ],
});
