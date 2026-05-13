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

// Track active command sessions for protocol compatibility. Commands run through
// ctx.shell so PA can apply execution wrappers; interactive stdin is not supported
// by the host shell capability yet.
const activeSessions = new Set<string>();

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

    const processId = (p?.processId as string | undefined) ?? `exec-${Date.now()}`;
    activeSessions.add(processId);

    try {
      const result = await _ctx.shell.exec({ command: command.executable, args: command.args, cwd, timeoutMs: timeout || undefined });
      if (result.stdout) {
        notify('command/exec/outputDelta', {
          processId,
          stream: 'stdout',
          dataBase64: Buffer.from(result.stdout).toString('base64'),
        });
      }
      if (result.stderr) {
        notify('command/exec/outputDelta', {
          processId,
          stream: 'stderr',
          dataBase64: Buffer.from(result.stderr).toString('base64'),
        });
      }
      return { processId, exitCode: 0, signal: null, stdout: result.stdout, stderr: result.stderr };
    } finally {
      activeSessions.delete(processId);
    }
  }) as MethodHandler,

  /**
   * `command/exec/write` — write stdin to a running command session.
   */
  write: (async (params) => {
    const p = params as Record<string, unknown> | undefined;
    const processId = p?.processId as string | undefined;
    const dataBase64 = p?.dataBase64 as string | undefined;
    if (!processId) throw new Error('processId is required');

    if (!activeSessions.has(processId)) throw new Error('Command session not found or already finished.');
    if (dataBase64) throw new Error('Interactive command stdin is not supported by PA shell execution policy.');
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

    activeSessions.delete(processId);
    return {};
  }) as MethodHandler,
};
