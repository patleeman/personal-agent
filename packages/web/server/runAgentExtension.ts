import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { startBackgroundRun } from '@personal-agent/daemon';
import { invalidateAppTopics } from './appEvents.js';
import { ensureDaemonAvailable } from './daemonToolUtils.js';
import { cancelDurableRun, getDurableRun, getDurableRunLog, listDurableRuns } from './durableRuns.js';

const RUN_ACTION_VALUES = ['list', 'get', 'logs', 'start', 'start_agent', 'cancel'] as const;

type RunAction = (typeof RUN_ACTION_VALUES)[number];

const RunToolParams = Type.Object({
  action: Type.Union(RUN_ACTION_VALUES.map((value) => Type.Literal(value))),
  runId: Type.Optional(Type.String({ description: 'Run id for get/logs/cancel actions.' })),
  taskSlug: Type.Optional(Type.String({ description: 'Short durable task slug for start, for example code-review.' })),
  command: Type.Optional(Type.String({ description: 'Shell command to execute for start.' })),
  prompt: Type.Optional(Type.String({ description: 'Agent prompt body for start_agent.' })),
  model: Type.Optional(Type.String({ description: 'Optional full model ref for start_agent, for example openai-codex/gpt-5.4.' })),
  profile: Type.Optional(Type.String({ description: 'Optional profile override for start_agent. Defaults to the active conversation profile.' })),
  cwd: Type.Optional(Type.String({ description: 'Working directory for start. Defaults to the current conversation cwd.' })),
  tail: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, description: 'Number of log lines to include for logs.' })),
});

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
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

export function createRunAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'run',
      label: 'Run',
      description: 'Inspect and manage durable daemon-backed background runs.',
      promptSnippet: 'Use the run tool for daemon-backed background runs that should outlive the current turn.',
      promptGuidelines: [
        'Use this tool for durable background jobs that should keep running outside the current turn.',
        'Prefer one focused run per independent task slug.',
        'Use start for detached shell work, start_agent for detached subagents, get/logs for inspection, and cancel to stop a run.',
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
              const tail = Math.max(1, Math.min(1000, Math.floor(params.tail ?? 120)));
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
                checkpointPayload: {
                  resumeParentOnExit: true,
                },
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
                },
              };
            }

            case 'start_agent': {
              const taskSlug = readRequiredString(params.taskSlug, 'taskSlug');
              const prompt = readRequiredString(params.prompt, 'prompt');
              const cwd = readRequiredString(params.cwd ?? ctx.cwd, 'cwd');
              const conversationId = ctx.sessionManager.getSessionId();
              const conversationFile = ctx.sessionManager.getSessionFile();
              const model = params.model?.trim();
              const profile = params.profile?.trim();

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
                checkpointPayload: {
                  resumeParentOnExit: true,
                },
              });

              if (!result.accepted) {
                throw new Error(result.reason ?? `Could not start durable agent run for ${taskSlug}.`);
              }

              invalidateAppTopics('runs');
              return {
                content: [{
                  type: 'text' as const,
                  text: `Started durable agent run ${result.runId} for ${taskSlug}.`,
                }],
                details: {
                  action: 'start_agent',
                  runId: result.runId,
                  taskSlug,
                  cwd,
                  model,
                  profile,
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
