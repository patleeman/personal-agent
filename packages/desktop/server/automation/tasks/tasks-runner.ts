import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
import { join } from 'path';

import { resolveCompanionRuntime } from '../../daemon/companion/runtime.js';
import type { CompanionRuntime } from '../../daemon/companion/types.js';
import { loadDaemonConfig } from '../../config.js';
import type { ParsedTaskDefinition } from './tasks-parser.js';

interface TaskRunThreadBinding {
  threadMode?: 'dedicated' | 'existing' | 'none';
  threadSessionFile?: string;
  threadConversationId?: string;
}

export type RunnableTaskDefinition = ParsedTaskDefinition &
  TaskRunThreadBinding & {
    targetType?: 'background-agent' | 'conversation';
    conversationBehavior?: 'steer' | 'followUp';
  };

const MAX_CAPTURED_OUTPUT_CHARS = 16_000;
const COMPLETION_POLL_INTERVAL_MS = 1000;

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

interface CapturedOutputBuffer {
  append(chunk: string): void;
  value(): string | undefined;
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

function createCapturedOutputBuffer(): CapturedOutputBuffer {
  let captured = '';
  let truncated = false;

  return {
    append(chunk: string) {
      if (chunk.length === 0 || captured.length >= MAX_CAPTURED_OUTPUT_CHARS) {
        if (chunk.length > 0) {
          truncated = true;
        }
        return;
      }

      const remaining = MAX_CAPTURED_OUTPUT_CHARS - captured.length;
      if (chunk.length <= remaining) {
        captured += chunk;
        return;
      }

      captured += chunk.slice(0, remaining);
      truncated = true;
    },
    value() {
      const trimmed = captured.trim();
      if (trimmed.length === 0) {
        return undefined;
      }

      return truncated ? `${trimmed}\n\n[output truncated]` : trimmed;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function extractConversationId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return (
    readString(value.conversationId) ??
    (isRecord(value.sessionMeta) ? readString(value.sessionMeta.id) : undefined) ??
    (isRecord(value.bootstrap) ? extractConversationId(value.bootstrap) : undefined) ??
    (isRecord(value.sessionDetail) ? readString(value.sessionDetail.conversationId) : undefined)
  );
}

function extractIsRunning(value: unknown): boolean | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.isRunning === 'boolean') {
    return value.isRunning;
  }

  if (typeof value.isStreaming === 'boolean') {
    return value.isStreaming;
  }

  if (isRecord(value.sessionMeta)) {
    const nested = extractIsRunning(value.sessionMeta);
    if (nested !== undefined) {
      return nested;
    }
  }

  if (isRecord(value.bootstrap)) {
    const nested = extractIsRunning(value.bootstrap);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

function summarizeEvent(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  const type = readString(event.type);
  if (!type) {
    return undefined;
  }

  switch (type) {
    case 'text_delta':
    case 'thinking_delta':
      return readString(event.delta);
    case 'tool_start':
      return `tool_start ${readString(event.toolName) ?? 'tool'}`;
    case 'tool_end': {
      const toolName = readString(event.toolName) ?? 'tool';
      const output = readString(event.output);
      return output ? `tool_end ${toolName}: ${output}` : `tool_end ${toolName}`;
    }
    case 'error':
      return `error: ${readString(event.message) ?? 'Conversation run failed.'}`;
    case 'agent_start':
    case 'agent_end':
    case 'turn_end':
      return type;
    default:
      return undefined;
  }
}

function readEventError(event: unknown): string | undefined {
  return isRecord(event) && event.type === 'error' ? (readString(event.message) ?? 'Conversation run failed.') : undefined;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function resolveTaskConversation(runtime: CompanionRuntime, task: RunnableTaskDefinition): Promise<string> {
  if (task.threadMode && task.threadMode !== 'none' && task.threadSessionFile) {
    const resumed = await runtime.resumeConversation({
      sessionFile: task.threadSessionFile,
      ...(task.cwd ? { cwd: task.cwd } : {}),
    });
    return (
      extractConversationId(resumed) ??
      task.threadConversationId ??
      (() => {
        throw new Error(`Conversation runtime did not return a conversation id for automation @${task.id}.`);
      })()
    );
  }

  if (task.threadConversationId) {
    return task.threadConversationId;
  }

  const created = await runtime.createConversation({
    ...(task.cwd ? { cwd: task.cwd } : {}),
    ...(task.modelRef ? { model: task.modelRef } : {}),
    ...(task.thinkingLevel ? { thinkingLevel: task.thinkingLevel } : {}),
  });
  const conversationId = extractConversationId(created);
  if (!conversationId) {
    throw new Error(`Conversation runtime did not return a conversation id for automation @${task.id}.`);
  }

  return conversationId;
}

async function waitForConversationCompletion(input: {
  runtime: CompanionRuntime;
  conversationId: string;
  task: RunnableTaskDefinition;
  signal?: AbortSignal;
  stream: WriteStream;
  capture: CapturedOutputBuffer;
}): Promise<{ success: boolean; cancelled: boolean; timedOut: boolean; error?: string }> {
  const { runtime, conversationId, task, signal, stream, capture } = input;
  let settled = false;
  let completed = false;
  let errorMessage: string | undefined;
  let unsubscribe: (() => void) | undefined;
  let started = false;
  let promptDispatchStarted = false;

  const finish = (details: { completed?: boolean; error?: string }) => {
    completed = details.completed === true;
    errorMessage = details.error ?? errorMessage;
    settled = true;
  };

  const abortHandler = () => finish({ error: 'Task run cancelled' });
  signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    unsubscribe = await runtime.subscribeConversation(
      {
        conversationId,
        surfaceId: `automation-${task.id}`,
        surfaceType: 'desktop_ui',
        tailBlocks: 20,
      },
      (event) => {
        const summary = summarizeEvent(event);
        if (summary) {
          writeLine(stream, summary);
          capture.append(`${summary}\n`);
        }

        const eventError = readEventError(event);
        if (eventError) {
          finish({ error: eventError });
          return;
        }

        if (isRecord(event) && event.type === 'agent_start' && promptDispatchStarted) {
          started = true;
        }

        if (isRecord(event) && (event.type === 'turn_end' || event.type === 'agent_end') && started) {
          finish({ completed: true });
        }
      },
    );

    promptDispatchStarted = true;
    await runtime.promptConversation({
      conversationId,
      text: task.prompt,
      behavior: task.conversationBehavior ?? 'followUp',
      surfaceId: `automation-${task.id}`,
    });

    const deadline = Date.now() + task.timeoutSeconds * 1000;
    while (!settled) {
      if (signal?.aborted) {
        finish({ error: 'Task run cancelled' });
        break;
      }

      if (Date.now() >= deadline) {
        finish({ error: `Task timed out after ${task.timeoutSeconds}s` });
        break;
      }

      await wait(COMPLETION_POLL_INTERVAL_MS, signal);

      const bootstrap = await runtime.readConversationBootstrap({ conversationId, tailBlocks: 5 }).catch(() => null);
      const running = extractIsRunning(bootstrap);
      if (started && running === false) {
        finish({ completed: true });
      }
    }
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    unsubscribe?.();
  }

  const timedOut = errorMessage === `Task timed out after ${task.timeoutSeconds}s`;
  const cancelled = errorMessage === 'Task run cancelled';
  if (cancelled || timedOut) {
    await runtime.abortConversation({ conversationId }).catch(() => undefined);
  }

  return {
    success: completed && !errorMessage,
    cancelled,
    timedOut,
    ...(errorMessage ? { error: errorMessage } : {}),
  };
}

export async function runTaskInIsolatedPi(request: TaskRunRequest): Promise<TaskRunResult> {
  const startedAt = new Date().toISOString();
  const logDir = join(request.runsRoot, sanitizePathSegment(request.task.id));
  const logPath = join(logDir, `${toTimestampKey(startedAt)}-attempt-${request.attempt}.log`);

  mkdirSync(logDir, { recursive: true, mode: 0o700 });

  const stream = createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });
  const capture = createCapturedOutputBuffer();
  let result: TaskRunResult | undefined;

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
  writeLine(stream, '# mode=conversation-runtime');
  writeLine(stream, '');

  try {
    if (request.signal?.aborted) {
      const endedAt = new Date().toISOString();
      writeLine(stream, '# cancelled before conversation runtime dispatch');
      result = {
        success: false,
        startedAt,
        endedAt,
        exitCode: 1,
        signal: null,
        timedOut: false,
        cancelled: true,
        logPath,
        error: 'Task run cancelled before dispatch',
        outputText: capture.value(),
      };
      return result;
    }

    const runtime = await resolveCompanionRuntime(loadDaemonConfig());
    if (!runtime) {
      throw new Error('Conversation runtime unavailable; scheduled automations require the Personal Agent backend runtime.');
    }

    const conversationId = await resolveTaskConversation(runtime, request.task);
    writeLine(stream, `# conversation=${conversationId}`);

    if (request.task.modelRef || request.task.thinkingLevel) {
      await runtime.updateConversationModelPreferences({
        conversationId,
        ...(request.task.modelRef ? { model: request.task.modelRef } : {}),
        ...(request.task.thinkingLevel ? { thinkingLevel: request.task.thinkingLevel } : {}),
        surfaceId: `automation-${request.task.id}`,
      });
    }

    const outcome = await waitForConversationCompletion({
      runtime,
      conversationId,
      task: request.task,
      signal: request.signal,
      stream,
      capture,
    });

    const endedAt = new Date().toISOString();
    result = {
      success: outcome.success,
      startedAt,
      endedAt,
      exitCode: outcome.success ? 0 : 1,
      signal: null,
      timedOut: outcome.timedOut,
      cancelled: outcome.cancelled,
      logPath,
      ...(outcome.error ? { error: outcome.error } : {}),
      outputText: capture.value(),
    };

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
      outputText: capture.value(),
    };

    return result;
  } finally {
    if (result) {
      writeLine(stream, '');
      writeLine(stream, `# endedAt=${result.endedAt}`);
      writeLine(stream, `# success=${result.success}`);
      if (result.error) {
        writeLine(stream, `# error=${result.error}`);
      }
    }
    await closeStream(stream);
  }
}
