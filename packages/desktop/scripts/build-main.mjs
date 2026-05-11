#!/usr/bin/env node
/* eslint-env node */
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(fileURLToPath(import.meta.url), '..', '..');
const entry = resolve(dir, 'src', 'main.ts');
const outfile = resolve(dir, 'dist', 'main.js');

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: {
    js: `import process from 'node:process';import { createRequire } from 'node:module';const require=createRequire(import.meta.url);`,
  },
  external: ['electron', 'fsevents'],
  logLevel: 'info',
  nodePaths: [resolve(dir, '..', '..', 'node_modules')],
});
