#!/usr/bin/env node

import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(currentDir, '..');
const outdir = resolve(packageRoot, 'server', 'dist');

rmSync(outdir, { recursive: true, force: true });

const createRequireBanner =
  'import { createRequire as __paServerCreateRequire } from "node:module"; const require = __paServerCreateRequire(import.meta.url);';

const extensionApiAliasPlugin = {
  name: 'extension-api-aliases',
  setup(build) {
    build.onResolve({ filter: /^@personal-agent\/extensions\/host-view-components$/ }, () => ({
      path: resolve(packageRoot, '..', 'extensions', 'src', 'host-view-components.ts'),
    }));
  },
};

const sharedEsbuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  external: ['@xenova/transformers', 'better-sqlite3', 'electron', 'esbuild', 'fsevents'],
  plugins: [extensionApiAliasPlugin],
};

const bundleOutputs = [
  resolve(outdir, 'app/localApi.js'),
  resolve(outdir, 'conversations/conversationInspectWorker.js'),
  resolve(outdir, 'traces/traceWorker.js'),
  resolve(outdir, 'daemon/index.js'),
  resolve(outdir, 'daemon/background-agent-runner.js'),
];

await Promise.all([
  // Main server bundle
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/app/localApi.ts')],
    outfile: bundleOutputs[0],
    banner: {
      js: createRequireBanner,
    },
  }),
  // Conversation inspect worker — runs synchronous file I/O off the main thread
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/conversations/conversationInspectWorker.ts')],
    outfile: bundleOutputs[1],
    banner: {
      js: createRequireBanner,
    },
  }),
  // Trace worker — runs all trace-db writes off the main thread
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/traces/traceWorker.ts')],
    outfile: bundleOutputs[2],
  }),
  // Daemon barrel used by @personal-agent/daemon and iOS companion dev host.
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/daemon/index.ts')],
    outfile: bundleOutputs[3],
    banner: {
      js: createRequireBanner,
    },
  }),
  // Durable background agent runner spawned by the daemon for subagents and scheduled agent runs.
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, 'server/daemon/background-agent-runner.ts')],
    outfile: bundleOutputs[4],
    banner: {
      js: createRequireBanner,
    },
  }),
]);

// jiti's bundled Babel copy contains a duplicate TypeScript heritage switch case. When
// another esbuild pass parses our server bundle, it reports a noisy duplicate-case warning.
const removeDuplicateTypeScriptHeritageCase = (bundleOutput) => {
  const source = readFileSync(bundleOutput, 'utf-8');
  const cleaned = source.replaceAll(
    'case"TSExpressionWithTypeArguments":case"TSExpressionWithTypeArguments":',
    'case"TSExpressionWithTypeArguments":',
  );

  if (cleaned !== source) {
    writeFileSync(bundleOutput, cleaned);
  }
};

for (const bundleOutput of bundleOutputs) {
  removeDuplicateTypeScriptHeritageCase(bundleOutput);
}

const jsdomXhrSyncWorker = resolve(packageRoot, 'node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js');
const piCodingAgentPackageJson = resolve(packageRoot, 'node_modules/@earendil-works/pi-coding-agent/package.json');
const piCodingAgentPackageMetadata = existsSync(piCodingAgentPackageJson)
  ? JSON.parse(readFileSync(piCodingAgentPackageJson, 'utf-8'))
  : { name: '@earendil-works/pi-coding-agent', version: '0.0.0', piConfig: { configDir: '.pi' } };
const bundledRuntimePackageJson = {
  name: piCodingAgentPackageMetadata.name ?? '@earendil-works/pi-coding-agent',
  version: piCodingAgentPackageMetadata.version ?? '0.0.0',
  piConfig: piCodingAgentPackageMetadata.piConfig ?? { configDir: '.pi' },
  type: 'module',
};

for (const bundleOutput of bundleOutputs) {
  const outputDir = dirname(bundleOutput);
  const workerOutput = resolve(outputDir, 'xhr-sync-worker.js');
  mkdirSync(outputDir, { recursive: true });
  copyFileSync(jsdomXhrSyncWorker, workerOutput);
  writeFileSync(resolve(outputDir, 'package.json'), `${JSON.stringify(bundledRuntimePackageJson, null, 2)}\n`);
}
