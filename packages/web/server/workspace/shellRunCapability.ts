import { execSync } from 'node:child_process';

export interface ShellRunCapabilityContext {
  getDefaultWebCwd: () => string;
  resolveRequestedCwd: (cwd: string | null | undefined, defaultCwd?: string) => string | undefined;
}

export interface ShellRunResult {
  output: string;
  exitCode: number;
  cwd: string;
}

export function runShellCommandCapability(
  input: { command?: string; cwd?: string | null | undefined },
  context: ShellRunCapabilityContext,
): ShellRunResult {
  const command = typeof input.command === 'string' ? input.command : '';
  if (command.trim().length === 0) {
    throw new Error('command required');
  }

  const defaultWebCwd = context.getDefaultWebCwd();
  const resolvedRunCwd = context.resolveRequestedCwd(input.cwd, defaultWebCwd) ?? defaultWebCwd;
  let output = '';
  let exitCode = 0;
  try {
    output = execSync(command, {
      cwd: resolvedRunCwd,
      timeout: 30_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const error = err as { stderr?: string; stdout?: string; status?: number; message?: string };
    output = (error.stdout ?? '') + (error.stderr ?? error.message ?? '');
    exitCode = error.status ?? 1;
  }

  return { output, exitCode, cwd: resolvedRunCwd };
}
