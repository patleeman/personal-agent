/* eslint-env node */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(currentDir, '..');
const repoRoot = resolve(packageDir, '..', '..');
const desktopMainFile = resolve(packageDir, 'dist', 'main.js');

if (!existsSync(desktopMainFile)) {
  console.error(`Missing desktop entrypoint: ${desktopMainFile}`);
  process.exit(1);
}

if (process.platform !== 'darwin') {
  const electronBinary = resolve(repoRoot, 'node_modules', '.bin', 'electron');
  const result = spawnSync(electronBinary, [desktopMainFile], {
    stdio: 'inherit',
    cwd: packageDir,
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

const electronAppSource = resolve(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app');
const macDistDir = resolve(packageDir, 'dist', 'mac');
const appBundleDir = resolve(macDistDir, 'Personal Agent.app');
const plistPath = resolve(appBundleDir, 'Contents', 'Info.plist');

rmSync(appBundleDir, { recursive: true, force: true });
mkdirSync(macDistDir, { recursive: true });
cpSync(electronAppSource, appBundleDir, { recursive: true });

const plistBuddy = '/usr/libexec/PlistBuddy';
const plistCommands = [
  ['Set', ':CFBundleName', 'Personal Agent'],
  ['Set', ':CFBundleDisplayName', 'Personal Agent'],
  ['Set', ':CFBundleIdentifier', 'com.personal-agent.desktop.dev'],
  ['Set', ':CFBundleIconFile', 'electron.icns'],
];

for (const [action, key, value] of plistCommands) {
  const escapedValue = value.replace(/"/g, '\\"');
  const result = spawnSync(plistBuddy, ['-c', `${action} ${key} "${escapedValue}"`, plistPath], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const result = spawnSync('open', ['-na', appBundleDir, '--args', desktopMainFile], {
  stdio: 'inherit',
  cwd: packageDir,
  env: process.env,
});

process.exit(result.status ?? 0);
