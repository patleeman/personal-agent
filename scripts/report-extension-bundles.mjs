#!/usr/bin/env node
/* eslint-env node */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { backendBundleByteLimit } from './extension-hardening-config.mjs';

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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const rows = [];
for (const root of roots) {
  for (const dir of extensionDirs(root)) {
    const manifest = readJson(join(dir, 'extension.json'));
    const path = backendPath(dir, manifest);
    if (!path) continue;
    const limit = backendBundleByteLimit(manifest.id);
    const size = existsSync(path) ? statSync(path).size : 0;
    rows.push({
      id: manifest.id,
      size,
      limit,
      headroom: limit - size,
      status: size === 0 ? 'missing' : size > limit ? 'over' : size > limit * 0.8 ? 'near' : 'ok',
    });
  }
}

rows.sort((left, right) => right.size - left.size);
console.table(
  rows.map((row) => ({
    id: row.id,
    size: formatBytes(row.size),
    limit: formatBytes(row.limit),
    headroom: formatBytes(row.headroom),
    status: row.status,
  })),
);

const over = rows.filter((row) => row.status === 'over');
if (over.length > 0) {
  console.error(`Backend bundle budget exceeded by ${over.length} extension${over.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
