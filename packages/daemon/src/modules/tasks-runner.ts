import { spawn } from 'child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
import { join } from 'path';
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

export interface TaskRunRequest {
  task: ParsedTaskDefinition;
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

function toTaskRunArgs(task: ParsedTaskDefinition, resolvedProfile: ResolvedResourceProfile): string[] {
  const args = [...buildPiResourceArgs(resolvedProfile)];

  if (task.modelRef) {
    args.push('--model', task.modelRef);
  }

  args.push('-p', task.prompt);
  return args;
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

    writeLine(stream, `# command=pi (profile resources)${request.task.modelRef ? ` --model ${request.task.modelRef}` : ''} -p <task prompt>`);
    writeLine(stream, '');

    result = await new Promise<TaskRunResult>((resolve) => {
      const child = spawn('pi', args, {
        cwd: request.task.cwd ?? process.cwd(),
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: runtime.agentDir,
          PERSONAL_AGENT_ACTIVE_PROFILE: resolvedProfile.name,
          PERSONAL_AGENT_REPO_ROOT: resolvedProfile.repoRoot,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let killTimer: NodeJS.Timeout | undefined;

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        writeLine(stream, `\n# timeout after ${request.task.timeoutSeconds}s`);
        child.kill('SIGTERM');

        killTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, GRACEFUL_SHUTDOWN_MS);
      }, request.task.timeoutSeconds * 1000);

      const abortHandler = () => {
        cancelled = true;
        writeLine(stream, '\n# cancelled by daemon shutdown');
        child.kill('SIGTERM');

        killTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, GRACEFUL_SHUTDOWN_MS);
      };

      request.signal?.addEventListener('abort', abortHandler, { once: true });

      const finalize = (next: TaskRunResult) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutTimer);
        if (killTimer) {
          clearTimeout(killTimer);
        }

        request.signal?.removeEventListener('abort', abortHandler);
        resolve(next);
      };

      child.stdout.on('data', (chunk: Buffer | string) => {
        stream.write(chunk.toString());
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stream.write(chunk.toString());
      });

      child.on('error', (error) => {
        const endedAt = new Date().toISOString();
        finalize({
          success: false,
          startedAt,
          endedAt,
          exitCode: 1,
          signal: null,
          timedOut,
          cancelled,
          logPath,
          error: error.message,
        });
      });

      child.on('close', (code, closeSignal) => {
        const exitCode = code ?? 1;
        const endedAt = new Date().toISOString();
        const success = exitCode === 0 && !timedOut && !cancelled;

        let error: string | undefined;
        if (timedOut) {
          error = `Task timed out after ${request.task.timeoutSeconds}s`;
        } else if (cancelled) {
          error = 'Task run cancelled';
        } else if (exitCode !== 0) {
          error = closeSignal
            ? `pi exited with signal ${closeSignal}`
            : `pi exited with code ${exitCode}`;
        }

        finalize({
          success,
          startedAt,
          endedAt,
          exitCode,
          signal: closeSignal,
          timedOut,
          cancelled,
          logPath,
          error,
        });
      });
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
    };

    return result;
  } finally {
    await closeStream(stream);
  }
}
