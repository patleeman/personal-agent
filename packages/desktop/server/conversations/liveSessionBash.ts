import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { listProcessWrappers } from '../shared/processLauncher.js';
import type { SseEvent } from './liveSessionEvents.js';

let syntheticBashExecutionCounter = 0;

export interface LiveSessionBashHost {
  sessionId: string;
  session: Pick<AgentSession, 'isBashRunning' | 'executeBash'>;
}

export async function executeLiveSessionBash(
  host: LiveSessionBashHost,
  command: string,
  options: {
    excludeFromContext?: boolean;
    broadcast: (event: SseEvent) => void;
  },
): Promise<{ result: unknown; normalizedCommand: string }> {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    throw new Error('command required');
  }
  if (host.session.isBashRunning) {
    throw new Error('A bash command is already running.');
  }

  const toolCallId = `user-bash-${host.sessionId}-${Date.now()}-${++syntheticBashExecutionCounter}`;
  const startedAtMs = Date.now();
  const eventArgs: Record<string, unknown> = {
    command: normalizedCommand,
    displayMode: 'terminal',
    ...(options.excludeFromContext ? { excludeFromContext: true } : {}),
  };

  options.broadcast({ type: 'tool_start', toolCallId, toolName: 'bash', args: eventArgs });

  let streamedOutput = '';
  try {
    const result = await host.session.executeBash(
      normalizedCommand,
      (chunk) => {
        if (!chunk) {
          return;
        }

        streamedOutput += chunk;
        options.broadcast({ type: 'tool_update', toolCallId, partialResult: chunk });
      },
      { excludeFromContext: options.excludeFromContext === true },
    );

    const bashResult = result as {
      output?: unknown;
      exitCode?: unknown;
      cancelled?: unknown;
      truncated?: unknown;
      fullOutputPath?: unknown;
    };
    const details = {
      displayMode: 'terminal',
      executionWrappers: listProcessWrappers(),
      ...(typeof bashResult.exitCode === 'number' ? { exitCode: bashResult.exitCode } : {}),
      ...(bashResult.cancelled === true ? { cancelled: true } : {}),
      ...(bashResult.truncated === true ? { truncated: true } : {}),
      ...(typeof bashResult.fullOutputPath === 'string' && bashResult.fullOutputPath.trim().length > 0
        ? { fullOutputPath: bashResult.fullOutputPath }
        : {}),
      ...(options.excludeFromContext ? { excludeFromContext: true } : {}),
    };
    const output = typeof bashResult.output === 'string' ? bashResult.output : streamedOutput;

    options.broadcast({
      type: 'tool_end',
      toolCallId,
      toolName: 'bash',
      isError: false,
      durationMs: Date.now() - startedAtMs,
      output,
      ...(Object.keys(details).length > 0 ? { details } : {}),
    });

    return { result, normalizedCommand };
  } catch (error) {
    const details = {
      displayMode: 'terminal',
      executionWrappers: listProcessWrappers(),
      ...(options.excludeFromContext ? { excludeFromContext: true } : {}),
    };
    options.broadcast({
      type: 'tool_end',
      toolCallId,
      toolName: 'bash',
      isError: true,
      durationMs: Date.now() - startedAtMs,
      output: error instanceof Error ? error.message : String(error),
      details,
    });
    throw error;
  }
}
