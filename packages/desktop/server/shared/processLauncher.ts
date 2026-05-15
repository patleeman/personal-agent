import { type ChildProcess, execFile, spawn, type SpawnOptions } from 'node:child_process';
import { promisify } from 'node:util';

import { resolveChildProcessEnv } from '@personal-agent/core';

const execFileAsync = promisify(execFile);

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

export async function execFileProcess(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
}): Promise<{ launch: ProcessLaunchResult; stdout: string; stderr: string }> {
  const launch = resolveProcessLaunch({ command: input.command, args: input.args, cwd: input.cwd, env: input.env });
  const result = await execFileAsync(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    timeout: input.timeoutMs,
    maxBuffer: input.maxBuffer,
    shell: launch.shell,
  });
  return { launch, stdout: result.stdout, stderr: result.stderr };
}
