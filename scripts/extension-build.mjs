#!/usr/bin/env node
/* eslint-env node */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { build } from 'esbuild';

const packageRoot = resolve(process.argv[2] || process.cwd());
const manifestPath = join(packageRoot, 'extension.json');
if (!existsSync(manifestPath)) {
  console.error(`No extension.json found at ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 2) {
  console.error('Only native extension manifest schemaVersion 2 is supported by this builder.');
  process.exit(1);
}

mkdirSync(join(packageRoot, 'dist'), { recursive: true });

const frontendSource = join(packageRoot, 'src', 'frontend.tsx');
if (manifest.frontend?.entry && existsSync(frontendSource)) {
  const outfile = join(packageRoot, manifest.frontend.entry);
  mkdirSync(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [frontendSource],
    outfile,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: true,
    logLevel: 'info',
    external: ['@personal-agent/extensions', '@personal-agent/extensions/*'],
  });
}

const backendSource = join(packageRoot, 'src', 'backend.ts');
if (manifest.backend?.entry && existsSync(backendSource)) {
  const backendEntry = String(manifest.backend.entry);
  const outfile = backendEntry.startsWith('src/') ? join(packageRoot, 'dist', 'backend.mjs') : join(packageRoot, backendEntry);
  mkdirSync(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [backendSource],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: true,
    logLevel: 'info',
    external: ['@personal-agent/*', 'electron'],
  });
}
