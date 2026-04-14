import { spawn } from 'child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  type WriteStream,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import {
  bootstrapStateOrThrow,
  preparePiAgentDir,
  resolveChildProcessEnv,
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

export interface TaskRunThreadBinding {
  threadMode?: 'dedicated' | 'existing' | 'none';
  threadSessionFile?: string;
  threadConversationId?: string;
}

export type RunnableTaskDefinition = ParsedTaskDefinition & TaskRunThreadBinding;

const GRACEFUL_SHUTDOWN_MS = 5000;
const MAX_CAPTURED_OUTPUT_CHARS = 16_000;

export interface TaskRunRequest {
  task: RunnableTaskDefinition;
  attempt: number;
  runsRoot: string;
  signal?: AbortSignal;
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

interface PreparedTaskRunCommand {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
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

function toTaskRunArgs(task: RunnableTaskDefinition, resolvedProfile: ResolvedResourceProfile): string[] {
  const args = [...buildPiResourceArgs(resolvedProfile)];

  if (task.threadMode && task.threadMode !== 'none' && task.threadSessionFile) {
    args.push('--session', task.threadSessionFile);
  }

  if (task.modelRef) {
    args.push('--model', task.modelRef);
  }

  if (task.thinkingLevel) {
    args.push('--thinking', task.thinkingLevel);
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

function normalizeThreadSessionTranscript(sessionFile: string | undefined): void {
  if (!sessionFile || !existsSync(sessionFile)) {
    return;
  }

  let raw = '';
  try {
    raw = readFileSync(sessionFile, 'utf-8');
  } catch {
    return;
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 3) {
    return;
  }

  const prefix = [lines[0]];
  let cursor = 1;
  while (cursor < lines.length) {
    try {
      const parsed = JSON.parse(lines[cursor] ?? '{}') as { type?: string };
      if (parsed.type !== 'session_info') {
        break;
      }
      prefix.push(lines[cursor] as string);
      cursor += 1;
    } catch {
      return;
    }
  }

  if (cursor + prefix.length > lines.length) {
    return;
  }

  const duplicatedPrefix = prefix.every((line, index) => lines[cursor + index] === line);
  if (!duplicatedPrefix) {
    return;
  }

  const normalized = [...prefix, ...lines.slice(cursor + prefix.length)];
  writeFileSync(sessionFile, `${normalized.join('\n')}\n`, 'utf-8');
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

      normalizeThreadSessionTranscript(context.request.task.threadSessionFile);

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

export async function runTaskInIsolatedPi(request: TaskRunRequest): Promise<TaskRunResult> {
  const startedAt = new Date().toISOString();
  const logDir = join(request.runsRoot, sanitizePathSegment(request.task.id));
  const logPath = join(logDir, `${toTimestampKey(startedAt)}-attempt-${request.attempt}.log`);

  mkdirSync(logDir, { recursive: true, mode: 0o700 });

  const stream = createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });

  writeLine(stream, `# task=${request.task.id}`);
  if (request.task.title) {
    writeLine(stream, `# title=${request.task.title}`);
  }
  if (!request.task.filePath.startsWith('/__automations__/')) {
    writeLine(stream, `# file=${request.task.filePath}`);
  }
  writeLine(stream, `# profile=${request.task.profile}`);
  writeLine(stream, `# attempt=${request.attempt}`);
  writeLine(stream, `# startedAt=${startedAt}`);

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
      env: resolveChildProcessEnv(envOverrides),
    };

    const threadLog = request.task.threadMode && request.task.threadMode !== 'none' && request.task.threadSessionFile
      ? ` --session ${request.task.threadSessionFile}`
      : '';
    writeLine(stream, `# command=pi (profile resources)${request.task.modelRef ? ` --model ${request.task.modelRef}` : ''}${request.task.thinkingLevel ? ` --thinking ${request.task.thinkingLevel}` : ''}${threadLog} -p <task prompt>`);
    writeLine(stream, '# mode=subprocess');
    writeLine(stream, '');

    result = await runTaskWithDirectSpawn({
      request,
      startedAt,
      logPath,
      stream,
      prepared,
      captureOutput,
      getCapturedOutput,
    });

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
