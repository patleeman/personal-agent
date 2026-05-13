#!/usr/bin/env node
/* eslint-env node */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const labsRoot = resolve(repoRoot, 'experimental-extensions');
const extensionId = readFlag('--extension') ?? process.argv[2];

if (!extensionId) fail('Usage: pnpm run build -- --extension <extension-id>');

const extensionRoot = resolve(labsRoot, 'extensions', extensionId);
if (!existsSync(resolve(extensionRoot, 'extension.json'))) fail(`No extension found at ${extensionRoot}`);

const result = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/extension-build.mjs'), extensionRoot], {
  cwd: repoRoot,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
