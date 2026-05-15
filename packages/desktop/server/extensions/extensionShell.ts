import { execFileProcess } from '../shared/processLauncher.js';

export function createExtensionShellCapability() {
  return {
    async exec(input: {
      command: string;
      args?: string[];
      cwd?: string;
      timeoutMs?: number;
      maxBuffer?: number;
      env?: Record<string, string>;
      signal?: AbortSignal;
    }): Promise<{
      command: string;
      args: string[];
      cwd?: string;
      stdout: string;
      stderr: string;
      executionWrappers: Array<{ id: string; label?: string }>;
    }> {
      const args = input.args ?? [];
      const result = await execFileProcess({
        command: input.command,
        args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? 30_000,
        maxBuffer: input.maxBuffer ?? 1024 * 1024,
        env: input.env ? { ...process.env, ...input.env } : process.env,
        signal: input.signal,
      });
      return {
        command: input.command,
        args,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        stdout: result.stdout,
        stderr: result.stderr,
        executionWrappers: result.launch.wrappers,
      };
    },
  };
}

export function createExtensionGitCapability() {
  const shell = createExtensionShellCapability();
  return {
    async status(input: { cwd: string }): Promise<{ porcelain: string }> {
      const result = await shell.exec({ command: 'git', args: ['status', '--porcelain=v1', '--branch'], cwd: input.cwd });
      return { porcelain: result.stdout };
    },
    async diff(input: { cwd: string; path?: string; staged?: boolean }): Promise<{ diff: string }> {
      const args = ['diff'];
      if (input.staged) args.push('--staged');
      if (input.path) args.push('--', input.path);
      const result = await shell.exec({ command: 'git', args, cwd: input.cwd, maxBuffer: 8 * 1024 * 1024 });
      return { diff: result.stdout };
    },
    async log(input: { cwd: string; maxCount?: number }): Promise<{ log: string }> {
      const result = await shell.exec({
        command: 'git',
        args: ['log', `--max-count=${input.maxCount ?? 20}`, '--oneline', '--decorate'],
        cwd: input.cwd,
      });
      return { log: result.stdout };
    },
  };
}
