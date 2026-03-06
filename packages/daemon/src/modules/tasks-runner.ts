import { spawn } from 'child_process';
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  type WriteStream,
} from 'fs';
import { basename, join } from 'path';
import {
  bootstrapStateOrThrow,
  preparePiAgentDir,
  resolveStatePaths,
  validateStatePathsOutsideRepo,
} from '@personal-agent/core';
import {
  buildPiResourceArgs,
  materializeProfileToAgentDir,
  resolveResourceProfile,
  type ResolvedResourceProfile,
} from '@personal-agent/resources';
import type { ParsedTaskDefinition } from './tasks-parser.js';

const GRACEFUL_SHUTDOWN_MS = 5000;
const TMUX_POLL_INTERVAL_MS = 250;
const MAX_CAPTURED_OUTPUT_CHARS = 16_000;
const PA_TMUX_MANAGED_OPTION = '@pa_agent_session';
const PA_TMUX_TASK_OPTION = '@pa_agent_task';
const PA_TMUX_LOG_OPTION = '@pa_agent_log';
const PA_TMUX_COMMAND_OPTION = '@pa_agent_cmd';

export interface TaskRunRequest {
  task: ParsedTaskDefinition;
  attempt: number;
  runsRoot: string;
  signal?: AbortSignal;
  runInTmux?: boolean;
}

export interface TaskRunResult {
  success: boolean;
  startedAt: string;
  endedAt: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  logPath: string;
  error?: string;
  outputText?: string;
}

interface CommandResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface PreparedTaskRunCommand {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  envOverrides: Record<string, string>;
}

interface RunnerExecutionContext {
  request: TaskRunRequest;
  startedAt: string;
  logPath: string;
  stream: WriteStream;
  prepared: PreparedTaskRunCommand;
  captureOutput: (chunk: string) => void;
  getCapturedOutput: () => string | undefined;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'task';
}

function sanitizeTmuxNamePart(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 32);

  return normalized.length > 0 ? normalized : fallback;
}

function formatTmuxSessionTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function createManagedTmuxSessionName(cwd: string, taskId: string, startedAt: string): string {
  const workspace = sanitizeTmuxNamePart(basename(cwd), 'workspace');
  const task = sanitizeTmuxNamePart(taskId, 'task');
  const timestamp = formatTmuxSessionTimestamp(new Date(startedAt));

  return `${workspace}-${task}-${timestamp}`;
}

function toTimestampKey(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    stream.end(() => resolve());
  });
}

function writeLine(stream: WriteStream, message: string): void {
  stream.write(`${message}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toTaskRunArgs(task: ParsedTaskDefinition, resolvedProfile: ResolvedResourceProfile): string[] {
  const args = [...buildPiResourceArgs(resolvedProfile)];

  if (task.modelRef) {
    args.push('--model', task.modelRef);
  }

  args.push('-p', task.prompt);
  return args;
}

function resolvePiCommand(repoRoot: string): { command: string; argsPrefix: string[] } {
  const localPiCli = join(
    repoRoot,
    'node_modules',
    '@mariozechner',
    'pi-coding-agent',
    'dist',
    'cli.js',
  );

  if (existsSync(localPiCli) && statSync(localPiCli).isFile()) {
    return {
      command: process.execPath,
      argsPrefix: [localPiCli],
    };
  }

  return {
    command: 'pi',
    argsPrefix: [],
  };
}

function appendCapturedOutput(current: string, chunk: string): { next: string; truncated: boolean } {
  if (chunk.length === 0) {
    return { next: current, truncated: false };
  }

  const remaining = MAX_CAPTURED_OUTPUT_CHARS - current.length;
  if (remaining <= 0) {
    return { next: current, truncated: true };
  }

  if (chunk.length <= remaining) {
    return { next: current + chunk, truncated: false };
  }

  return {
    next: current + chunk.slice(0, remaining),
    truncated: true,
  };
}

function formatCapturedOutput(raw: string, truncated: boolean): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (!truncated) {
    return trimmed;
  }

  return `${trimmed}\n\n[output truncated]`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatShellCommand(args: string[]): string {
  if (args.length === 0) {
    throw new Error('Command cannot be empty.');
  }

  return args.map((arg) => shellQuote(arg)).join(' ');
}

function normalizeOutput(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function isTmuxMissingSessionOutput(detail: string): boolean {
  const normalized = detail.toLowerCase();

  return normalized.includes("can't find session")
    || normalized.includes('no server running')
    || normalized.includes('failed to connect to server')
    || normalized.includes('error connecting to');
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        exitCode: code ?? 1,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

async function runTmuxCommand(
  args: string[],
  options: {
    allowMissingSession?: boolean;
  } = {},
): Promise<void> {
  try {
    const result = await runCommand('tmux', args);

    if (result.exitCode === 0) {
      return;
    }

    const detail = normalizeOutput(result.stderr || result.stdout) || `exit code ${String(result.exitCode)}`;

    if (options.allowMissingSession && isTmuxMissingSessionOutput(detail)) {
      return;
    }

    throw new Error(`tmux ${args.join(' ')} failed: ${detail}`);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      throw new Error('tmux is not installed or not available on PATH.');
    }

    throw error;
  }
}

async function setTmuxSessionOption(
  sessionName: string,
  option: string,
  value: string,
): Promise<void> {
  await runTmuxCommand(['set-option', '-t', sessionName, option, value], {
    allowMissingSession: true,
  });
}

async function tagManagedTmuxSession(
  sessionName: string,
  metadata: {
    taskId: string;
    logPath: string;
    sourceCommand: string;
  },
): Promise<void> {
  await setTmuxSessionOption(sessionName, PA_TMUX_MANAGED_OPTION, '1');
  await setTmuxSessionOption(sessionName, PA_TMUX_TASK_OPTION, metadata.taskId);
  await setTmuxSessionOption(sessionName, PA_TMUX_LOG_OPTION, metadata.logPath);
  await setTmuxSessionOption(sessionName, PA_TMUX_COMMAND_OPTION, metadata.sourceCommand);
}

function toTmuxShellCommand(input: {
  command: string;
  args: string[];
  envOverrides: Record<string, string>;
  outputPath: string;
  exitCodePath: string;
}): string {
  const envPairs = Object.entries(input.envOverrides)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([key, value]) => `${key}=${shellQuote(value)}`);

  const command = formatShellCommand([input.command, ...input.args]);
  const runCommand = envPairs.length > 0
    ? `env ${envPairs.join(' ')} ${command}`
    : command;

  return `${runCommand} > ${shellQuote(input.outputPath)} 2>&1; printf '%s' $? > ${shellQuote(input.exitCodePath)}`;
}

function appendOutputFileToLogAndCapture(
  outputPath: string,
  stream: WriteStream,
  captureOutput: (chunk: string) => void,
): void {
  if (!existsSync(outputPath)) {
    return;
  }

  const descriptor = openSync(outputPath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);

  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) {
        break;
      }

      const chunk = buffer.subarray(0, bytesRead).toString();
      stream.write(chunk);
      captureOutput(chunk);
    }
  } finally {
    closeSync(descriptor);
  }
}

function readExitCode(exitCodePath: string): number | undefined {
  if (!existsSync(exitCodePath)) {
    return undefined;
  }

  const raw = readFileSync(exitCodePath, 'utf-8').trim();
  if (!/^[-+]?\d+$/.test(raw)) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function runTaskWithDirectSpawn(context: RunnerExecutionContext): Promise<TaskRunResult> {
  return new Promise<TaskRunResult>((resolve) => {
    const child = spawn(context.prepared.command, context.prepared.args, {
      cwd: context.prepared.cwd,
      env: context.prepared.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      writeLine(context.stream, `\n# timeout after ${context.request.task.timeoutSeconds}s`);
      child.kill('SIGTERM');

      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, GRACEFUL_SHUTDOWN_MS);
    }, context.request.task.timeoutSeconds * 1000);

    const abortHandler = () => {
      cancelled = true;
      writeLine(context.stream, '\n# cancelled by daemon shutdown');
      child.kill('SIGTERM');

      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, GRACEFUL_SHUTDOWN_MS);
    };

    context.request.signal?.addEventListener('abort', abortHandler, { once: true });

    const finalize = (next: TaskRunResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) {
        clearTimeout(killTimer);
      }

      context.request.signal?.removeEventListener('abort', abortHandler);
      resolve(next);
    };

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      context.stream.write(text);
      context.captureOutput(text);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      context.stream.write(text);
      context.captureOutput(text);
    });

    child.on('error', (error) => {
      const endedAt = new Date().toISOString();
      finalize({
        success: false,
        startedAt: context.startedAt,
        endedAt,
        exitCode: 1,
        signal: null,
        timedOut,
        cancelled,
        logPath: context.logPath,
        error: error.message,
        outputText: context.getCapturedOutput(),
      });
    });

    child.on('close', (code, closeSignal) => {
      const exitCode = code ?? 1;
      const endedAt = new Date().toISOString();
      const success = exitCode === 0 && !timedOut && !cancelled;

      let error: string | undefined;
      if (timedOut) {
        error = `Task timed out after ${context.request.task.timeoutSeconds}s`;
      } else if (cancelled) {
        error = 'Task run cancelled';
      } else if (exitCode !== 0) {
        error = closeSignal
          ? `pi exited with signal ${closeSignal}`
          : `pi exited with code ${exitCode}`;
      }

      finalize({
        success,
        startedAt: context.startedAt,
        endedAt,
        exitCode,
        signal: closeSignal,
        timedOut,
        cancelled,
        logPath: context.logPath,
        error,
        outputText: context.getCapturedOutput(),
      });
    });
  });
}

async function runTaskInManagedTmux(context: RunnerExecutionContext): Promise<TaskRunResult> {
  const sessionName = createManagedTmuxSessionName(
    context.prepared.cwd,
    context.request.task.id,
    context.startedAt,
  );

  const outputPath = `${context.logPath}.output`;
  const exitCodePath = `${context.logPath}.exit-code`;

  rmSync(outputPath, { force: true });
  rmSync(exitCodePath, { force: true });

  const tmuxShellCommand = toTmuxShellCommand({
    command: context.prepared.command,
    args: context.prepared.args,
    envOverrides: context.prepared.envOverrides,
    outputPath,
    exitCodePath,
  });

  writeLine(context.stream, `# tmuxSession=${sessionName}`);

  await runTmuxCommand([
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-c',
    context.prepared.cwd,
    tmuxShellCommand,
  ]);

  try {
    await tagManagedTmuxSession(sessionName, {
      taskId: context.request.task.id,
      logPath: context.logPath,
      sourceCommand: formatShellCommand([context.prepared.command, ...context.prepared.args]),
    });
  } catch (error) {
    writeLine(context.stream, `# warning=failed to tag tmux session: ${(error as Error).message}`);
  }

  let timedOut = false;
  let cancelled = false;

  const timeoutMs = Math.max(1, Math.floor(context.request.task.timeoutSeconds * 1000));
  const deadline = Date.now() + timeoutMs;

  while (!existsSync(exitCodePath)) {
    if (context.request.signal?.aborted) {
      cancelled = true;
      writeLine(context.stream, '\n# cancelled by daemon shutdown');
      break;
    }

    if (Date.now() >= deadline) {
      timedOut = true;
      writeLine(context.stream, `\n# timeout after ${context.request.task.timeoutSeconds}s`);
      break;
    }

    await delay(TMUX_POLL_INTERVAL_MS);
  }

  if (timedOut || cancelled) {
    await runTmuxCommand(['kill-session', '-t', sessionName], {
      allowMissingSession: true,
    });

    await delay(TMUX_POLL_INTERVAL_MS);
  }

  appendOutputFileToLogAndCapture(outputPath, context.stream, context.captureOutput);

  const recordedExitCode = readExitCode(exitCodePath);
  const exitCode = timedOut || cancelled ? 1 : (recordedExitCode ?? 1);
  const endedAt = new Date().toISOString();
  const success = exitCode === 0 && !timedOut && !cancelled;

  let error: string | undefined;
  if (timedOut) {
    error = `Task timed out after ${context.request.task.timeoutSeconds}s`;
  } else if (cancelled) {
    error = 'Task run cancelled';
  } else if (exitCode !== 0) {
    error = `pi exited with code ${exitCode}`;
  }

  await runTmuxCommand(['kill-session', '-t', sessionName], {
    allowMissingSession: true,
  });

  rmSync(outputPath, { force: true });
  rmSync(exitCodePath, { force: true });

  return {
    success,
    startedAt: context.startedAt,
    endedAt,
    exitCode,
    signal: null,
    timedOut,
    cancelled,
    logPath: context.logPath,
    error,
    outputText: context.getCapturedOutput(),
  };
}

export async function runTaskInIsolatedPi(request: TaskRunRequest): Promise<TaskRunResult> {
  const startedAt = new Date().toISOString();
  const logDir = join(request.runsRoot, sanitizePathSegment(request.task.id));
  const logPath = join(logDir, `${toTimestampKey(startedAt)}-attempt-${request.attempt}.log`);

  mkdirSync(logDir, { recursive: true, mode: 0o700 });

  const stream = createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });

  writeLine(stream, `# task=${request.task.id}`);
  writeLine(stream, `# file=${request.task.filePath}`);
  writeLine(stream, `# profile=${request.task.profile}`);
  writeLine(stream, `# attempt=${request.attempt}`);
  writeLine(stream, `# startedAt=${startedAt}`);
  writeLine(stream, `# runInTmux=${request.runInTmux ? 'true' : 'false'}`);

  let capturedOutput = '';
  let outputTruncated = false;

  const captureOutput = (chunk: string): void => {
    const append = appendCapturedOutput(capturedOutput, chunk);
    capturedOutput = append.next;
    if (append.truncated) {
      outputTruncated = true;
    }
  };

  const getCapturedOutput = (): string | undefined => formatCapturedOutput(capturedOutput, outputTruncated);

  let result: TaskRunResult | undefined;

  try {
    if (request.signal?.aborted) {
      const endedAt = new Date().toISOString();
      writeLine(stream, '# cancelled before spawn');
      result = {
        success: false,
        startedAt,
        endedAt,
        exitCode: 1,
        signal: null,
        timedOut: false,
        cancelled: true,
        logPath,
        error: 'Task run cancelled before spawn',
        outputText: getCapturedOutput(),
      };
      return result;
    }

    const resolvedProfile = resolveResourceProfile(request.task.profile);
    const statePaths = resolveStatePaths();

    validateStatePathsOutsideRepo(statePaths, resolvedProfile.repoRoot);
    await bootstrapStateOrThrow(statePaths);

    const runtime = await preparePiAgentDir({
      statePaths,
      copyLegacyAuth: true,
    });

    materializeProfileToAgentDir(resolvedProfile, runtime.agentDir);

    const args = toTaskRunArgs(request.task, resolvedProfile);
    const piCommand = resolvePiCommand(resolvedProfile.repoRoot);
    const envOverrides: Record<string, string> = {
      PI_CODING_AGENT_DIR: runtime.agentDir,
      PERSONAL_AGENT_ACTIVE_PROFILE: resolvedProfile.name,
      PERSONAL_AGENT_REPO_ROOT: resolvedProfile.repoRoot,
    };

    const prepared: PreparedTaskRunCommand = {
      command: piCommand.command,
      args: [...piCommand.argsPrefix, ...args],
      cwd: request.task.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...envOverrides,
      },
      envOverrides,
    };

    writeLine(stream, `# command=pi (profile resources)${request.task.modelRef ? ` --model ${request.task.modelRef}` : ''} -p <task prompt>`);
    writeLine(stream, `# mode=${request.runInTmux ? 'tmux' : 'subprocess'}`);
    writeLine(stream, '');

    const executionContext: RunnerExecutionContext = {
      request,
      startedAt,
      logPath,
      stream,
      prepared,
      captureOutput,
      getCapturedOutput,
    };

    result = request.runInTmux
      ? await runTaskInManagedTmux(executionContext)
      : await runTaskWithDirectSpawn(executionContext);

    writeLine(stream, '');
    writeLine(stream, `# endedAt=${result.endedAt}`);
    writeLine(stream, `# success=${result.success}`);
    if (result.error) {
      writeLine(stream, `# error=${result.error}`);
    }

    return result;
  } catch (error) {
    const endedAt = new Date().toISOString();
    const message = (error as Error).message;

    writeLine(stream, '');
    writeLine(stream, `# fatal error=${message}`);

    result = {
      success: false,
      startedAt,
      endedAt,
      exitCode: 1,
      signal: null,
      timedOut: false,
      cancelled: false,
      logPath,
      error: message,
      outputText: getCapturedOutput(),
    };

    return result;
  } finally {
    await closeStream(stream);
  }
}
