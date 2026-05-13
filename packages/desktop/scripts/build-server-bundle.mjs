#!/usr/bin/env node

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(currentDir, '..');
const outdir = resolve(packageRoot, 'server', 'dist');

rmSync(outdir, { recursive: true, force: true });

const createRequireBanner =
  'import { createRequire as __paCreateRequire } from "node:module"; const require = __paCreateRequire(import.meta.url);';

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

const jsdomXhrSyncWorker = resolve(packageRoot, 'node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js');
for (const bundleOutput of bundleOutputs) {
  const workerOutput = resolve(dirname(bundleOutput), 'xhr-sync-worker.js');
  mkdirSync(dirname(workerOutput), { recursive: true });
  copyFileSync(jsdomXhrSyncWorker, workerOutput);
}
