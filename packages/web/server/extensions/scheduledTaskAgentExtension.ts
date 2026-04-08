import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  clearTaskCallbackBinding,
  getTaskCallbackBinding,
  readSessionConversationId,
  setTaskCallbackBinding,
} from '@personal-agent/core';
import {
  createStoredAutomation,
  deleteStoredAutomation,
  startScheduledTaskRun,
  updateStoredAutomation,
  type ParsedTaskDefinition,
} from '@personal-agent/daemon';
import { invalidateAppTopics } from '../shared/appEvents.js';
import { ensureDaemonAvailable } from '../automation/daemonToolUtils.js';
import {
  loadScheduledTasksForProfile,
  resolveScheduledTaskForProfile,
  type LoadedScheduledTasksForProfile,
  type TaskRuntimeEntry,
} from '../automation/scheduledTasks.js';

const SCHEDULED_TASK_ACTION_VALUES = ['list', 'get', 'save', 'delete', 'validate', 'run'] as const;

type ScheduledTaskAction = (typeof SCHEDULED_TASK_ACTION_VALUES)[number];

const ScheduledTaskToolParams = Type.Object({
  action: Type.Union(SCHEDULED_TASK_ACTION_VALUES.map((value) => Type.Literal(value))),
  profile: Type.Optional(Type.String({ description: 'Profile whose task dir should be inspected. Defaults to the active profile.' })),
  taskId: Type.Optional(Type.String({ description: 'Task id for get/save/delete/run/validate.' })),
  enabled: Type.Optional(Type.Boolean({ description: 'Whether the task is enabled when saving.' })),
  cron: Type.Optional(Type.String({ description: 'Recurring 5-field cron expression.' })),
  at: Type.Optional(Type.String({ description: 'One-time timestamp parseable by Date.parse.' })),
  model: Type.Optional(Type.String({ description: 'Full model ref, for example openai-codex/gpt-5.4.' })),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the task.' })),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, description: 'Per-run timeout in seconds.' })),
  prompt: Type.Optional(Type.String({ description: 'Task prompt body.' })),
  deliverResultToConversation: Type.Optional(Type.Boolean({ description: 'Whether task completions should wake the current conversation later.' })),
  notifyOnSuccess: Type.Optional(Type.Boolean({ description: 'Whether successful task completions should create an in-app alert for the current conversation callback.' })),
  notifyOnFailure: Type.Optional(Type.Boolean({ description: 'Whether failed task completions should create an in-app alert for the current conversation callback.' })),
  requireAck: Type.Optional(Type.Boolean({ description: 'Whether callback alerts should stay active until acknowledged.' })),
  autoResumeIfOpen: Type.Optional(Type.Boolean({ description: 'Whether an open saved conversation should auto-resume when the callback becomes ready.' })),
});

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function readOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function formatSchedule(task: ParsedTaskDefinition): string {
  return task.schedule.type === 'cron'
    ? `cron ${task.schedule.expression}`
    : `at ${task.schedule.at}`;
}

function formatTaskList(loaded: LoadedScheduledTasksForProfile): string {
  if (loaded.tasks.length === 0) {
    return loaded.parseErrors.length > 0
      ? `No valid tasks found. Parse errors: ${loaded.parseErrors.map((error) => `${error.filePath}: ${error.error}`).join('; ')}`
      : 'No scheduled tasks found.';
  }

  const lines = loaded.tasks.map((task) => {
    const runtime = loaded.runtimeState[task.key];
    const status = runtime?.running
      ? 'running'
      : runtime?.lastStatus ?? (task.enabled ? 'active' : 'disabled');
    return `- @${task.id} [${status}] ${task.title ?? task.id} · ${formatSchedule(task)}`;
  });

  if (loaded.parseErrors.length > 0) {
    lines.push(`Parse errors: ${loaded.parseErrors.map((error) => `${error.filePath}: ${error.error}`).join('; ')}`);
  }

  return ['Scheduled tasks:', ...lines].join('\n');
}

function formatTaskDetail(
  task: ParsedTaskDefinition,
  runtime: TaskRuntimeEntry | undefined,
  callbackBinding?: ReturnType<typeof getTaskCallbackBinding>,
): string {
  const lines = [
    `Task @${task.id}`,
    `title: ${task.title ?? task.id}`,
    `schedule: ${formatSchedule(task)}`,
    `enabled: ${task.enabled ? 'true' : 'false'}`,
    `profile: ${task.profile}`,
    `timeoutSeconds: ${task.timeoutSeconds}`,
  ];

  if (!task.filePath.startsWith('/__automations__/')) {
    lines.push(`legacyFile: ${task.filePath}`);
  }

  if (task.modelRef) {
    lines.push(`model: ${task.modelRef}`);
  }

  if (task.cwd) {
    lines.push(`cwd: ${task.cwd}`);
  }

  if (runtime?.lastStatus) {
    lines.push(`lastStatus: ${runtime.lastStatus}`);
  }

  if (runtime?.lastRunAt) {
    lines.push(`lastRunAt: ${runtime.lastRunAt}`);
  }

  if (runtime?.lastLogPath) {
    lines.push(`lastLogPath: ${runtime.lastLogPath}`);
  }

  if (callbackBinding) {
    lines.push(`callbackConversationId: ${callbackBinding.conversationId}`);
    lines.push(`callbackOnSuccess: ${callbackBinding.deliverOnSuccess ? callbackBinding.notifyOnSuccess : 'none'}`);
    lines.push(`callbackOnFailure: ${callbackBinding.deliverOnFailure ? callbackBinding.notifyOnFailure : 'none'}`);
  }

  lines.push('', task.prompt);
  return lines.join('\n');
}

export function createScheduledTaskAgentExtension(options: {
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'scheduled_task',
      label: 'Scheduled Task',
      description: 'Create, inspect, validate, run, and delete daemon-managed scheduled tasks.',
      promptSnippet: 'Use the scheduled_task tool for daemon-managed recurring or one-time automation.',
      promptGuidelines: [
        'Use this tool when the user wants recurring automation, one-time scheduled prompts, or task inspection.',
        'Use save to create or update a task definition, validate to check definitions, and run to trigger one immediately.',
        'Keep tasks high-signal: clear schedule, explicit profile, and a concise prompt body.',
      ],
      parameters: ScheduledTaskToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const profile = readOptionalString(params.profile) ?? options.getCurrentProfile();

          switch (params.action as ScheduledTaskAction) {
            case 'list': {
              const loaded = loadScheduledTasksForProfile(profile);
              return {
                content: [{ type: 'text' as const, text: formatTaskList(loaded) }],
                details: {
                  action: 'list',
                  profile,
                  count: loaded.tasks.length,
                  taskIds: loaded.tasks.map((task) => task.id),
                  parseErrorCount: loaded.parseErrors.length,
                },
              };
            }

            case 'get': {
              const taskId = readRequiredString(params.taskId, 'taskId');
              const { task, runtime } = resolveScheduledTaskForProfile(profile, taskId);
              const callbackBinding = getTaskCallbackBinding({ profile, taskId });
              return {
                content: [{ type: 'text' as const, text: formatTaskDetail(task, runtime, callbackBinding) }],
                details: {
                  action: 'get',
                  profile,
                  taskId,
                  filePath: task.filePath,
                },
              };
            }

            case 'save': {
              const loaded = loadScheduledTasksForProfile(profile);
              const taskId = readRequiredString(params.taskId, 'taskId');
              const existing = loaded.tasks.find((task) => task.id === taskId);
              const saved = existing
                ? updateStoredAutomation(taskId, {
                  title: taskId,
                  enabled: params.enabled ?? existing.enabled,
                  cron: params.cron ?? (existing.schedule.type === 'cron' ? existing.schedule.expression : undefined),
                  at: params.at ?? (existing.schedule.type === 'at' ? existing.schedule.at : undefined),
                  modelRef: params.model ?? existing.modelRef,
                  cwd: params.cwd ?? existing.cwd,
                  timeoutSeconds: params.timeoutSeconds ?? existing.timeoutSeconds,
                  prompt: params.prompt ?? existing.prompt,
                })
                : createStoredAutomation({
                  id: taskId,
                  profile,
                  title: taskId,
                  enabled: params.enabled ?? true,
                  cron: params.cron,
                  at: params.at,
                  modelRef: params.model,
                  cwd: params.cwd,
                  timeoutSeconds: params.timeoutSeconds,
                  prompt: params.prompt ?? '',
                });

              if (params.deliverResultToConversation === true) {
                const sessionFile = ctx.sessionManager.getSessionFile();
                const conversationId = sessionFile ? readSessionConversationId(sessionFile) : undefined;
                if (!sessionFile || !conversationId) {
                  throw new Error('deliverResultToConversation requires an active persisted conversation.');
                }

                setTaskCallbackBinding({
                  profile,
                  taskId,
                  conversationId,
                  sessionFile,
                  deliverOnSuccess: params.notifyOnSuccess ?? true,
                  deliverOnFailure: params.notifyOnFailure ?? true,
                  notifyOnSuccess: params.notifyOnSuccess === false ? 'none' : 'disruptive',
                  notifyOnFailure: params.notifyOnFailure === false ? 'none' : 'disruptive',
                  requireAck: params.requireAck ?? true,
                  autoResumeIfOpen: params.autoResumeIfOpen ?? true,
                });
              } else if (params.deliverResultToConversation === false) {
                clearTaskCallbackBinding({ profile, taskId });
              }

              invalidateAppTopics('tasks');

              return {
                content: [{ type: 'text' as const, text: `${existing ? 'Updated' : 'Saved'} scheduled task @${taskId}.` }],
                details: {
                  action: 'save',
                  profile,
                  taskId,
                  filePath: saved.filePath,
                },
              };
            }

            case 'delete': {
              const taskId = readRequiredString(params.taskId, 'taskId');
              deleteStoredAutomation(taskId, { profile });
              clearTaskCallbackBinding({ profile, taskId });
              invalidateAppTopics('tasks');

              return {
                content: [{ type: 'text' as const, text: `Deleted scheduled task @${taskId}.` }],
                details: {
                  action: 'delete',
                  profile,
                  taskId,
                },
              };
            }

            case 'validate': {
              const loaded = loadScheduledTasksForProfile(profile);
              if (params.taskId) {
                const taskId = readRequiredString(params.taskId, 'taskId');
                const match = loaded.tasks.find((task) => task.id === taskId);
                const parseError = loaded.parseErrors.find((entry) => entry.filePath.includes(taskId));

                if (!match && !parseError) {
                  throw new Error(`Task not found: ${taskId}`);
                }

                const valid = Boolean(match);
                return {
                  content: [{
                    type: 'text' as const,
                    text: valid
                      ? `Task @${taskId} is valid.`
                      : `Task @${taskId} is invalid: ${parseError?.error ?? 'unknown error'}`,
                  }],
                  isError: !valid,
                  details: {
                    action: 'validate',
                    profile,
                    taskId,
                    valid,
                  },
                };
              }

              const valid = loaded.parseErrors.length === 0;
              return {
                content: [{
                  type: 'text' as const,
                  text: valid
                    ? `Validated ${loaded.tasks.length} scheduled task${loaded.tasks.length === 1 ? '' : 's'} for profile ${profile}.`
                    : `Validation failed for ${loaded.parseErrors.length} task file${loaded.parseErrors.length === 1 ? '' : 's'}: ${loaded.parseErrors.map((entry) => `${entry.filePath}: ${entry.error}`).join('; ')}`,
                }],
                isError: !valid,
                details: {
                  action: 'validate',
                  profile,
                  valid,
                  count: loaded.tasks.length,
                  parseErrorCount: loaded.parseErrors.length,
                },
              };
            }

            case 'run': {
              const taskId = readRequiredString(params.taskId, 'taskId');
              const { task } = resolveScheduledTaskForProfile(profile, taskId);
              await ensureDaemonAvailable();
              const result = await startScheduledTaskRun(task.id);
              if (!result.accepted) {
                throw new Error(result.reason ?? `Could not start scheduled task @${taskId}.`);
              }

              invalidateAppTopics('tasks', 'runs');
              return {
                content: [{ type: 'text' as const, text: `Started scheduled task @${taskId} as run ${result.runId}.` }],
                details: {
                  action: 'run',
                  profile,
                  taskId,
                  runId: result.runId,
                },
              };
            }

            default:
              throw new Error(`Unsupported scheduled task action: ${String(params.action)}`);
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
