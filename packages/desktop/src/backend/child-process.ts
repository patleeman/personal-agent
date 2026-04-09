import { type ChildProcess, spawn } from 'node:child_process';
import { openSync } from 'node:fs';

export interface ManagedChildProcess {
  child: ChildProcess;
  logPath: string;
}

export function spawnLoggedChild(options: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logPath: string;
}): ManagedChildProcess {
  const logFd = openSync(options.logPath, 'a');
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', logFd, logFd],
  });

  return {
    child,
    logPath: options.logPath,
  };
}

export async function stopManagedChild(
  managed: ManagedChildProcess | undefined,
  timeoutMs = 5_000,
): Promise<void> {
  if (!managed) {
    return;
  }

  const { child } = managed;
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }
      finish();
    }, timeoutMs);

    child.once('exit', () => {
      clearTimeout(timer);
      finish();
    });

    child.kill('SIGTERM');
  });
}
