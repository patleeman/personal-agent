import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { parseDeferredResumeDelayMs, setTaskCallbackBinding } from '@personal-agent/core';
import { createStoredAutomation, startBackgroundRun } from '@personal-agent/daemon';
import { applyScheduledTaskThreadBinding } from '../automation/scheduledTaskThreads.js';
import { invalidateAppTopics } from '../shared/appEvents.js';
import { ensureDaemonAvailable } from '../automation/daemonToolUtils.js';
import { cancelDurableRun, followUpDurableRun, getDurableRun, getDurableRunLog, listDurableRuns, rerunDurableRun } from '../automation/durableRuns.js';

const RUN_ACTION_VALUES = ['list', 'get', 'logs', 'start', 'start_agent', 'rerun', 'follow_up', 'cancel'] as const;

type RunAction = (typeof RUN_ACTION_VALUES)[number];

const RunToolParams = Type.Object({
  action: Type.Union(RUN_ACTION_VALUES.map((value) => Type.Literal(value))),
  runId: Type.Optional(Type.String({ description: 'Run id for get/logs/rerun/follow_up/cancel actions.' })),
  taskSlug: Type.Optional(Type.String({ description: 'Short durable task slug for start, for example code-review.' })),
  command: Type.Optional(Type.String({ description: 'Shell command to execute for start.' })),
  prompt: Type.Optional(Type.String({ description: 'Agent prompt body for start_agent, or the follow-up prompt for follow_up.' })),
  model: Type.Optional(Type.String({ description: 'Optional full model ref for start_agent, for example openai-codex/gpt-5.4.' })),
  profile: Type.Optional(Type.String({ description: 'Optional profile override for start_agent. Defaults to the active conversation profile.' })),
  cwd: Type.Optional(Type.String({ description: 'Working directory for start. Defaults to the current conversation cwd.' })),
  tail: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, description: 'Number of log lines to include for logs.' })),
  deliverResultToConversation: Type.Optional(Type.Boolean({ description: 'Whether run completion should queue a wakeup back to the current conversation. Runs are detached by default.' })),
  // Trigger options for start_agent
  defer: Type.Optional(Type.String({ description: 'Delay before running, for example 30s, 10m, 2h, 1d. Use with start_agent.' })),
  cron: Type.Optional(Type.String({ description: 'Cron expression for recurring runs, for example "0 9 * * 1-5". Use with start_agent.' })),
  at: Type.Optional(Type.String({ description: 'ISO timestamp to run at. Use with start_agent.' })),
  // Loop options
  loop: Type.Optional(Type.Boolean({ description: 'Enable loop mode - agent schedules its own next iteration.' })),
  loopDelay: Type.Optional(Type.String({ description: 'Default delay between loop iterations, for example 1h. Use with start_agent and loop=true.' })),
  loopMaxIterations: Type.Optional(Type.Number({ description: 'Maximum number of loop iterations. Use with start_agent and loop=true.' })),
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

  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(1000, value)
    : 120;
}

function resolveScheduledAt(input: { defer?: string; at?: string }): string | undefined {
  if (input.defer) {
    const delayMs = parseDeferredResumeDelayMs(input.defer);
    if (!delayMs) {
      throw new Error('Invalid defer value. Use forms like 30s, 10m, 2h, or 1d.');
    }

    return new Date(Date.now() + delayMs).toISOString();
  }

  if (!input.at) {
    return undefined;
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
    pi.registerTool({
      name: 'run',
      label: 'Run',
      description: 'Inspect and manage durable daemon-backed background runs.',
      promptSnippet: 'Use the run tool for daemon-backed background runs that should outlive the current turn.',
      promptGuidelines: [
        'Use this tool for durable background jobs that should keep running outside the current turn.',
        'Prefer one focused run per independent task slug.',
        'Use start for detached shell work, start_agent for detached subagents, rerun to replay a stopped run, follow_up to continue a stopped background agent run, get/logs for inspection, and cancel to stop a run.',
        'Runs are detached by default. Only set deliverResultToConversation=true when the result should flow back to this conversation.',
        'For time-based runs, use defer/cron/at with start_agent; scheduled agent prompts become automations.',
        'For looping agents, use loop=true with start_agent.',
        'For pure conversation follow-up later, prefer conversation_queue with trigger="after_turn", "delay", or "at" instead.',
        'For editing or inspecting saved automations directly, use scheduled_task or the Automations UI.',
      ],
      parameters: RunToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
                content: [{
                  type: 'text' as const,
                  text: [`Run logs: ${runId}`, `path: ${result.path}`, '', result.log || '(empty log)'].join('\n'),
                }],
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

              const callbackConversation = deliverResultToConversation && conversationFile
                ? {
                    conversationId,
                    sessionFile: conversationFile,
                    profile: options.getCurrentProfile(),
                    repoRoot: options.repoRoot,
                  }
                : undefined;

              await ensureDaemonAvailable();
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
                throw new Error(result.reason ?? `Could not start durable run for ${taskSlug}.`);
              }

              invalidateAppTopics('runs');
              return {
                content: [{
                  type: 'text' as const,
                  text: `Started durable run ${result.runId} for ${taskSlug}.`,
                }],
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

              const callbackConversation = deliverResultToConversation && conversationFile
                ? {
                    conversationId,
                    sessionFile: conversationFile,
                    profile: options.getCurrentProfile(),
                    repoRoot: options.repoRoot,
                  }
                : undefined;
              const model = readOptionalString(params.model);
              const profile = readOptionalString(params.profile) || options.getCurrentProfile();
              const defer = readOptionalString(params.defer);
              const cron = readOptionalString(params.cron);
              const at = readOptionalString(params.at);
              const loop = params.loop === true;
              const loopDelay = readOptionalString(params.loopDelay);
              const loopMaxIterations = params.loopMaxIterations;
              const scheduleCount = Number(Boolean(defer)) + Number(Boolean(cron)) + Number(Boolean(at));

              if (scheduleCount > 1) {
                throw new Error('Use only one scheduling trigger: defer, cron, or at.');
              }

              if (scheduleCount > 0) {
                if (loop) {
                  throw new Error('loop cannot be combined with defer, cron, or at.');
                }

                const scheduledAt = resolveScheduledAt({ defer, at });
                await ensureDaemonAvailable();
                const automation = createStoredAutomation({
                  id: taskSlug,
                  profile,
                  title: taskSlug,
                  enabled: true,
                  cron,
                  at: scheduledAt,
                  modelRef: model,
                  cwd,
                  prompt,
                  targetType: 'background-agent',
                });

                const task = applyScheduledTaskThreadBinding(automation.id, conversationFile
                  ? {
                      threadMode: ctx.cwd === cwd ? 'existing' : 'dedicated',
                      threadConversationId: ctx.cwd === cwd ? conversationId : undefined,
                      threadSessionFile: ctx.cwd === cwd ? conversationFile : undefined,
                      cwd,
                    }
                  : {
                      threadMode: 'none',
                      cwd,
                    });

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

                const triggerInfo = defer
                  ? `defer ${defer}`
                  : cron
                    ? `cron ${cron}`
                    : `at ${scheduledAt}`;
                return {
                  content: [{
                    type: 'text' as const,
                    text: `Saved automation @${task.id} for ${taskSlug} [${triggerInfo}].`,
                  }],
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

              await ensureDaemonAvailable();
              const result = await startBackgroundRun({
                taskSlug,
                cwd,
                agent: {
                  prompt,
                  ...(model ? { model } : {}),
                  ...(profile ? { profile } : {}),
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
                throw new Error(result.reason ?? `Could not start durable agent run for ${taskSlug}.`);
              }

              invalidateAppTopics('runs');

              let message = `Started durable agent run ${result.runId} for ${taskSlug}`;
              if (loop) {
                message += ' [loop]';
              }
              message += '.';

              return {
                content: [{
                  type: 'text' as const,
                  text: message,
                }],
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
              await ensureDaemonAvailable();
              const result = await rerunDurableRun(runId);
              if (!result.accepted) {
                throw new Error(result.reason ?? `Could not rerun ${runId}.`);
              }

              invalidateAppTopics('runs');
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
              await ensureDaemonAvailable();
              const result = await followUpDurableRun(runId, prompt);
              if (!result.accepted) {
                throw new Error(result.reason ?? `Could not continue ${runId}.`);
              }

              invalidateAppTopics('runs');
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
              await ensureDaemonAvailable();
              const result = await cancelDurableRun(runId);
              if (!result.cancelled) {
                throw new Error(result.reason ?? `Could not cancel run ${runId}.`);
              }

              invalidateAppTopics('runs');
              return {
                content: [{ type: 'text' as const, text: `Cancelled durable run ${runId}.` }],
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
    });
  };
}
