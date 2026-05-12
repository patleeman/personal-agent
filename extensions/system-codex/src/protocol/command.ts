import { type ChildProcess, spawn } from 'node:child_process';

import type { MethodHandler } from '../server.js';

function parseCommand(command: unknown): { executable: string; args: string[] } | null {
  if (typeof command === 'string' && command.trim()) return { executable: 'sh', args: ['-c', command] };
  if (!Array.isArray(command) || command.length === 0) return null;
  const [executable, ...args] = command;
  if (typeof executable !== 'string' || !executable) return null;
  return { executable, args: args.map(String) };
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// Track active command sessions for interactive terminal support
const activeSessions = new Map<
  string,
  {
    process: ChildProcess;
    processId: string;
  }
>();

export const command = {
  /**
   * `command/exec` — run a command and stream output via notifications.
   */
  exec: (async (params, _ctx, _conn, notify) => {
    const p = params as Record<string, unknown> | undefined;
    const command = parseCommand(p?.command);
    const cwd = (p?.cwd as string | undefined) ?? process.cwd();
    const timeout = p?.disableTimeout === true ? 0 : numberParam(p?.timeoutMs ?? p?.timeout, 30000);
    if (!command) throw new Error('command is required');

    const child = spawn(command.executable, command.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
    const processId = (p?.processId as string | undefined) ?? `exec-${Date.now()}`;
    activeSessions.set(processId, { process: child, processId });

    return new Promise((resolve, reject) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const timer = timeout > 0 ? setTimeout(() => child.kill('SIGTERM'), timeout) : null;

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout.push(chunk.toString());
        notify('command/exec/outputDelta', {
          processId,
          stream: 'stdout',
          dataBase64: Buffer.from(chunk.toString()).toString('base64'),
        });
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr.push(chunk.toString());
        notify('command/exec/outputDelta', {
          processId,
          stream: 'stderr',
          dataBase64: Buffer.from(chunk.toString()).toString('base64'),
        });
      });
      child.on('close', (code, signal) => {
        if (timer) clearTimeout(timer);
        activeSessions.delete(processId);
        resolve({
          processId,
          exitCode: code ?? 0,
          signal: signal?.toString() ?? null,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
        });
      });
      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }) as MethodHandler,

  /**
   * `command/exec/write` — write stdin to a running command session.
   */
  write: (async (params) => {
    const p = params as Record<string, unknown> | undefined;
    const processId = p?.processId as string | undefined;
    const dataBase64 = p?.dataBase64 as string | undefined;
    if (!processId) throw new Error('processId is required');

    const session = activeSessions.get(processId);
    if (!session) throw new Error('Command session not found or already finished.');

    if (dataBase64) {
      session.process.stdin?.write(Buffer.from(dataBase64, 'base64'));
    } else {
      // Close stdin
      session.process.stdin?.end();
    }

    return {};
  }) as MethodHandler,

  /**
   * `command/exec/resize` — resize the PTY of a running command session.
   */
  resize: (async (params) => {
    const p = params as Record<string, unknown> | undefined;
    const processId = p?.processId as string | undefined;
    if (!processId) throw new Error('processId is required');

    // PTY resize is not critical for non-interactive sessions; just acknowledge
    return {};
  }) as MethodHandler,

  /**
   * `command/exec/terminate` — terminate a running command session.
   */
  terminate: (async (params) => {
    const p = params as Record<string, unknown> | undefined;
    const processId = p?.processId as string | undefined;
    if (!processId) throw new Error('processId is required');

    const session = activeSessions.get(processId);
    if (session) {
      session.process.kill('SIGTERM');
      activeSessions.delete(processId);
    }

    return {};
  }) as MethodHandler,
};
