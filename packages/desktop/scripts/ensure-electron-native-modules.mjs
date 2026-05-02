/* eslint-env node */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(currentDir, '..');
const repoRoot = resolve(packageDir, '..', '..');
const electronVersionFile = resolve(repoRoot, 'node_modules', 'electron', 'dist', 'version');
const betterSqlitePackagePath = resolve(repoRoot, 'node_modules', 'better-sqlite3', 'package.json');
const nativeModulesDir = resolve(repoRoot, 'dist', 'dev-desktop', 'native-modules');
const nativeModulesPackagePath = resolve(nativeModulesDir, 'package.json');
const nativeBetterSqliteBinary = resolve(nativeModulesDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const stampPath = resolve(nativeModulesDir, 'stamp.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function readElectronVersion() {
  return readFileSync(electronVersionFile, 'utf-8').trim();
}

function readBetterSqliteVersion() {
  const pkg = readJson(betterSqlitePackagePath);
  if (typeof pkg.version !== 'string' || pkg.version.trim().length === 0) {
    throw new Error(`Invalid better-sqlite3 package version at ${betterSqlitePackagePath}`);
  }

  return pkg.version.trim();
}

function readExistingStamp(path) {
  if (!existsSync(path)) {
    return null;
  }

  try {
    return readJson(path);
  } catch {
    return null;
  }
}

function createStamp() {
  return {
    layoutVersion: 1,
    electronVersion: readElectronVersion(),
    betterSqlite3Version: readBetterSqliteVersion(),
    platform: process.platform,
    arch: process.arch,
    sourcePackageMtimeMs: statSync(betterSqlitePackagePath).mtimeMs,
  };
}

function writeNativeModulesPackageJson() {
  const packageJson = {
    name: 'personal-agent-electron-native',
    private: true,
    description: 'Electron-native development modules for Personal Agent desktop.',
    dependencies: {
      'better-sqlite3': readBetterSqliteVersion(),
    },
  };

  writeFileSync(nativeModulesPackagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

export function readElectronNativeModulesDir() {
  return nativeModulesDir;
}

export function ensureElectronNativeModules() {
  if (!existsSync(electronVersionFile)) {
    throw new Error(`Missing Electron version file: ${electronVersionFile}`);
  }

  if (!existsSync(betterSqlitePackagePath)) {
    throw new Error(`Missing better-sqlite3 package metadata: ${betterSqlitePackagePath}`);
  }

  const desiredStamp = createStamp();
  const existingStamp = readExistingStamp(stampPath);
  if (existsSync(nativeBetterSqliteBinary) && JSON.stringify(existingStamp) === JSON.stringify(desiredStamp)) {
    return nativeModulesDir;
  }

  rmSync(nativeModulesDir, { force: true, recursive: true });
  mkdirSync(nativeModulesDir, { recursive: true });
  writeNativeModulesPackageJson();

  runChecked(
    'npm',
    [
      'install',
      '--prefix',
      nativeModulesDir,
      '--workspaces=false',
      '--no-package-lock',
      '--ignore-scripts=false',
      '--build-from-source',
      '--runtime=electron',
      `--target=${desiredStamp.electronVersion}`,
      '--dist-url=https://electronjs.org/headers',
    ],
    {
      env: process.env,
    },
  );

  if (!existsSync(nativeBetterSqliteBinary)) {
    throw new Error(`Electron-native better-sqlite3 binary was not produced at ${nativeBetterSqliteBinary}`);
  }

  writeFileSync(stampPath, `${JSON.stringify(desiredStamp, null, 2)}\n`);
  return nativeModulesDir;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const outputDir = ensureElectronNativeModules();
  console.log(outputDir);
}
