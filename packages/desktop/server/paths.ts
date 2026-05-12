import { resolveStatePaths } from '@personal-agent/core';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

import type { DaemonPaths } from './daemon/types.js';

function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

export function resolveDaemonPaths(explicitSocketPath?: string): DaemonPaths {
  const statePaths = resolveStatePaths();
  const socketPath = explicitSocketPath ? resolve(expandHome(explicitSocketPath)) : join(statePaths.root, 'daemon', 'personal-agentd.sock');
  const root = explicitSocketPath ? dirname(socketPath) : join(statePaths.root, 'daemon');

  return {
    stateRoot: statePaths.root,
    root,
    socketPath,
    pidFile: join(root, 'personal-agentd.pid'),
    logDir: join(root, 'logs'),
    logFile: join(root, 'logs', 'daemon.log'),
  };
}

export function ensureDaemonDirectories(paths: DaemonPaths): void {
  mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  mkdirSync(paths.logDir, { recursive: true, mode: 0o700 });
}
