import { resolve } from 'node:path';
import { app } from 'electron';
import { resolveDesktopRuntimePaths } from './desktop-env.js';

export interface CodexServerInvocation {
  command: string;
  args: string[];
  cwd: string;
}

function isPackagedDesktopBundle(): boolean {
  return app.isPackaged && process.env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE !== '1';
}

function quoteForShell(value: string): string {
  return JSON.stringify(value);
}

export function resolveCodexServerInvocation(extraArgs: string[] = []): CodexServerInvocation {
  const runtime = resolveDesktopRuntimePaths();

  if (isPackagedDesktopBundle()) {
    return {
      command: process.execPath,
      args: ['--codex-app-server', ...extraArgs],
      cwd: runtime.repoRoot,
    };
  }

  const cliEntry = resolve(runtime.repoRoot, 'packages', 'cli', 'dist', 'index.js');
  return {
    command: runtime.nodeCommand,
    args: [cliEntry, 'codex', 'app-server', ...extraArgs],
    cwd: runtime.repoRoot,
  };
}

export function renderCodexServerShellCommand(extraArgs: string[] = []): string {
  const invocation = resolveCodexServerInvocation(extraArgs);
  return [invocation.command, ...invocation.args].map(quoteForShell).join(' ');
}
