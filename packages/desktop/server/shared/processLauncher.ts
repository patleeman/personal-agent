import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process';

import { resolveChildProcessEnv } from '@personal-agent/core';

export interface ProcessWrapperMetadata {
  id: string;
  label?: string;
}

export interface ProcessLaunchContext {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  shell?: boolean;
  wrappers: ProcessWrapperMetadata[];
}

export interface ProcessLaunchResult {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  shell?: boolean;
  wrappers: ProcessWrapperMetadata[];
}

export type ProcessWrapper = (context: ProcessLaunchContext) => ProcessLaunchResult;

interface RegisteredProcessWrapper extends ProcessWrapperMetadata {
  wrap: ProcessWrapper;
}

const processWrappers = new Map<string, RegisteredProcessWrapper>();

export function registerProcessWrapper(id: string, wrap: ProcessWrapper, options: { label?: string } = {}): void {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error('Process wrapper id is required.');
  }
  processWrappers.set(normalizedId, { id: normalizedId, label: options.label, wrap });
}

export function clearProcessWrappers(): void {
  processWrappers.clear();
}

export function listProcessWrappers(): ProcessWrapperMetadata[] {
  return [...processWrappers.values()].map(({ id, label }) => ({ id, label }));
}

export function resolveProcessLaunch(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
}): ProcessLaunchResult {
  const base: ProcessLaunchContext = {
    command: input.command,
    args: input.args ?? [],
    cwd: input.cwd,
    env: resolveChildProcessEnv({}, input.env ?? process.env),
    shell: input.shell,
    wrappers: [],
  };

  return [...processWrappers.values()].reduce<ProcessLaunchResult>((current, wrapper) => {
    const next = wrapper.wrap(current);
    const alreadyPresent = next.wrappers.some((item) => item.id === wrapper.id);
    return {
      ...next,
      wrappers: alreadyPresent ? next.wrappers : [...next.wrappers, { id: wrapper.id, label: wrapper.label }],
    };
  }, base);
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function formatProcessLaunchShellCommand(launch: Pick<ProcessLaunchResult, 'command' | 'args'>): string {
  return [launch.command, ...launch.args].map(shellQuote).join(' ');
}

export function spawnProcess(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
  options?: Omit<SpawnOptions, 'cwd' | 'env' | 'shell'>;
}): { child: ChildProcess; launch: ProcessLaunchResult } {
  const launch = resolveProcessLaunch(input);
  const child = spawn(launch.command, launch.args, {
    ...(input.options ?? {}),
    cwd: launch.cwd,
    env: launch.env,
    shell: launch.shell,
  });
  return { child, launch };
}

function terminateProcessGroup(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
    setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }, 2_000).unref();
  } catch {
    child.kill('SIGTERM');
  }
}

export async function execFileProcess(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
  signal?: AbortSignal;
}): Promise<{ launch: ProcessLaunchResult; stdout: string; stderr: string }> {
  const launch = resolveProcessLaunch({ command: input.command, args: input.args, cwd: input.cwd, env: input.env });
  const maxBuffer = input.maxBuffer ?? 1024 * 1024;
  return await new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      shell: launch.shell,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      input.signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: Error) => {
      Object.assign(error, { stdout, stderr });
      cleanup();
      reject(error);
    };
    const append = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      if (stream === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
      if (stdout.length + stderr.length > maxBuffer && !settled) {
        settled = true;
        terminateProcessGroup(child);
        fail(new Error(`Command output exceeded maxBuffer of ${maxBuffer} bytes.`));
      }
    };
    function onAbort() {
      if (settled) return;
      aborted = true;
      terminateProcessGroup(child);
    }

    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      fail(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (aborted || input.signal?.aborted) return fail(new Error('Command aborted.'));
      if (timedOut) return fail(new Error(`Command timed out after ${input.timeoutMs}ms.`));
      if (code && code !== 0) return fail(new Error(stderr || `Command failed with exit code ${code}.`));
      if (signal) return fail(new Error(`Command terminated by signal ${signal}.`));
      resolve({ launch, stdout, stderr });
    });

    if (input.signal?.aborted) onAbort();
    else input.signal?.addEventListener('abort', onAbort, { once: true });
    if (input.timeoutMs && input.timeoutMs > 0) {
      timeout = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        terminateProcessGroup(child);
      }, input.timeoutMs);
    }
  });
}
