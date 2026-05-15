import { spawnProcess, terminateProcessGroup } from '../../shared/processLauncher.js';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const GRACEFUL_SHUTDOWN_MS = 5000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const MAX_COMMAND_TIMEOUT_MS = 10 * 60_000;

export function normalizeCommandTimeoutMs(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? Math.min(MAX_COMMAND_TIMEOUT_MS, value as number)
    : DEFAULT_COMMAND_TIMEOUT_MS;
}

export async function runCommand(command: string, args: string[], timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  const normalizedTimeoutMs = normalizeCommandTimeoutMs(timeoutMs);
  return new Promise((resolve, reject) => {
    const { child } = spawnProcess({
      command,
      args,
      options: { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
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
      terminateProcessGroup(child);
      // Force kill if process doesn't exit gracefully
      killTimer = setTimeout(() => {
        if (!settled) {
          terminateProcessGroup(child);
        }
      }, GRACEFUL_SHUTDOWN_MS);
      finalize(() => reject(new Error(`${command} timed out after ${normalizedTimeoutMs}ms`)));
    }, normalizedTimeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
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
