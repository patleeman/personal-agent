import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import { resolveDesktopRuntimePaths } from './desktop-env.js';

export interface LitterShimState {
  installed: boolean;
  shimPath: string;
  command: string;
}

function resolveLitterShimPath(): string {
  return join(homedir(), '.litter', 'bin', 'codex');
}

function resolveShimCommand(): string {
  const runtime = resolveDesktopRuntimePaths();
  if (app.isPackaged && process.env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE !== '1') {
    return `${JSON.stringify(process.execPath)} --codex-app-server`;
  }

  const cliEntry = resolve(runtime.repoRoot, 'packages', 'cli', 'dist', 'index.js');
  return `${JSON.stringify(runtime.nodeCommand)} ${JSON.stringify(cliEntry)} codex app-server`;
}

function buildShimContent(command: string): string {
  return `#!/bin/sh\nset -eu\nexec ${command} "$@"\n`;
}

export function readLitterShimState(): LitterShimState {
  const shimPath = resolveLitterShimPath();
  const command = resolveShimCommand();
  if (!existsSync(shimPath)) {
    return { installed: false, shimPath, command };
  }

  const content = readFileSync(shimPath, 'utf-8');
  return {
    installed: content.includes('--codex-app-server') || content.includes(' codex app-server '),
    shimPath,
    command,
  };
}

export function installLitterShim(): LitterShimState {
  const shimPath = resolveLitterShimPath();
  const command = resolveShimCommand();
  mkdirSync(join(homedir(), '.litter', 'bin'), { recursive: true, mode: 0o755 });
  writeFileSync(shimPath, buildShimContent(command), { encoding: 'utf-8', mode: 0o755 });
  chmodSync(shimPath, 0o755);
  return { installed: true, shimPath, command };
}

export function uninstallLitterShim(): LitterShimState {
  const shimPath = resolveLitterShimPath();
  rmSync(shimPath, { force: true });
  return {
    installed: false,
    shimPath,
    command: resolveShimCommand(),
  };
}
