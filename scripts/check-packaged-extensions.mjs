#!/usr/bin/env node
/* eslint-env node */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

import { init, parse } from 'es-module-lexer';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.setMaxListeners(0);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionsRoot = join(repoRoot, 'extensions');

const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const allowedBackendBareImports = new Set([
  'better-sqlite3',
  'electron',
  'esbuild',
  'fsevents',
  '@personal-agent/extensions/host',
  '@personal-agent/extensions/ui',
  '@personal-agent/extensions/workbench',
  '@personal-agent/extensions/settings',
  '@personal-agent/extensions/data',
  '@personal-agent/extensions/excalidraw',
]);
const allowedFrontendBareImports = new Set(['@personal-agent/extensions', 'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime']);
const forbiddenBackendPrefixes = [
  '@earendil-works/pi-coding-agent',
  '@personal-agent/core',
  '@personal-agent/daemon',
  '@personal-agent/extensions/backend',
  '@sinclair/typebox',
  'jsdom',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function listSystemExtensionDirs() {
  if (!existsSync(extensionsRoot)) return [];
  return readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('system-'))
    .map((entry) => join(extensionsRoot, entry.name))
    .filter((dir) => existsSync(join(dir, 'extension.json')))
    .sort((left, right) => left.localeCompare(right));
}

function isBareSpecifier(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:') && !specifier.startsWith('data:');
}

function packageNameFor(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return `${scope}/${name ?? ''}`;
  }
  return specifier.split('/')[0];
}

function collectBareImports(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const [imports] = parse(source);
  const specifiers = new Set();
  for (const importRecord of imports) {
    const specifier = importRecord.n;
    if (!specifier || !isBareSpecifier(specifier) || nodeBuiltins.has(specifier)) continue;
    specifiers.add(specifier);
  }
  return [...specifiers].sort();
}

function isAllowedBackendImport(specifier) {
  if (allowedBackendBareImports.has(specifier)) return true;
  const packageName = packageNameFor(specifier);
  return allowedBackendBareImports.has(packageName);
}

function isAllowedFrontendImport(specifier) {
  if (allowedFrontendBareImports.has(specifier)) return true;
  return allowedFrontendBareImports.has(packageNameFor(specifier));
}

function isForbiddenBackendImport(specifier) {
  return forbiddenBackendPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`));
}

function backendEntryPath(extensionDir, manifest) {
  const entry = manifest.backend?.entry;
  if (!entry) return undefined;
  return entry.startsWith('src/') ? join(extensionDir, 'dist', 'backend.mjs') : join(extensionDir, entry);
}

function frontendEntryPath(extensionDir, manifest) {
  const entry = manifest.frontend?.entry;
  return entry ? join(extensionDir, entry) : undefined;
}

await init;

const failures = [];
const rows = [];

for (const extensionDir of listSystemExtensionDirs()) {
  const manifestPath = join(extensionDir, 'extension.json');
  const manifest = readJson(manifestPath);
  const id = manifest.id ?? extensionDir;
  const backendPath = backendEntryPath(extensionDir, manifest);
  const frontendPath = frontendEntryPath(extensionDir, manifest);
  const row = { id, backend: 'none', frontend: 'none', actions: manifest.backend?.actions?.length ?? 0 };

  if (backendPath) {
    if (!existsSync(backendPath)) {
      failures.push(`${id}: missing packaged backend entry ${backendPath}`);
      row.backend = 'missing';
    } else {
      const bareImports = collectBareImports(backendPath);
      const forbidden = bareImports.filter(isForbiddenBackendImport);
      const unexpected = bareImports.filter((specifier) => !isAllowedBackendImport(specifier));
      if (forbidden.length > 0) failures.push(`${id}: backend bundle contains forbidden packaged-runtime imports: ${forbidden.join(', ')}`);
      if (unexpected.length > 0) failures.push(`${id}: backend bundle contains unexpected bare imports: ${unexpected.join(', ')}`);
      try {
        await import(pathToFileURL(backendPath).href);
        row.backend = bareImports.length > 0 ? `ok (${bareImports.length} external)` : 'ok';
      } catch (error) {
        failures.push(`${id}: backend import failed: ${error instanceof Error ? error.message : String(error)}`);
        row.backend = 'failed';
      }
    }
  }

  if (frontendPath) {
    if (!existsSync(frontendPath)) {
      failures.push(`${id}: missing packaged frontend entry ${frontendPath}`);
      row.frontend = 'missing';
    } else {
      const bareImports = collectBareImports(frontendPath);
      const unexpected = bareImports.filter((specifier) => !isAllowedFrontendImport(specifier));
      if (unexpected.length > 0) failures.push(`${id}: frontend bundle contains unexpected bare imports: ${unexpected.join(', ')}`);
      row.frontend = bareImports.length > 0 ? `ok (${bareImports.length} external)` : 'ok';
    }
  }

  rows.push(row);
}

console.table(rows);

if (failures.length > 0) {
  console.error('\nPackaged extension check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Packaged extension check passed for ${rows.length} system extensions.`);
