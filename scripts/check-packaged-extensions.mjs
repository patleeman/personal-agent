#!/usr/bin/env node
/* eslint-env node */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { init, parse } from 'es-module-lexer';

import { backendBundleByteLimit, criticalSmokeActionInput, FORBIDDEN_BUNDLED_PATH_FRAGMENTS } from './extension-hardening-config.mjs';

process.setMaxListeners(0);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputRoot = process.argv[2] ? resolve(process.argv[2]) : repoRoot;
const packagedAppResourcesRoot = inputRoot.endsWith('.app') ? join(inputRoot, 'Contents', 'Resources') : null;
const extensionsRoot = packagedAppResourcesRoot ? join(packagedAppResourcesRoot, 'extensions') : join(inputRoot, 'extensions');
const experimentalExtensionsRoot = packagedAppResourcesRoot
  ? join(packagedAppResourcesRoot, 'experimental-extensions', 'extensions')
  : join(inputRoot, 'experimental-extensions', 'extensions');

if (packagedAppResourcesRoot) {
  Object.defineProperty(process, 'resourcesPath', {
    value: packagedAppResourcesRoot,
    configurable: true,
  });
}

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

function listExtensionDirs(root, predicate = () => true) {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && predicate(entry.name))
    .map((entry) => join(root, entry.name))
    .filter((dir) => existsSync(join(dir, 'extension.json')))
    .sort((left, right) => left.localeCompare(right));
}

function listPackagedExtensionDirs() {
  return [...listExtensionDirs(extensionsRoot, (name) => name.startsWith('system-')), ...listExtensionDirs(experimentalExtensionsRoot)];
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

function collectImportSpecifiers(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const [imports] = parse(source);
  return imports
    .map((importRecord) => importRecord.n)
    .filter(Boolean)
    .sort();
}

function collectBareImports(filePath) {
  const specifiers = new Set();
  for (const specifier of collectImportSpecifiers(filePath)) {
    if (!isBareSpecifier(specifier) || nodeBuiltins.has(specifier)) continue;
    specifiers.add(specifier);
  }
  return [...specifiers].sort();
}

function collectNonPortableImports(filePath) {
  return collectImportSpecifiers(filePath).filter((specifier) => specifier.startsWith('/') || specifier.startsWith('file:'));
}

function collectForbiddenBundledPaths(filePath) {
  const source = readFileSync(filePath, 'utf8');
  return FORBIDDEN_BUNDLED_PATH_FRAGMENTS.filter((fragment) => source.includes(fragment));
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

function safeActionInputFor(id, manifest, actionId) {
  const criticalInput = criticalSmokeActionInput(id, actionId);
  if (criticalInput !== undefined) return criticalInput;
  const tool = manifest.contributes?.tools?.find((candidate) => candidate.action === actionId);
  const safeListTools = new Set(['scheduled_task', 'conversation_queue', 'run']);
  if (!tool?.name || !safeListTools.has(tool.name)) return undefined;
  const actionEnum = tool.inputSchema?.properties?.action?.enum;
  if (Array.isArray(actionEnum) && actionEnum.includes('list')) return { action: 'list' };
  return undefined;
}

function createSmokeContext(extensionId) {
  const noop = () => undefined;
  return {
    extensionId,
    profile: 'shared',
    toolContext: { conversationId: 'extension-smoke-test', cwd: repoRoot },
    ui: { invalidate: noop },
    log: { info: noop, warn: noop, error: noop },
    runtime: { getRepoRoot: () => repoRoot, getLiveSessionResourceOptions: () => ({}) },
    storage: {
      get: async () => null,
      put: async () => ({ ok: true }),
      delete: async () => ({ ok: true, deleted: false }),
      list: async () => [],
    },
    notify: {
      toast: noop,
      system: () => false,
      setBadge: () => ({ badge: 0, aggregated: 0 }),
      clearBadge: noop,
      isSystemAvailable: () => false,
    },
    events: { publish: async () => undefined, subscribe: () => ({ unsubscribe: noop }) },
    extensions: { callAction: async () => undefined, listActions: () => [], getStatus: () => ({ enabled: true, healthy: true }) },
  };
}

async function smokeBackendActions(id, manifest, backendModule) {
  for (const action of manifest.backend?.actions ?? []) {
    const handlerName = action.handler ?? action.id;
    const handler = backendModule[handlerName];
    if (typeof handler !== 'function') {
      throw new Error(`missing backend action handler export "${handlerName}"`);
    }
    const input = safeActionInputFor(id, manifest, action.id);
    if (input === undefined) continue;
    const result = await handler(input, createSmokeContext(id));
    if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
      throw new Error(`action "${action.id}" smoke call returned failure: ${result.error ?? JSON.stringify(result)}`);
    }
  }
}

await init;

const failures = [];
const rows = [];

for (const extensionDir of listPackagedExtensionDirs()) {
  const manifestPath = join(extensionDir, 'extension.json');
  const manifest = readJson(manifestPath);
  const id = manifest.id ?? extensionDir;
  const backendPath = backendEntryPath(extensionDir, manifest);
  const frontendPath = frontendEntryPath(extensionDir, manifest);
  const buildManifestPath = join(extensionDir, 'dist', 'build-manifest.json');
  const row = { id, backend: 'none', frontend: 'none', actions: manifest.backend?.actions?.length ?? 0, manifest: 'missing' };
  const hasBuildManifest = existsSync(buildManifestPath);

  if (hasBuildManifest) row.manifest = 'ok';

  if (backendPath) {
    if (!existsSync(backendPath)) {
      failures.push(`${id}: missing packaged backend entry ${backendPath}`);
      row.backend = 'missing';
    } else {
      const backendSize = statSync(backendPath).size;
      const backendLimit = backendBundleByteLimit(id);
      const forbiddenBundledPaths = collectForbiddenBundledPaths(backendPath);
      if (backendSize > backendLimit) failures.push(`${id}: backend bundle is ${backendSize} bytes, above limit ${backendLimit} bytes`);
      if (forbiddenBundledPaths.length > 0)
        failures.push(`${id}: backend bundle contains forbidden bundled runtime paths: ${forbiddenBundledPaths.join(', ')}`);
      const bareImports = collectBareImports(backendPath);
      const nonPortableImports = collectNonPortableImports(backendPath);
      const forbidden = bareImports.filter(isForbiddenBackendImport);
      const unexpected = bareImports.filter((specifier) => !isAllowedBackendImport(specifier));
      if (forbidden.length > 0) failures.push(`${id}: backend bundle contains forbidden packaged-runtime imports: ${forbidden.join(', ')}`);
      if (unexpected.length > 0) failures.push(`${id}: backend bundle contains unexpected bare imports: ${unexpected.join(', ')}`);
      if (nonPortableImports.length > 0)
        failures.push(`${id}: backend bundle contains non-portable absolute imports: ${nonPortableImports.join(', ')}`);
      try {
        const backendModule = await import(pathToFileURL(backendPath).href);
        await smokeBackendActions(id, manifest, backendModule);
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
      const nonPortableImports = collectNonPortableImports(frontendPath);
      const unexpected = bareImports.filter((specifier) => !isAllowedFrontendImport(specifier));
      if (unexpected.length > 0) failures.push(`${id}: frontend bundle contains unexpected bare imports: ${unexpected.join(', ')}`);
      if (nonPortableImports.length > 0)
        failures.push(`${id}: frontend bundle contains non-portable absolute imports: ${nonPortableImports.join(', ')}`);
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

console.log(`Packaged extension check passed for ${rows.length} extensions.`);
