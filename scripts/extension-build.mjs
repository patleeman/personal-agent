#!/usr/bin/env node
/* eslint-env node */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const HOST_RUNTIME_EXTERNAL_IMPORT_RE = /^(process|@xenova\/transformers|better-sqlite3|esbuild)(\/.*)?$/;
const FORBIDDEN_BACKEND_IMPORTS = new Set([
  'child_process',
  'node:child_process',
  'cluster',
  'node:cluster',
  'worker_threads',
  'node:worker_threads',
]);

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

const buildOutputs = [];

const frontendSource = join(packageRoot, 'src', 'frontend.tsx');
if (manifest.frontend?.entry && existsSync(frontendSource)) {
  const outfile = join(packageRoot, manifest.frontend.entry);
  mkdirSync(dirname(outfile), { recursive: true });
  const result = await build({
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
    plugins: [createFrontendExtensionSdkPlugin()],
    nodePaths: findAppNodeModules(),
    metafile: true,
  });
  recordBuildOutputs(buildOutputs, result.metafile);
}

const backendSource = join(packageRoot, 'src', 'backend.ts');
if (manifest.backend?.entry && existsSync(backendSource)) {
  const backendEntry = String(manifest.backend.entry);
  const outfile = backendEntry.startsWith('src/') ? join(packageRoot, 'dist', 'backend.mjs') : join(packageRoot, backendEntry);
  mkdirSync(dirname(outfile), { recursive: true });
  const result = await build({
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
      'process',
    ],
    nodePaths: findAppNodeModules(),
    plugins: [
      createForbiddenBackendImportPlugin(packageRoot),
      createExtensionBackendApiPlugin(),
      createHostRuntimeExternalPlugin(),
      createJsdomWorkerPlugin(),
    ],
    metafile: true,
  });
  recordBuildOutputs(buildOutputs, result.metafile);
  copyJsdomSyncWorkerIfNeeded(outfile, buildOutputs);
}

writeBuildManifest(buildOutputs);

function createFrontendExtensionSdkPlugin() {
  const moduleFiles = {
    '@personal-agent/extensions/host': 'host.ts',
    '@personal-agent/extensions/ui': 'ui.ts',
    '@personal-agent/extensions/workbench': 'workbench.ts',
    '@personal-agent/extensions/data': 'data.ts',
    '@personal-agent/extensions/settings': 'settings.ts',
  };
  return {
    name: 'personal-agent-frontend-extension-sdk',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^@personal-agent\/extensions\/(host|ui|workbench|data|settings)$/ }, (args) => {
        const moduleFile = moduleFiles[args.path];
        const resolved = moduleFile ? join(repoRoot, 'packages/desktop/ui/src/extensions', moduleFile) : null;
        if (!resolved || !existsSync(resolved)) {
          return { errors: [{ text: `Could not resolve ${args.path} for frontend extension build.` }] };
        }
        return { path: resolved };
      });
    },
  };
}

function createForbiddenBackendImportPlugin(extensionPackageRoot) {
  const sourceRoot = `${resolve(extensionPackageRoot, 'src')}/`;
  return {
    name: 'personal-agent-forbidden-backend-imports',
    setup(buildContext) {
      buildContext.onResolve({ filter: /.*/ }, (args) => {
        if (!FORBIDDEN_BACKEND_IMPORTS.has(args.path)) return;
        if (!args.importer || !resolve(args.importer).startsWith(sourceRoot)) return;
        return {
          errors: [
            {
              text: `Extension backend cannot import ${args.path}. Use ctx.shell so PA can apply execution wrappers and sandbox policy.`,
            },
          ],
        };
      });
    },
  };
}

function createExtensionBackendApiPlugin() {
  return {
    name: 'personal-agent-extension-backend-api',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^@personal-agent\/extensions\/backend$/ }, () => ({
        path: join(repoRoot, 'packages/desktop/server/extensions/backendApi/index.ts'),
      }));
      buildContext.onResolve({ filter: /^@personal-agent\/extensions\/backend\/(.+)$/ }, (args) => ({
        path: join(repoRoot, `packages/desktop/server/extensions/backendApi/${args.path.split('/').pop()}.ts`),
      }));
      buildContext.onResolve({ filter: /^@personal-agent\/daemon$/ }, (args) => {
        const desktopDaemonBundle = join(repoRoot, 'packages/desktop/server/dist/daemon/index.js');
        return existsSync(desktopDaemonBundle) ? { path: desktopDaemonBundle, external: true } : { path: args.path, external: true };
      });
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

function createJsdomWorkerPlugin() {
  return {
    name: 'personal-agent-jsdom-worker-stub',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^\.\/xhr-sync-worker\.js$/ }, () => ({
        path: 'personal-agent-jsdom-xhr-sync-worker',
        namespace: 'pa-jsdom',
      }));
      buildContext.onLoad({ filter: /.*/, namespace: 'pa-jsdom' }, () => ({ contents: 'export default "";', loader: 'js' }));
    },
  };
}

function recordBuildOutputs(buildOutputs, metafile) {
  for (const [outputPath, output] of Object.entries(metafile.outputs ?? {})) {
    buildOutputs.push({
      path: relativeToPackage(outputPath),
      bytes: output.bytes ?? 0,
      imports: (output.imports ?? []).map((item) => item.path).sort(),
    });
  }
}

function writeBuildManifest(buildOutputs) {
  writeJson(join(packageRoot, 'dist', 'build-manifest.json'), {
    extensionId: manifest.id,
    builtAt: new Date().toISOString(),
    frontendEntry: manifest.frontend?.entry ?? null,
    backendEntry: manifest.backend?.entry ?? null,
    outputs: buildOutputs.sort((left, right) => left.path.localeCompare(right.path)),
  });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function relativeToPackage(path) {
  return path.startsWith(`${packageRoot}/`) ? path.slice(packageRoot.length + 1) : path;
}

function copyJsdomSyncWorkerIfNeeded(outfile, buildOutputs) {
  // Some bundled dependencies resolve jsdom's sync XHR worker dynamically at
  // runtime, so the literal worker filename is not always present in the
  // bundle. Copying the tiny worker beside backend bundles is harmless and
  // keeps packaged extension import checks deterministic.
  const workerSource = join(repoRoot, 'node_modules', 'jsdom', 'lib', 'jsdom', 'living', 'xhr', 'xhr-sync-worker.js');
  if (!existsSync(workerSource)) return;
  const workerOutput = join(dirname(outfile), 'xhr-sync-worker.js');
  copyFileSync(workerSource, workerOutput);
  buildOutputs.push({ path: relativeToPackage(workerOutput), bytes: readFileSync(workerOutput).byteLength, imports: [] });
}

function findAppNodeModules() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(currentDir, '..');
  const paths = [
    resolve(process.cwd(), 'node_modules'),
    resolve(repoRoot, 'packages', 'desktop', 'node_modules'),
    resolve(repoRoot, 'packages', 'core', 'node_modules'),
    resolve(repoRoot, 'node_modules'),
  ];
  if (typeof process.resourcesPath === 'string') {
    paths.push(resolve(process.resourcesPath, 'app.asar.unpacked/node_modules'));
  }
  for (let depth = 2; depth <= 5; depth++) {
    paths.push(resolve(currentDir, ...Array(depth).fill('..'), 'node_modules'));
  }
  return [...new Set(paths)];
}
