import { spawn } from 'child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const GRACEFUL_SHUTDOWN_MS = 5000;

export async function runCommand(
  command: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finalize = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      fn();
    };

    const timeoutHandle = setTimeout(() => {
      child.kill('SIGTERM');
      // Force kill if process doesn't exit gracefully
      killTimer = setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, GRACEFUL_SHUTDOWN_MS);
      finalize(() => reject(new Error(`${command} timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      finalize(() => reject(error));
    });

    child.on('close', (code) => {
      finalize(() => {
        resolve({
          code: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });
    });
  });
}
