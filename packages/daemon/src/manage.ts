import { existsSync, openSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { resolveChildProcessEnv } from '@personal-agent/core';
import { fileURLToPath } from 'url';
import { loadDaemonConfig } from './config.js';
import { stopDaemon, pingDaemon, getDaemonStatus } from './client.js';
import { ensureDaemonDirectories, resolveDaemonPaths } from './paths.js';

function assertDetachedDaemonLifecycleAvailable(): void {
  if (process.env.PERSONAL_AGENT_DESKTOP_RUNTIME === '1') {
    throw new Error('Daemon lifecycle is managed by the desktop app. Restart Personal Agent instead.');
  }
}

function resolveDaemonEntryFile(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  const localCandidate = resolve(currentDir, 'index.js');
  if (existsSync(localCandidate)) {
    return localCandidate;
  }

  const workspaceCandidate = resolve(process.cwd(), 'packages', 'daemon', 'dist', 'index.js');
  if (existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }

  throw new Error('Could not locate daemon entrypoint (build packages/daemon first)');
}

export async function startDaemonDetached(): Promise<void> {
  assertDetachedDaemonLifecycleAvailable();
  const config = loadDaemonConfig();
  const paths = resolveDaemonPaths(config.ipc.socketPath);

  ensureDaemonDirectories(paths);

  if (await pingDaemon(config)) {
    return;
  }

  const entryFile = resolveDaemonEntryFile();
  const logFd = openSync(paths.logFile, 'a');

  const child = spawn(process.execPath, [entryFile, '--foreground'], {
    detached: true,
    env: resolveChildProcessEnv(),
    stdio: ['ignore', logFd, logFd],
  });

  child.unref();
}

export async function stopDaemonGracefully(): Promise<void> {
  assertDetachedDaemonLifecycleAvailable();
  const config = loadDaemonConfig();

  if (!(await pingDaemon(config))) {
    return;
  }

  await stopDaemon(config);
}

export async function readDaemonPid(): Promise<number | undefined> {
  const config = loadDaemonConfig();
  const paths = resolveDaemonPaths(config.ipc.socketPath);

  if (!existsSync(paths.pidFile)) {
    return undefined;
  }

  const value = readFileSync(paths.pidFile, 'utf-8').trim();
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export async function daemonStatusJson(): Promise<string> {
  const config = loadDaemonConfig();
  const running = await pingDaemon(config);

  if (!running) {
    return JSON.stringify({ running: false }, null, 2);
  }

  const status = await getDaemonStatus(config);
  return JSON.stringify(status, null, 2);
}
