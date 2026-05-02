import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export interface CliBinaryState {
  available: boolean;
  command: string;
  path?: string;
  version?: string;
  error?: string;
}

export function inspectCliBinary(options: { command: string; cwd?: string; timeoutMs?: number; versionArgs?: string[] }): CliBinaryState {
  const command = options.command.trim();
  if (command.length === 0) {
    return {
      available: false,
      command: '',
      error: 'Command is empty',
    };
  }

  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const versionArgs = options.versionArgs && options.versionArgs.length > 0 ? options.versionArgs : ['--version'];
  const versionResult = spawnSync(command, versionArgs, {
    cwd,
    encoding: 'utf-8',
    timeout: timeoutMs,
  });

  if (versionResult.error || versionResult.status !== 0) {
    return {
      available: false,
      command,
      error:
        versionResult.error?.message ??
        (versionResult.stderr.trim() || versionResult.stdout.trim() || `Command exited with code ${versionResult.status ?? -1}`),
    };
  }

  let resolvedPath: string | undefined;
  if (command.includes('/')) {
    resolvedPath = command;
  } else {
    const whichResult = spawnSync('which', [command], {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
    });
    if (whichResult.status === 0) {
      resolvedPath = whichResult.stdout.trim() || undefined;
    }
  }

  const version = versionResult.stdout.trim() || versionResult.stderr.trim() || undefined;

  return {
    available: true,
    command,
    path: resolvedPath,
    version,
  };
}
