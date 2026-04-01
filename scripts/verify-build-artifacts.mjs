#!/usr/bin/env node

import { chmodSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const requiredArtifacts = [
  'packages/core/dist/index.js',
  'packages/core/dist/profile/index.js',
  'packages/core/dist/runtime/index.js',
  'packages/resources/dist/index.js',
  'packages/resources/dist/prompt-catalog.js',
  'packages/cli/dist/index.js',
  'packages/daemon/dist/index.js',
  'packages/services/dist/index.js',
  'packages/web/dist-server/automation/distillConversationMemoryRun.js',
  'packages/web/dist-server/automation/recoverConversationMemoryDistillRuns.js',
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

for (const relativePath of ['packages/cli/dist/index.js', 'packages/daemon/dist/index.js']) {
  chmodSync(join(repoRoot, relativePath), 0o755);
}

console.log(`Verified ${requiredArtifacts.length} build artifacts and normalized CLI/daemon executable bits.`);
