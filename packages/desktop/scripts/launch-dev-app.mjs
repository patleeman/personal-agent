/* eslint-env node */

import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(currentDir, '..');
const repoRoot = resolve(packageDir, '..', '..');
const desktopMainFile = resolve(packageDir, 'dist', 'main.js');
const electronBinary = resolve(repoRoot, 'node_modules', '.bin', 'electron');

if (!existsSync(desktopMainFile)) {
  console.error(`Missing desktop entrypoint: ${desktopMainFile}`);
  process.exit(1);
}


async function launchMacDevApp() {
  const child = spawn(electronBinary, [desktopMainFile], {
    stdio: 'inherit',
    cwd: packageDir,
    env: process.env,
    detached: true,
  });

  const exitCode = await new Promise((resolveExitCode) => {
    const startupWindowMs = 3_000;
    let settled = false;

    const finish = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveExitCode(code);
    };

    const timer = setTimeout(() => {
      if (child.exitCode !== null) {
        return;
      }

      child.unref();
      finish(0);
    }, startupWindowMs);
    timer.unref();

    child.once('error', (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      finish(1);
    });

    child.once('exit', (code, signal) => {
      if (signal) {
        console.error(`Desktop app exited during startup (signal ${signal}).`);
      }
      finish(typeof code === 'number' ? code : 1);
    });
  });

  process.exit(exitCode);
}

if (process.platform === 'darwin') {
  await launchMacDevApp();
}

const result = spawnSync(electronBinary, [desktopMainFile], {
  stdio: 'inherit',
  cwd: packageDir,
  env: process.env,
});

process.exit(result.status ?? 1);
