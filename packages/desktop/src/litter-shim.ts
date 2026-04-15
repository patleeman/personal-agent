import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { renderCodexServerShellCommand } from './codex-server-invocation.js';

export interface LitterShimState {
  installed: boolean;
  shimPath: string;
  command: string;
}

function resolveLitterShimPath(): string {
  return join(homedir(), '.litter', 'bin', 'codex');
}

function resolveShimCommand(): string {
  return renderCodexServerShellCommand();
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
    installed: content.includes(command) || content.includes('--codex-app-server') || content.includes(' codex app-server ') || content.includes('"codex" "app-server"'),
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
