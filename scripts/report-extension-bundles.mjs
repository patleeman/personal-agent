#!/usr/bin/env node
/* eslint-env node */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { backendBundleByteLimit, frontendInitialBundleByteLimit } from './extension-hardening-config.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = [join(repoRoot, 'extensions'), join(repoRoot, 'experimental-extensions/extensions')];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function extensionDirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((dir) => existsSync(join(dir, 'extension.json')))
    .sort((left, right) => left.localeCompare(right));
}

function backendPath(dir, manifest) {
  const entry = manifest.backend?.entry;
  if (!entry) return undefined;
  return entry.startsWith('src/') ? join(dir, 'dist/backend.mjs') : join(dir, entry);
}

function frontendInitialPaths(dir, manifest) {
  const entry = manifest.frontend?.entry;
  if (!entry) return [];
  return [entry, ...(manifest.frontend?.styles ?? [])].map((item) => join(dir, item));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const backendRows = [];
const frontendRows = [];
for (const root of roots) {
  for (const dir of extensionDirs(root)) {
    const manifest = readJson(join(dir, 'extension.json'));
    const path = backendPath(dir, manifest);
    if (path) {
      const limit = backendBundleByteLimit(manifest.id);
      const size = existsSync(path) ? statSync(path).size : 0;
      backendRows.push({
        id: manifest.id,
        size,
        limit,
        headroom: limit - size,
        status: size === 0 ? 'missing' : size > limit ? 'over' : size > limit * 0.8 ? 'near' : 'ok',
      });
    }

    const frontendLimit = frontendInitialBundleByteLimit(manifest.id);
    if (frontendLimit !== null) {
      const paths = frontendInitialPaths(dir, manifest);
      const size = paths.reduce((total, frontendPath) => total + (existsSync(frontendPath) ? statSync(frontendPath).size : 0), 0);
      frontendRows.push({
        id: manifest.id,
        size,
        limit: frontendLimit,
        headroom: frontendLimit - size,
        status: size === 0 ? 'missing' : size > frontendLimit ? 'over' : size > frontendLimit * 0.8 ? 'near' : 'ok',
      });
    }
  }
}

backendRows.sort((left, right) => right.size - left.size);
console.log('Backend bundles');
console.table(
  backendRows.map((row) => ({
    id: row.id,
    size: formatBytes(row.size),
    limit: formatBytes(row.limit),
    headroom: formatBytes(row.headroom),
    status: row.status,
  })),
);

if (frontendRows.length > 0) {
  frontendRows.sort((left, right) => right.size - left.size);
  console.log('Frontend initial bundles');
  console.table(
    frontendRows.map((row) => ({
      id: row.id,
      size: formatBytes(row.size),
      limit: formatBytes(row.limit),
      headroom: formatBytes(row.headroom),
      status: row.status,
    })),
  );
}

const overBackend = backendRows.filter((row) => row.status === 'over');
const overFrontend = frontendRows.filter((row) => row.status === 'over');
if (overBackend.length > 0 || overFrontend.length > 0) {
  if (overBackend.length > 0)
    console.error(`Backend bundle budget exceeded by ${overBackend.length} extension${overBackend.length === 1 ? '' : 's'}.`);
  if (overFrontend.length > 0)
    console.error(`Frontend initial bundle budget exceeded by ${overFrontend.length} extension${overFrontend.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
