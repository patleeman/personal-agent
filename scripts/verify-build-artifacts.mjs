#!/usr/bin/env node

import { chmodSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const requiredArtifacts = [
  'packages/core/dist/index.js',
  'packages/core/dist/runtime/index.js',
  'packages/core/dist/resources.js',
  'packages/core/dist/prompt-catalog.js',
  'packages/desktop/dist/server/daemon/index.js',
  'packages/desktop/dist/server/daemon/server.js',
  'packages/desktop/server/dist/app/localApi.js',
];

const missingArtifacts = requiredArtifacts.filter((relativePath) => !existsSync(join(repoRoot, relativePath)));

if (missingArtifacts.length > 0) {
  console.error('Missing required build artifacts:');
  for (const relativePath of missingArtifacts) {
    console.error(`- ${relativePath}`);
  }

  console.error('');
  console.error('Re-run with a full rebuild: npm run clean --workspaces --if-present && npm run build');
  process.exit(1);
}

chmodSync(join(repoRoot, 'packages/desktop/dist/server/daemon/index.js'), 0o755);

console.log(`Verified ${requiredArtifacts.length} build artifacts and normalized daemon executable bits.`);
