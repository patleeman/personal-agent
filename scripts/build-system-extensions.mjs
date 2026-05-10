#!/usr/bin/env node
/* eslint-env node */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionsRoot = join(repoRoot, 'extensions');
const extensionBuildScript = join(repoRoot, 'scripts', 'extension-build.mjs');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function listSystemExtensionDirs() {
  if (!existsSync(extensionsRoot)) {
    return [];
  }

  return readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('system-'))
    .map((entry) => join(extensionsRoot, entry.name))
    .filter((extensionDir) => existsSync(join(extensionDir, 'extension.json')))
    .sort((left, right) => left.localeCompare(right));
}

function assertManifestEntriesExist(extensionDir) {
  const manifestPath = join(extensionDir, 'extension.json');
  const manifest = readJson(manifestPath);
  const requiredEntries = [manifest.frontend?.entry, ...(manifest.frontend?.styles ?? []), manifest.backend?.entry].filter(
    (entry) => typeof entry === 'string' && entry.trim().length > 0,
  );
  const missingEntries = requiredEntries.filter((entry) => !existsSync(join(extensionDir, entry)));

  if (missingEntries.length > 0) {
    throw new Error(`${manifest.id ?? extensionDir} manifest points at missing built entries: ${missingEntries.join(', ')}`);
  }
}

const extensionDirs = listSystemExtensionDirs();

for (const extensionDir of extensionDirs) {
  console.log(`Building ${extensionDir.replace(`${repoRoot}/`, '')}`);
  execFileSync(process.execPath, [extensionBuildScript, extensionDir], { cwd: repoRoot, stdio: 'inherit' });
  assertManifestEntriesExist(extensionDir);
}

console.log(`Built and verified ${extensionDirs.length} system extensions.`);
