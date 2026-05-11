import { type ChildProcess, spawn } from 'node:child_process';

import type { MethodHandler } from '../server.js';

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
    const cmd = p?.command as string | undefined;
    const cwd = (p?.cwd as string) ?? process.cwd();
    const timeout = (p?.timeout as number) ?? 30000;
    if (!cmd) throw new Error('command is required');

    const child = spawn('sh', ['-c', cmd], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const processId = `exec-${Date.now()}`;
    activeSessions.set(processId, { process: child, processId });

    return new Promise((resolve, reject) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const timer = setTimeout(() => child.kill('SIGTERM'), timeout);

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
        clearTimeout(timer);
        activeSessions.delete(processId);
        resolve({
          processId,
          exitCode: code,
          signal: signal?.toString() ?? null,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
        });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
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
