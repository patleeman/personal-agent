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
    outdir: dirname(outfile),
    entryNames: '[name]',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    bundle: true,
    splitting: true,
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
    plugins: [createFrontendRawCssPlugin(), createFrontendSharedReactPlugin(), createFrontendExtensionSdkPlugin()],
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
      js: 'import { createRequire as __paExtensionCreateRequire } from "node:module"; const require = __paExtensionCreateRequire(import.meta.url);',
    },
    external: [
      '@personal-agent/extensions/host',
      '@personal-agent/extensions/ui',
      '@personal-agent/extensions/workbench',
      '@personal-agent/extensions/workbench-artifacts',
      '@personal-agent/extensions/workbench-browser',
      '@personal-agent/extensions/workbench-diffs',
      '@personal-agent/extensions/workbench-files',
      '@personal-agent/extensions/workbench-runs',
      '@personal-agent/extensions/workbench-transcript',
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
  writeBundledRuntimePackageJson(outfile, buildOutputs);
}

writeBuildManifest(buildOutputs);

function createFrontendRawCssPlugin() {
  return {
    name: 'personal-agent-frontend-raw-css',
    setup(buildContext) {
      buildContext.onResolve({ filter: /\.css\?raw$/ }, async (args) => {
        const cssPath = args.path.slice(0, -'?raw'.length);
        const resolved = await buildContext.resolve(cssPath, { importer: args.importer, kind: args.kind, resolveDir: args.resolveDir });
        if (resolved.errors.length > 0) return { errors: resolved.errors };
        return { path: resolved.path, namespace: 'pa-raw-css' };
      });
      buildContext.onLoad({ filter: /\.css$/, namespace: 'pa-raw-css' }, (args) => ({
        contents: readFileSync(args.path, 'utf8'),
        loader: 'text',
      }));
    },
  };
}

function createFrontendSharedReactPlugin() {
  const reactFacade = `const React = globalThis.__PA_REACT__;
if (!React) throw new Error('Personal Agent React host runtime is unavailable.');
export const Children = React.Children;
export const Component = React.Component;
export const Fragment = React.Fragment;
export const Profiler = React.Profiler;
export const PureComponent = React.PureComponent;
export const StrictMode = React.StrictMode;
export const Suspense = React.Suspense;
export const cloneElement = React.cloneElement;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const createRef = React.createRef;
export const forwardRef = React.forwardRef;
export const isValidElement = React.isValidElement;
export const lazy = React.lazy;
export const memo = React.memo;
export const startTransition = React.startTransition;
export const use = React.use;
export const useActionState = React.useActionState;
export const useCallback = React.useCallback;
export const useContext = React.useContext;
export const useDebugValue = React.useDebugValue;
export const useDeferredValue = React.useDeferredValue;
export const useEffect = React.useEffect;
export const useId = React.useId;
export const useImperativeHandle = React.useImperativeHandle;
export const useInsertionEffect = React.useInsertionEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useOptimistic = React.useOptimistic;
export const useReducer = React.useReducer;
export const useRef = React.useRef;
export const useState = React.useState;
export const useSyncExternalStore = React.useSyncExternalStore;
export const useTransition = React.useTransition;
export const version = React.version;
export default React;
`;
  const jsxRuntimeFacade = `const runtime = globalThis.__PA_REACT_JSX_RUNTIME__;
if (!runtime) throw new Error('Personal Agent React JSX runtime is unavailable.');
export const Fragment = runtime.Fragment;
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
export const jsxDEV = runtime.jsxDEV;
`;
  return {
    name: 'personal-agent-frontend-shared-react',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^react$/ }, () => ({ path: 'pa-shared-react', namespace: 'pa-shared-react' }));
      buildContext.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
        path: 'pa-shared-react-jsx-runtime',
        namespace: 'pa-shared-react',
      }));
      buildContext.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
        path: 'pa-shared-react-jsx-dev-runtime',
        namespace: 'pa-shared-react',
      }));
      buildContext.onLoad({ filter: /^pa-shared-react$/, namespace: 'pa-shared-react' }, () => ({ contents: reactFacade, loader: 'js' }));
      buildContext.onLoad({ filter: /^pa-shared-react-jsx-(?:dev-)?runtime$/, namespace: 'pa-shared-react' }, () => ({
        contents: jsxRuntimeFacade,
        loader: 'js',
      }));
    },
  };
}

function createFrontendExtensionSdkPlugin() {
  const moduleFiles = {
    '@personal-agent/extensions/host': 'host.ts',
    '@personal-agent/extensions/ui': 'ui.ts',
    '@personal-agent/extensions/workbench': 'workbench.ts',
    '@personal-agent/extensions/data': 'data.ts',
    '@personal-agent/extensions/settings': 'settings.ts',
    '@personal-agent/extensions/host-view-components': 'host-view-components.ts',
    '@personal-agent/extensions/workbench-artifacts': 'workbench-artifacts.ts',
    '@personal-agent/extensions/workbench-browser': 'workbench-browser.ts',
    '@personal-agent/extensions/workbench-diffs': 'workbench-diffs.ts',
    '@personal-agent/extensions/workbench-files': 'workbench-files.ts',
    '@personal-agent/extensions/workbench-runs': 'workbench-runs.ts',
    '@personal-agent/extensions/workbench-transcript': 'workbench-transcript.ts',
  };
  return {
    name: 'personal-agent-frontend-extension-sdk',
    setup(buildContext) {
      buildContext.onResolve(
        {
          filter:
            /^@personal-agent\/extensions\/(host|ui|workbench|host-view-components|workbench-artifacts|workbench-browser|workbench-diffs|workbench-files|workbench-runs|workbench-transcript|data|settings)$/,
        },
        (args) => {
          const moduleFile = moduleFiles[args.path];
          const resolved = moduleFile ? join(repoRoot, 'packages/desktop/ui/src/extensions', moduleFile) : null;
          if (!resolved || !existsSync(resolved)) {
            return { errors: [{ text: `Could not resolve ${args.path} for frontend extension build.` }] };
          }
          return { path: resolved };
        },
      );
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
      buildContext.onResolve({ filter: /^@personal-agent\/extensions\/host-view-components$/ }, () => ({
        path: join(repoRoot, 'packages/extensions/src/host-view-components.ts'),
      }));
      buildContext.onResolve({ filter: /^@personal-agent\/daemon$/ }, (args) => {
        const desktopDaemonBundle = join(repoRoot, 'packages/desktop/server/dist/daemon/index.js');
        // Bundle the daemon runtime inline so extensions work in packaged
        // apps where the absolute build-time path no longer exists.
        return existsSync(desktopDaemonBundle) ? { path: desktopDaemonBundle, external: false } : { path: args.path, external: true };
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

function writeBundledRuntimePackageJson(outfile, buildOutputs) {
  // Bundled pi runtime modules read their own package metadata at module
  // initialization. In a bundle, import.meta.url points at the extension dist
  // directory instead of node_modules/@earendil-works/pi-coding-agent, so ship
  // a minimal compatible package.json next to backend.mjs for packaged Electron.
  const sourcePath = join(repoRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json');
  const source = existsSync(sourcePath)
    ? JSON.parse(readFileSync(sourcePath, 'utf-8'))
    : { name: '@earendil-works/pi-coding-agent', version: '0.0.0', piConfig: { configDir: '.pi' } };
  const outputPath = join(dirname(outfile), 'package.json');
  const metadata = {
    name: source.name ?? '@earendil-works/pi-coding-agent',
    version: source.version ?? '0.0.0',
    piConfig: source.piConfig ?? { configDir: '.pi' },
    type: 'module',
  };
  writeJson(outputPath, metadata);
  buildOutputs.push({ path: relativeToPackage(outputPath), bytes: readFileSync(outputPath).byteLength, imports: [] });
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
