/* eslint-env node */

import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
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

async function isTcpPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolveAvailability) => {
    const server = createServer();

    server.once('error', () => {
      resolveAvailability(false);
    });

    server.once('listening', () => {
      server.close(() => resolveAvailability(true));
    });

    server.listen(port, host);
  });
}

async function runLaunchPreflight() {
  const [{ DEFAULT_WEB_UI_PORT }, { pingDaemon }] = await Promise.all([
    import('@personal-agent/core'),
    import('@personal-agent/daemon'),
  ]);

  if (await pingDaemon()) {
    throw new Error('A daemon is already running outside the desktop app. Stop it before launching the desktop shell.');
  }

  if (!(await isTcpPortAvailable(DEFAULT_WEB_UI_PORT))) {
    throw new Error(`Port ${String(DEFAULT_WEB_UI_PORT)} on 127.0.0.1 is already in use.`);
  }
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

try {
  await runLaunchPreflight();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
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
