#!/usr/bin/env node
/* eslint-env node */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { init, parse } from 'es-module-lexer';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkPackagePath = join(repoRoot, 'packages/extensions/package.json');
const sdkBackendRoot = join(repoRoot, 'packages/extensions/src/backend');
const hostBackendApiRoot = join(repoRoot, 'packages/desktop/server/extensions/backendApi');
const buildScriptPath = join(repoRoot, 'scripts/extension-build.mjs');

const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const alwaysAllowedStaticImports = new Set(['@personal-agent/core']);
const forbiddenStaticImportPrefixes = [
  '@personal-agent/daemon',
  '@earendil-works/pi-coding-agent',
  '@sinclair/typebox',
  'jsdom',
  '../extensionBackend.js',
  '../runtimeAgentHooks.js',
  '../extensionRegistry.js',
  '../extensionLifecycle.js',
  '../extensionDoctor.js',
  '../../conversations/',
  '../../routes/',
  '../../automation/',
  '../../gateways/',
  '../../shared/',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sdkBackendSubpaths() {
  const packageJson = readJson(sdkPackagePath);
  return Object.keys(packageJson.exports ?? {})
    .filter((subpath) => subpath.startsWith('./backend/'))
    .map((subpath) => subpath.slice('./backend/'.length))
    .sort();
}

function hostBackendApiModules() {
  return readdirSync(hostBackendApiRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        entry.name !== 'index.ts' &&
        entry.name !== 'daemonBridge.ts' &&
        entry.name !== 'serverModuleResolver.ts',
    )
    .map((entry) => basename(entry.name, extname(entry.name)))
    .sort();
}

function collectImportSpecifiers(filePath, { staticOnly = false } = {}) {
  const source = readFileSync(filePath, 'utf8');
  const [imports] = parse(source);
  return imports
    .filter((importRecord) => !staticOnly || importRecord.d === -1)
    .map((importRecord) => importRecord.n)
    .filter(Boolean)
    .sort();
}

function isForbiddenStaticImport(specifier) {
  if (nodeBuiltins.has(specifier) || specifier.startsWith('node:')) return false;
  if (alwaysAllowedStaticImports.has(specifier)) return false;
  return forbiddenStaticImportPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(prefix));
}

function assert(condition, failures, message) {
  if (!condition) failures.push(message);
}

await init;

const failures = [];
const sdkSubpaths = sdkBackendSubpaths();
const hostModules = hostBackendApiModules();
const sdkSubpathSet = new Set(sdkSubpaths);
const hostModuleSet = new Set(hostModules);

for (const subpath of sdkSubpaths) {
  assert(
    existsSync(join(sdkBackendRoot, `${subpath}.ts`)),
    failures,
    `SDK backend export ./backend/${subpath} has no packages/extensions/src/backend/${subpath}.ts stub`,
  );
  assert(
    hostModuleSet.has(subpath),
    failures,
    `SDK backend export ./backend/${subpath} has no host backendApi/${subpath}.ts implementation`,
  );
}

for (const moduleName of hostModules) {
  assert(
    sdkSubpathSet.has(moduleName),
    failures,
    `host backendApi/${moduleName}.ts is not exported from @personal-agent/extensions ./backend/${moduleName}`,
  );
}

for (const fileName of readdirSync(hostBackendApiRoot)) {
  if (!fileName.endsWith('.ts')) continue;
  const filePath = join(hostBackendApiRoot, fileName);
  const forbidden = collectImportSpecifiers(filePath, { staticOnly: true }).filter(isForbiddenStaticImport);
  assert(
    forbidden.length === 0,
    failures,
    `backendApi/${fileName} statically imports heavy/runtime modules (${forbidden.join(', ')}); route them through a narrow lazy host seam instead`,
  );
}

const buildScript = readFileSync(buildScriptPath, 'utf8');
assert(
  buildScript.includes('/^@personal-agent\\/extensions\\/backend\\/(.+)$/'),
  failures,
  'extension-build.mjs does not resolve @personal-agent/extensions/backend/* subpaths explicitly',
);
assert(
  buildScript.includes('packages/desktop/server/extensions/backendApi/${args.path.split'),
  failures,
  'extension-build.mjs backend subpath resolver no longer points at host backendApi modules',
);

for (const moduleName of hostModules) {
  const size = statSync(join(hostBackendApiRoot, `${moduleName}.ts`)).size;
  assert(
    size < 64 * 1024,
    failures,
    `backendApi/${moduleName}.ts is ${size} bytes; backend API seams should stay narrow, split or lazy-load implementation code`,
  );
}

if (failures.length > 0) {
  console.error('\nExtension backend API check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Extension backend API check passed (${sdkSubpaths.length} public subpaths, ${hostModules.length} host modules).`);
