import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  applyScheduledTaskThreadBinding,
  cancelDurableRun,
  createStoredAutomation,
  followUpDurableRun,
  getDurableRun,
  getDurableRunLog,
  invalidateAppTopics,
  listDurableRuns,
  parseDeferredResumeDelayMs,
  pingDaemon,
  rerunDurableRun,
  setTaskCallbackBinding,
  startBackgroundRun,
} from '@personal-agent/extensions/backend/runs';
import { recordTelemetryEvent } from '@personal-agent/extensions/backend/telemetry';
import { Type } from '@sinclair/typebox';

const RUN_ACTION_VALUES = ['list', 'get', 'logs', 'start', 'start_agent', 'rerun', 'follow_up', 'cancel'] as const;

type RunAction = (typeof RUN_ACTION_VALUES)[number];

type RunToolExecutionParams = {
  action?: unknown;
  runId?: string;
  taskSlug?: string;
  command?: string;
  prompt?: string;
  model?: string;
  profile?: string;
  cwd?: string;
  tail?: unknown;
  deliverResultToConversation?: boolean;
  defer?: string;
  cron?: string;
  at?: string;
  loop?: boolean;
  loopDelay?: string;
  loopMaxIterations?: unknown;
  allowedTools?: unknown;
};

type RunToolExecutionContext = {
  cwd?: string;
  sessionManager: {
    getSessionId(): string;
    getSessionFile(): string | undefined;
  };
};

const RunToolParams = Type.Object({
  action: Type.Union(RUN_ACTION_VALUES.map((value) => Type.Literal(value))),
  runId: Type.Optional(Type.String({ description: 'Run id for get/logs/rerun/follow_up/cancel actions.' })),
  taskSlug: Type.Optional(Type.String({ description: 'Short durable task slug for start, for example code-review.' })),
  command: Type.Optional(Type.String({ description: 'Shell command to execute for start.' })),
  prompt: Type.Optional(Type.String({ description: 'Agent prompt body for start_agent, or the follow-up prompt for follow_up.' })),
  model: Type.Optional(Type.String({ description: 'Optional full model ref for start_agent, for example openai-codex/gpt-5.4.' })),
  profile: Type.Optional(Type.String({ description: 'Deprecated. Ignored; agent runs use the shared runtime scope.' })),
  cwd: Type.Optional(Type.String({ description: 'Working directory for start. Defaults to the current conversation cwd.' })),
  tail: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, description: 'Number of log lines to include for logs.' })),
  deliverResultToConversation: Type.Optional(
    Type.Boolean({
      description: 'Whether run completion should queue a wakeup back to the current conversation. Runs are detached by default.',
    }),
  ),
  // Trigger options for start_agent
  defer: Type.Optional(Type.String({ description: 'Delay before running, for example 30s, 10m, 2h, 1d. Use with start_agent.' })),
  cron: Type.Optional(Type.String({ description: 'Cron expression for recurring runs, for example "0 9 * * 1-5". Use with start_agent.' })),
  at: Type.Optional(Type.String({ description: 'ISO timestamp to run at. Use with start_agent.' })),
  // Loop options
  loop: Type.Optional(Type.Boolean({ description: 'Enable loop mode - agent schedules its own next iteration.' })),
  loopDelay: Type.Optional(
    Type.String({ description: 'Default delay between loop iterations, for example 1h. Use with start_agent and loop=true.' }),
  ),
  loopMaxIterations: Type.Optional(Type.Number({ description: 'Maximum number of loop iterations. Use with start_agent and loop=true.' })),
  allowedTools: Type.Optional(
    Type.Union(
      [
        Type.String({ description: 'Comma-separated list of tool names to allow, e.g. "web_fetch,exa_search,duckduckgo_search".' }),
        Type.Array(Type.String(), { description: 'Array of tool names to allow.' }),
      ],
      { description: 'When set, only these tool names are exposed to the subagent. All other tools are unavailable.' },
    ),
  ),
});

function readOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = readOptionalString(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function normalizeRunLogTail(value: unknown): number {
  if (value === undefined || value === null) {
    return 120;
  }

  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(1000, value) : 120;
}

function readOptionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function normalizeAllowedTools(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const tools = value.map((t) => String(t).trim()).filter((t) => t.length > 0);
    return tools.length > 0 ? tools : undefined;
  }
  const tools = String(value)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return tools.length > 0 ? tools : undefined;
}

const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|[+-]\d{2}:\d{2})$/;

function hasValidIsoDateParts(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7]) : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millisecond
  );
}

function resolveScheduledAt(input: { defer?: string; at?: string }): string | undefined {
  if (input.defer) {
    const delayMs = parseDeferredResumeDelayMs(input.defer);
    if (!delayMs) {
      throw new Error('Invalid defer value. Use forms like 30s, 10m, 10 minutes, 2h, or 1d.');
    }

    return new Date(Date.now() + delayMs).toISOString();
  }

  if (!input.at) {
    return undefined;
  }

  const atMatch = input.at.match(ISO_TIMESTAMP_PATTERN);
  if (!atMatch || !hasValidIsoDateParts(atMatch)) {
    throw new Error(`Invalid at timestamp: ${input.at}`);
  }

  const atMs = Date.parse(input.at);
  if (!Number.isFinite(atMs)) {
    throw new Error(`Invalid at timestamp: ${input.at}`);
  }

  return new Date(atMs).toISOString();
}

function formatRunList(result: Awaited<ReturnType<typeof listDurableRuns>>): string {
  if (result.runs.length === 0) {
    return 'No durable runs found.';
  }

  return [
    `Durable runs (${result.summary.total}):`,
    ...result.runs.map((run) => {
      const status = run.status?.status ?? 'unknown';
      const source = run.manifest?.source?.type ?? 'unknown';
      return `- ${run.runId} [${status}] ${run.manifest?.kind ?? 'unknown'} · source ${source}`;
    }),
  ].join('\n');
}

function formatRunDetail(result: NonNullable<Awaited<ReturnType<typeof getDurableRun>>>): string {
  const run = result.run;
  const lines = [
    `Run ${run.runId}`,
    `status: ${run.status?.status ?? 'unknown'}`,
    `kind: ${run.manifest?.kind ?? 'unknown'}`,
    `recovery: ${run.recoveryAction}`,
    `log: ${run.paths.outputLogPath}`,
  ];

  if (run.manifest?.source) {
    lines.push(`source: ${run.manifest.source.type}${run.manifest.source.id ? ` (${run.manifest.source.id})` : ''}`);
  }

  if (run.status?.lastError) {
    lines.push(`last error: ${run.status.lastError}`);
  }

  return lines.join('\n');
}

export function createRunAgentExtension(options: {
  getCurrentProfile: () => string;
  repoRoot: string;
  profilesRoot: string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    const legacyRunTool = {
      name: 'run',
      label: 'Run (legacy)',
      description: 'Legacy compatibility tool for durable background commands and subagents. Prefer background_command or subagent.',
      promptSnippet: 'Prefer background_command for shell work and subagent for delegated agent work; use run only for legacy inspection.',
      promptGuidelines: [
        'Prefer background_command for daemon-backed shell commands.',
        'Prefer subagent for detached agent delegation and follow-up.',
        'Use run only when you need the legacy generic list/get/logs/rerun/cancel surface.',
        'Runs are detached by default. Only set deliverResultToConversation=true when the result should flow back to this conversation.',
        'For persistent time-based automations, prefer scheduled_task.',
        'For pure conversation follow-up later, prefer conversation_queue with trigger="after_turn", "delay", or "at" instead.',
      ],
      parameters: RunToolParams,
      async execute(
        _toolCallId: string,
        params: RunToolExecutionParams,
        _signal: unknown,
        _onUpdate: unknown,
        ctx: RunToolExecutionContext,
      ) {
        try {
          switch (params.action as RunAction) {
            case 'list': {
              const result = await listDurableRuns();
              return {
                content: [{ type: 'text' as const, text: formatRunList(result) }],
                details: {
                  action: 'list',
                  runCount: result.runs.length,
                  runIds: result.runs.map((run) => run.runId),
                  runs: result.runs.map((run) => ({
                    runId: run.runId,
                    status: run.status?.status ?? 'unknown',
                    kind: run.manifest?.kind ?? 'unknown',
                    source: run.manifest?.source?.type ?? 'unknown',
                  })),
                },
              };
            }

            case 'get': {
              const runId = readRequiredString(params.runId, 'runId');
              const result = await getDurableRun(runId);
              if (!result) {
                throw new Error(`Run not found: ${runId}`);
              }

              return {
                content: [{ type: 'text' as const, text: formatRunDetail(result) }],
                details: {
                  action: 'get',
                  runId,
                  status: result.run.status?.status,
                },
              };
            }

            case 'logs': {
              const runId = readRequiredString(params.runId, 'runId');
              const tail = normalizeRunLogTail(params.tail);
              const result = await getDurableRunLog(runId, tail);
              if (!result) {
                throw new Error(`Run not found: ${runId}`);
              }

              return {
                content: [
                  {
                    type: 'text' as const,
                    text: [`Run logs: ${runId}`, `path: ${result.path}`, '', result.log || '(empty log)'].join('\n'),
                  },
                ],
                details: {
                  action: 'logs',
                  runId,
                  tail,
                  path: result.path,
                },
              };
            }

            case 'start': {
              const taskSlug = readRequiredString(params.taskSlug, 'taskSlug');
              const command = readRequiredString(params.command, 'command');
              const cwd = readRequiredString(params.cwd ?? ctx.cwd, 'cwd');
              const conversationId = ctx.sessionManager.getSessionId();
              const conversationFile = ctx.sessionManager.getSessionFile();
              const deliverResultToConversation = params.deliverResultToConversation === true;
              if (deliverResultToConversation && !conversationFile) {
                throw new Error('deliverResultToConversation requires an active persisted conversation.');
              }

              const callbackConversation =
                deliverResultToConversation && conversationFile
                  ? {
                      conversationId,
                      sessionFile: conversationFile,
                      profile: 'shared',
                      repoRoot: options.repoRoot,
                    }
                  : undefined;

              if (!(await pingDaemon())) throw new Error('Daemon is not responding. Ensure the desktop app is running.');
              const result = await startBackgroundRun({
                taskSlug,
                cwd,
                shellCommand: command,
                source: {
                  type: 'tool',
                  id: conversationId,
                  ...(conversationFile ? { filePath: conversationFile } : {}),
                },
                ...(callbackConversation ? { callbackConversation } : {}),
                ...(deliverResultToConversation
                  ? {
                      checkpointPayload: {
                        resumeParentOnExit: true,
                      },
                    }
                  : {}),
              });

              if (!result.accepted) {
                recordTelemetryEvent({
                  source: 'agent',
                  category: 'durable_run',
                  name: 'start_rejected',
                  status: 409,
                  metadata: { taskSlug, cwd, reason: result.reason, action: 'start' },
                });
                throw new Error(result.reason ?? `Could not start durable run for ${taskSlug}.`);
              }

              recordTelemetryEvent({
                source: 'agent',
                category: 'durable_run',
                name: 'start',
                runId: result.runId,
                status: 202,
                metadata: { taskSlug, cwd, logPath: result.logPath, deliverResultToConversation, kind: 'shell' },
              });
              invalidateAppTopics('executions', 'runs');
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Started background command ${result.runId} for ${taskSlug}.`,
                  },
                ],
                details: {
                  action: 'start',
                  runId: result.runId,
                  taskSlug,
                  cwd,
                  logPath: result.logPath,
                  deliverResultToConversation,
                },
              };
            }

            case 'start_agent': {
              const taskSlug = readRequiredString(params.taskSlug, 'taskSlug');
              const prompt = readRequiredString(params.prompt, 'prompt');
              const cwd = readRequiredString(params.cwd ?? ctx.cwd, 'cwd');
              const conversationId = ctx.sessionManager.getSessionId();
              const conversationFile = readOptionalString(ctx.sessionManager.getSessionFile());
              const deliverResultToConversation = params.deliverResultToConversation === true;
              if (deliverResultToConversation && !conversationFile) {
                throw new Error('deliverResultToConversation requires an active persisted conversation.');
              }

              const callbackConversation =
                deliverResultToConversation && conversationFile
                  ? {
                      conversationId,
                      sessionFile: conversationFile,
                      profile: 'shared',
                      repoRoot: options.repoRoot,
                    }
                  : undefined;
              const model = readOptionalString(params.model);
              void readOptionalString(params.profile);
              void options.getCurrentProfile();
              const profile = 'shared';
              const defer = readOptionalString(params.defer);
              const cron = readOptionalString(params.cron);
              const at = readOptionalString(params.at);
              const loop = params.loop === true;
              const loopDelay = readOptionalString(params.loopDelay);
              const loopMaxIterations = readOptionalPositiveInteger(params.loopMaxIterations, 'loopMaxIterations');
              const allowedTools = normalizeAllowedTools(params.allowedTools);
              const scheduleCount = Number(Boolean(defer)) + Number(Boolean(cron)) + Number(Boolean(at));

              if (scheduleCount > 1) {
                throw new Error('Use only one scheduling trigger: defer, cron, or at.');
              }

              if (scheduleCount > 0) {
                if (loop) {
                  throw new Error('loop cannot be combined with defer, cron, or at.');
                }

                const scheduledAt = resolveScheduledAt({ defer, at });
                if (!(await pingDaemon())) throw new Error('Daemon is not responding. Ensure the desktop app is running.');
                const automation = createStoredAutomation({
                  id: taskSlug,
                  title: taskSlug,
                  enabled: true,
                  cron,
                  at: scheduledAt,
                  modelRef: model,
                  cwd,
                  prompt,
                  targetType: 'background-agent',
                });

                const task = applyScheduledTaskThreadBinding(
                  automation.id,
                  conversationFile
                    ? {
                        threadMode: ctx.cwd === cwd ? 'existing' : 'dedicated',
                        threadConversationId: ctx.cwd === cwd ? conversationId : undefined,
                        threadSessionFile: ctx.cwd === cwd ? conversationFile : undefined,
                        cwd,
                      }
                    : {
                        threadMode: 'none',
                        cwd,
                      },
                );

                if (deliverResultToConversation && conversationFile) {
                  setTaskCallbackBinding({
                    profile,
                    taskId: task.id,
                    conversationId,
                    sessionFile: conversationFile,
                    deliverOnSuccess: true,
                    deliverOnFailure: true,
                    notifyOnSuccess: 'passive',
                    notifyOnFailure: 'disruptive',
                    requireAck: false,
                    autoResumeIfOpen: true,
                  });
                }

                invalidateAppTopics('tasks');

                recordTelemetryEvent({
                  source: 'agent',
                  category: 'scheduled_task',
                  name: 'save_from_run_tool',
                  metadata: {
                    automationId: task.id,
                    taskSlug,
                    cwd,
                    model,
                    profile,
                    defer,
                    cron,
                    at: scheduledAt,
                    deliverResultToConversation,
                  },
                });

                const triggerInfo = defer ? `defer ${defer}` : cron ? `cron ${cron}` : `at ${scheduledAt}`;
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `Saved automation @${task.id} for ${taskSlug} [${triggerInfo}].`,
                    },
                  ],
                  details: {
                    action: 'start_agent',
                    scheduled: true,
                    automationId: task.id,
                    taskSlug,
                    cwd,
                    model,
                    profile,
                    ...(defer ? { defer } : {}),
                    ...(cron ? { cron } : {}),
                    ...(scheduledAt ? { at: scheduledAt } : {}),
                    deliverResultToConversation,
                  },
                };
              }

              if (!(await pingDaemon())) throw new Error('Daemon is not responding. Ensure the desktop app is running.');
              const result = await startBackgroundRun({
                taskSlug,
                cwd,
                agent: {
                  prompt,
                  ...(model ? { model } : {}),
                  ...(allowedTools ? { allowedTools } : {}),
                },
                source: {
                  type: 'tool',
                  id: conversationId,
                  ...(conversationFile ? { filePath: conversationFile } : {}),
                },
                ...(callbackConversation ? { callbackConversation } : {}),
                checkpointPayload: {
                  ...(deliverResultToConversation ? { resumeParentOnExit: true } : {}),
                  ...(loop ? { loop: true } : {}),
                  ...(loopDelay ? { loopDelay } : {}),
                  ...(loopMaxIterations !== undefined ? { loopMaxIterations } : {}),
                },
              });

              if (!result.accepted) {
                recordTelemetryEvent({
                  source: 'agent',
                  category: 'durable_run',
                  name: 'start_rejected',
                  status: 409,
                  metadata: { taskSlug, cwd, model, reason: result.reason, action: 'start_agent' },
                });
                throw new Error(result.reason ?? `Could not start durable agent run for ${taskSlug}.`);
              }

              recordTelemetryEvent({
                source: 'agent',
                category: 'durable_run',
                name: 'start_agent',
                runId: result.runId,
                status: 202,
                metadata: { taskSlug, cwd, model, logPath: result.logPath, loop, deliverResultToConversation },
              });
              invalidateAppTopics('executions', 'runs');

              let message = `Started subagent ${result.runId} for ${taskSlug}`;
              if (loop) {
                message += ' [loop]';
              }
              message += '.';

              return {
                content: [
                  {
                    type: 'text' as const,
                    text: message,
                  },
                ],
                details: {
                  action: 'start_agent',
                  runId: result.runId,
                  taskSlug,
                  cwd,
                  model,
                  profile,
                  logPath: result.logPath,
                  ...(loop ? { loop: true } : {}),
                  deliverResultToConversation,
                },
              };
            }

            case 'rerun': {
              const runId = readRequiredString(params.runId, 'runId');
              if (!(await pingDaemon())) throw new Error('Daemon is not responding. Ensure the desktop app is running.');
              const result = await rerunDurableRun(runId);
              if (!result.accepted) {
                recordTelemetryEvent({
                  source: 'agent',
                  category: 'durable_run',
                  name: 'rerun_rejected',
                  runId,
                  status: 409,
                  metadata: { reason: result.reason },
                });
                throw new Error(result.reason ?? `Could not rerun ${runId}.`);
              }

              recordTelemetryEvent({
                source: 'agent',
                category: 'durable_run',
                name: 'rerun',
                runId: result.runId,
                status: 202,
                metadata: { sourceRunId: runId, logPath: result.logPath },
              });
              invalidateAppTopics('executions', 'runs');
              return {
                content: [{ type: 'text' as const, text: `Started rerun ${result.runId} from ${runId}.` }],
                details: {
                  action: 'rerun',
                  runId: result.runId,
                  sourceRunId: runId,
                  logPath: result.logPath,
                },
              };
            }

            case 'follow_up': {
              const runId = readRequiredString(params.runId, 'runId');
              const prompt = params.prompt?.trim() || 'Continue from where you left off.';
              if (!(await pingDaemon())) throw new Error('Daemon is not responding. Ensure the desktop app is running.');
              const result = await followUpDurableRun(runId, prompt);
              if (!result.accepted) {
                recordTelemetryEvent({
                  source: 'agent',
                  category: 'durable_run',
                  name: 'follow_up_rejected',
                  runId,
                  status: 409,
                  metadata: { reason: result.reason },
                });
                throw new Error(result.reason ?? `Could not continue ${runId}.`);
              }

              recordTelemetryEvent({
                source: 'agent',
                category: 'durable_run',
                name: 'follow_up',
                runId: result.runId,
                status: 202,
                metadata: { sourceRunId: runId, promptLength: prompt.length, logPath: result.logPath },
              });
              invalidateAppTopics('executions', 'runs');
              return {
                content: [{ type: 'text' as const, text: `Started follow-up run ${result.runId} from ${runId}.` }],
                details: {
                  action: 'follow_up',
                  runId: result.runId,
                  sourceRunId: runId,
                  prompt,
                  logPath: result.logPath,
                },
              };
            }

            case 'cancel': {
              const runId = readRequiredString(params.runId, 'runId');
              if (!(await pingDaemon())) throw new Error('Daemon is not responding. Ensure the desktop app is running.');
              const result = await cancelDurableRun(runId);
              if (!result.cancelled) {
                recordTelemetryEvent({
                  source: 'agent',
                  category: 'durable_run',
                  name: 'cancel_rejected',
                  runId,
                  status: 409,
                  metadata: { reason: result.reason },
                });
                throw new Error(result.reason ?? `Could not cancel run ${runId}.`);
              }

              recordTelemetryEvent({ source: 'agent', category: 'durable_run', name: 'cancel', runId, status: 200 });
              invalidateAppTopics('executions', 'runs');
              return {
                content: [{ type: 'text' as const, text: `Cancelled background work ${runId}.` }],
                details: {
                  action: 'cancel',
                  runId,
                  cancelled: true,
                },
              };
            }

            default:
              throw new Error(`Unsupported run action: ${String(params.action)}`);
          }
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            details: {
              action: params.action,
            },
          };
        }
      },
    };

    pi.registerTool(legacyRunTool);

    pi.registerTool({
      name: 'background_command',
      label: 'Background Command',
      description: 'Start, inspect, log, rerun, or cancel daemon-backed shell commands.',
      promptSnippet: 'Use background_command for shell commands that should run durably outside the current turn.',
      promptGuidelines: ['Use background_command for durable shell work; use subagent for delegated agent work.'],
      parameters: Type.Object({
        action: Type.Union(['list', 'get', 'logs', 'start', 'rerun', 'cancel'].map((value) => Type.Literal(value))),
        runId: Type.Optional(Type.String({ description: 'Background command id for get/logs/rerun/cancel actions.' })),
        taskSlug: Type.Optional(Type.String({ description: 'Short task slug for start.' })),
        command: Type.Optional(Type.String({ description: 'Shell command to execute for start.' })),
        cwd: Type.Optional(Type.String({ description: 'Working directory for start. Defaults to the current conversation cwd.' })),
        tail: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, description: 'Number of log lines to include for logs.' })),
        deliverResultToConversation: Type.Optional(Type.Boolean({ description: 'Whether completion should wake this conversation.' })),
      }),
      execute(toolCallId: string, params: RunToolExecutionParams, signal: unknown, onUpdate: unknown, ctx: RunToolExecutionContext) {
        return legacyRunTool.execute(toolCallId, params, signal, onUpdate, ctx);
      },
    });

    pi.registerTool({
      name: 'subagent',
      label: 'Subagent',
      description: 'Start, inspect, follow up, rerun, or cancel daemon-backed subagent tasks.',
      promptSnippet: 'Use subagent for delegated agent work that should run durably outside the current turn.',
      promptGuidelines: [
        'Use subagent for durable delegated agent work; use background_command for shell and scheduled_task for recurring automation.',
      ],
      parameters: Type.Object({
        action: Type.Union(['list', 'get', 'logs', 'start', 'rerun', 'follow_up', 'cancel'].map((value) => Type.Literal(value))),
        runId: Type.Optional(Type.String({ description: 'Subagent id for get/logs/rerun/follow_up/cancel actions.' })),
        taskSlug: Type.Optional(Type.String({ description: 'Short task slug for start.' })),
        prompt: Type.Optional(Type.String({ description: 'Agent prompt for start, or follow-up prompt for follow_up.' })),
        model: Type.Optional(Type.String({ description: 'Optional full model ref.' })),
        cwd: Type.Optional(Type.String({ description: 'Working directory for start. Defaults to the current conversation cwd.' })),
        tail: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, description: 'Number of log lines to include for logs.' })),
        deliverResultToConversation: Type.Optional(Type.Boolean({ description: 'Whether completion should wake this conversation.' })),
        loop: Type.Optional(Type.Boolean({ description: 'Enable loop mode - agent schedules its own next iteration.' })),
        loopDelay: Type.Optional(Type.String({ description: 'Default delay between loop iterations, for example 1h.' })),
        loopMaxIterations: Type.Optional(Type.Number({ description: 'Maximum number of loop iterations.' })),
        allowedTools: Type.Optional(
          Type.Union([Type.String({ description: 'Comma-separated allowed tool names.' }), Type.Array(Type.String())]),
        ),
      }),
      execute(toolCallId: string, params: RunToolExecutionParams, signal: unknown, onUpdate: unknown, ctx: RunToolExecutionContext) {
        const action = params.action === 'start' ? 'start_agent' : params.action;
        return legacyRunTool.execute(toolCallId, { ...params, action }, signal, onUpdate, ctx);
      },
    });
  };
}
