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
  resolve(outdir, 'core/index.js'),
];

const backendApiLazyModuleEntries = [
  ['conversations/conversationAutoTitle.js', 'server/conversations/conversationAutoTitle.ts'],
  ['conversations/conversationCwd.js', 'server/conversations/conversationCwd.ts'],
  ['conversations/conversationInspectWorkerClient.js', 'server/conversations/conversationInspectWorkerClient.ts'],
  ['conversations/conversationSearchIndex.js', 'server/conversations/conversationSearchIndex.ts'],
  ['conversations/conversationService.js', 'server/conversations/conversationService.ts'],
  ['conversations/conversationSessionCapability.js', 'server/conversations/conversationSessionCapability.ts'],
  ['conversations/conversationSummaries.js', 'server/conversations/conversationSummaries.ts'],
  ['conversations/liveSessions.js', 'server/conversations/liveSessions.ts'],
  ['conversations/sessionExchange.js', 'server/conversations/sessionExchange.ts'],
  ['conversations/sessions.js', 'server/conversations/sessions.ts'],
  ['knowledge/vaultFiles.js', 'server/knowledge/vaultFiles.ts'],
  ['automation/deferredResumes.js', 'server/automation/deferredResumes.ts'],
  ['automation/humanDateTime.js', 'server/automation/humanDateTime.ts'],
  ['automation/scheduledTasks.js', 'server/automation/scheduledTasks.ts'],
  ['automation/scheduledTaskThreads.js', 'server/automation/scheduledTaskThreads.ts'],
  ['automation/store.js', 'server/automation/store.ts'],
  ['routes/vaultShareImport.js', 'server/routes/vaultShareImport.ts'],
  ['shared/appEvents.js', 'server/shared/appEvents.ts'],
  ['traces/tracePersistence.js', 'server/traces/tracePersistence.ts'],
  ['extensions/runtimeAgentHooks.js', 'server/extensions/runtimeAgentHooks.ts'],
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
  // Package the core runtime behind a stable app.asar path so prebuilt extension
  // backends can resolve @personal-agent/core without relying on workspace
  // node_modules symlinks that do not exist in signed apps.
  build({
    ...sharedEsbuildOptions,
    entryPoints: [resolve(packageRoot, '..', 'core/src/index.ts')],
    outfile: bundleOutputs[5],
    banner: {
      js: createRequireBanner,
    },
  }),
  ...backendApiLazyModuleEntries.map(([outfile, entryPoint]) =>
    build({
      ...sharedEsbuildOptions,
      entryPoints: [resolve(packageRoot, entryPoint)],
      outfile: resolve(outdir, outfile),
      banner: {
        js: createRequireBanner,
      },
    }),
  ),
]);

bundleOutputs.push(...backendApiLazyModuleEntries.map(([outfile]) => resolve(outdir, outfile)));

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
