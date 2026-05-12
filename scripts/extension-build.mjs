#!/usr/bin/env node
/* eslint-env node */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const HOST_RUNTIME_EXTERNAL_IMPORT_RE = /^(@xenova\/transformers|better-sqlite3|esbuild|jsdom|@sinclair\/typebox)(\/.*)?$/;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
    conditions: ['browser', 'production'],
    loader: {
      '.woff': 'dataurl',
      '.woff2': 'dataurl',
      '.ttf': 'dataurl',
      '.otf': 'dataurl',
    },
    external: ['@personal-agent/extensions', '@personal-agent/extensions/*'],
    nodePaths: findAppNodeModules(),
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
    banner: {
      js: 'import { createRequire as __paCreateRequire } from "node:module"; const require = __paCreateRequire(import.meta.url);',
    },
    external: [
      '@personal-agent/extensions/host',
      '@personal-agent/extensions/ui',
      '@personal-agent/extensions/workbench',
      '@personal-agent/extensions/settings',
      '@personal-agent/extensions/data',
      '@personal-agent/extensions/excalidraw',
      'electron',
      'fsevents',
    ],
    nodePaths: findAppNodeModules(),
    plugins: [createExtensionBackendApiPlugin(), createHostRuntimeExternalPlugin()],
  });
}

function createExtensionBackendApiPlugin() {
  return {
    name: 'personal-agent-extension-backend-api',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^@personal-agent\/extensions\/backend$/ }, () => ({
        path: join(repoRoot, 'packages/desktop/server/extensions/backendApi/index.ts'),
      }));
    },
  };
}

function createHostRuntimeExternalPlugin() {
  return {
    name: 'personal-agent-extension-host-runtime-externals',
    setup(buildContext) {
      buildContext.onResolve({ filter: HOST_RUNTIME_EXTERNAL_IMPORT_RE }, (args) => ({ path: args.path, external: true }));
    },
  };
}

function findAppNodeModules() {
  const paths = [resolve(process.cwd(), 'node_modules')];
  if (typeof process.resourcesPath === 'string') {
    paths.push(resolve(process.resourcesPath, 'app.asar.unpacked/node_modules'));
  }
  const currentDir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 2; depth <= 5; depth++) {
    paths.push(resolve(currentDir, ...Array(depth).fill('..'), 'node_modules'));
  }
  return paths;
}
