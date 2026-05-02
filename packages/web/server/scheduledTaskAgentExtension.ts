import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  loadDaemonConfig,
  parseTaskDefinition,
  resolveDaemonPaths,
  startScheduledTaskRun,
  type ParsedTaskDefinition,
} from '@personal-agent/daemon';
import { getProfilesRoot } from '@personal-agent/core';
import { invalidateAppTopics } from './appEvents.js';
import { ensureDaemonAvailable } from './daemonToolUtils.js';

const SCHEDULED_TASK_ACTION_VALUES = ['list', 'get', 'save', 'delete', 'validate', 'run'] as const;
const TASK_OUTPUT_WHEN_VALUES = ['success', 'failure', 'always'] as const;

type ScheduledTaskAction = (typeof SCHEDULED_TASK_ACTION_VALUES)[number];
type TaskOutputWhen = (typeof TASK_OUTPUT_WHEN_VALUES)[number];

interface TaskRuntimeEntry {
  id?: string;
  filePath?: string;
  running?: boolean;
  lastStatus?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastLogPath?: string;
}

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
  outputWhen: Type.Optional(Type.Union(TASK_OUTPUT_WHEN_VALUES.map((value) => Type.Literal(value)))),
  outputTargets: Type.Optional(Type.Array(Type.Object({
    chatId: Type.String({ minLength: 1 }),
    messageThreadId: Type.Optional(Type.Number()),
  }), { description: 'Optional Telegram delivery targets for output routing.' })),
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

function taskDirForProfile(profile: string): string {
  return join(getProfilesRoot(), profile, 'agent', 'tasks');
}

function listTaskDefinitionFiles(taskDir: string): string[] {
  if (!existsSync(taskDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [resolve(taskDir)];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.task.md')) {
        output.push(fullPath);
      }
    }
  }

  output.sort();
  return output;
}

function isTaskRuntimeMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function loadTaskRuntimeState(): Record<string, TaskRuntimeEntry> {
  const stateFile = join(resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root, 'task-state.json');
  if (!existsSync(stateFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf-8')) as { tasks?: Record<string, unknown> };
    if (!isTaskRuntimeMap(parsed.tasks)) {
      return {};
    }

    const output: Record<string, TaskRuntimeEntry> = {};
    for (const [key, value] of Object.entries(parsed.tasks)) {
      if (!isTaskRuntimeMap(value)) {
        continue;
      }

      output[key] = {
        id: typeof value.id === 'string' ? value.id : undefined,
        filePath: typeof value.filePath === 'string' ? value.filePath : undefined,
        running: typeof value.running === 'boolean' ? value.running : undefined,
        lastStatus: typeof value.lastStatus === 'string' ? value.lastStatus : undefined,
        lastRunAt: typeof value.lastRunAt === 'string' ? value.lastRunAt : undefined,
        lastSuccessAt: typeof value.lastSuccessAt === 'string' ? value.lastSuccessAt : undefined,
        lastLogPath: typeof value.lastLogPath === 'string' ? value.lastLogPath : undefined,
      };
    }

    return output;
  } catch {
    return {};
  }
}

function loadParsedTasksForProfile(profile: string): {
  taskDir: string;
  tasks: ParsedTaskDefinition[];
  parseErrors: Array<{ filePath: string; error: string }>;
  runtimeState: Record<string, TaskRuntimeEntry>;
} {
  const config = loadDaemonConfig();
  const taskDir = taskDirForProfile(profile);
  const tasks: ParsedTaskDefinition[] = [];
  const parseErrors: Array<{ filePath: string; error: string }> = [];

  for (const filePath of listTaskDefinitionFiles(taskDir)) {
    try {
      tasks.push(parseTaskDefinition({
        filePath,
        rawContent: readFileSync(filePath, 'utf-8'),
        defaultTimeoutSeconds: config.modules.tasks.defaultTimeoutSeconds,
      }));
    } catch (error) {
      parseErrors.push({
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  tasks.sort((left, right) => left.id.localeCompare(right.id) || left.filePath.localeCompare(right.filePath));

  return {
    taskDir,
    tasks,
    parseErrors,
    runtimeState: loadTaskRuntimeState(),
  };
}

function resolveTaskForProfile(profile: string, taskId: string): {
  taskDir: string;
  task: ParsedTaskDefinition;
  runtime?: TaskRuntimeEntry;
} {
  const loaded = loadParsedTasksForProfile(profile);
  const matches = loaded.tasks.filter((task) => task.id === taskId);

  if (matches.length === 0) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (matches.length > 1) {
    throw new Error(`Task id is ambiguous (${taskId}). Matches: ${matches.map((task) => task.filePath).join(', ')}`);
  }

  const task = matches[0] as ParsedTaskDefinition;
  return {
    taskDir: loaded.taskDir,
    task,
    runtime: loaded.runtimeState[task.key],
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function buildTaskMarkdown(input: {
  taskId: string;
  profile: string;
  enabled: boolean;
  cron?: string;
  at?: string;
  model?: string;
  cwd?: string;
  timeoutSeconds?: number;
  prompt: string;
  outputWhen?: TaskOutputWhen;
  outputTargets?: Array<{ chatId: string; messageThreadId?: number }>;
}): string {
  const hasCron = Boolean(readOptionalString(input.cron));
  const hasAt = Boolean(readOptionalString(input.at));
  if (hasCron === hasAt) {
    throw new Error('Provide exactly one of cron or at.');
  }

  const lines = [
    '---',
    `id: ${yamlString(input.taskId)}`,
    `enabled: ${input.enabled ? 'true' : 'false'}`,
  ];

  if (hasCron) {
    lines.push(`cron: ${yamlString(readRequiredString(input.cron, 'cron'))}`);
  } else {
    lines.push(`at: ${yamlString(readRequiredString(input.at, 'at'))}`);
  }

  lines.push(`profile: ${yamlString(input.profile)}`);

  const model = readOptionalString(input.model);
  if (model) {
    lines.push(`model: ${yamlString(model)}`);
  }

  const cwd = readOptionalString(input.cwd);
  if (cwd) {
    lines.push(`cwd: ${yamlString(cwd)}`);
  }

  if (input.timeoutSeconds !== undefined) {
    lines.push(`timeoutSeconds: ${Math.floor(input.timeoutSeconds)}`);
  }

  if (input.outputTargets && input.outputTargets.length > 0) {
    lines.push('output:');
    lines.push(`  when: ${input.outputWhen ?? 'success'}`);
    lines.push('  targets:');
    for (const target of input.outputTargets) {
      lines.push('    - gateway: telegram');
      lines.push(`      chatId: ${yamlString(readRequiredString(target.chatId, 'outputTargets.chatId'))}`);
      if (target.messageThreadId !== undefined) {
        lines.push(`      messageThreadId: ${Math.floor(target.messageThreadId)}`);
      }
    }
  }

  lines.push('---');
  lines.push(readRequiredString(input.prompt, 'prompt'));

  return `${lines.join('\n').trimEnd()}\n`;
}

function formatSchedule(task: ParsedTaskDefinition): string {
  return task.schedule.type === 'cron'
    ? `cron ${task.schedule.expression}`
    : `at ${task.schedule.at}`;
}

function formatTaskList(loaded: ReturnType<typeof loadParsedTasksForProfile>): string {
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
    return `- @${task.id} [${status}] ${formatSchedule(task)} · ${task.filePath}`;
  });

  if (loaded.parseErrors.length > 0) {
    lines.push(`Parse errors: ${loaded.parseErrors.map((error) => `${error.filePath}: ${error.error}`).join('; ')}`);
  }

  return ['Scheduled tasks:', ...lines].join('\n');
}

function formatTaskDetail(task: ParsedTaskDefinition, runtime: TaskRuntimeEntry | undefined): string {
  const lines = [
    `Task @${task.id}`,
    `schedule: ${formatSchedule(task)}`,
    `enabled: ${task.enabled ? 'true' : 'false'}`,
    `profile: ${task.profile}`,
    `file: ${task.filePath}`,
    `timeoutSeconds: ${task.timeoutSeconds}`,
  ];

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

  lines.push('', task.prompt);
  return lines.join('\n');
}

function fileNameForTaskId(taskId: string): string {
  return `${taskId}.task.md`;
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
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        try {
          const profile = readOptionalString(params.profile) ?? options.getCurrentProfile();

          switch (params.action as ScheduledTaskAction) {
            case 'list': {
              const loaded = loadParsedTasksForProfile(profile);
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
              const { task, runtime } = resolveTaskForProfile(profile, taskId);
              return {
                content: [{ type: 'text' as const, text: formatTaskDetail(task, runtime) }],
                details: {
                  action: 'get',
                  profile,
                  taskId,
                  filePath: task.filePath,
                },
              };
            }

            case 'save': {
              const loaded = loadParsedTasksForProfile(profile);
              const taskId = readRequiredString(params.taskId, 'taskId');
              const existing = loaded.tasks.find((task) => task.id === taskId);
              const schedule = existing?.schedule;
              const output = existing?.output;
              const content = buildTaskMarkdown({
                taskId,
                profile,
                enabled: params.enabled ?? existing?.enabled ?? true,
                cron: params.cron ?? (schedule?.type === 'cron' ? schedule.expression : undefined),
                at: params.at ?? (schedule?.type === 'at' ? schedule.at : undefined),
                model: params.model ?? existing?.modelRef,
                cwd: params.cwd ?? existing?.cwd,
                timeoutSeconds: params.timeoutSeconds ?? existing?.timeoutSeconds,
                prompt: params.prompt ?? existing?.prompt ?? '',
                outputWhen: params.outputWhen ?? output?.when,
                outputTargets: params.outputTargets ?? output?.targets.map((target) => ({
                  chatId: target.chatId,
                  messageThreadId: target.messageThreadId,
                })),
              });
              const filePath = existing?.filePath ?? join(loaded.taskDir, fileNameForTaskId(taskId));
              parseTaskDefinition({
                filePath,
                rawContent: content,
                defaultTimeoutSeconds: loadDaemonConfig().modules.tasks.defaultTimeoutSeconds,
              });

              mkdirSync(dirname(filePath), { recursive: true });
              writeFileSync(filePath, content);
              invalidateAppTopics('tasks');

              return {
                content: [{ type: 'text' as const, text: `${existing ? 'Updated' : 'Saved'} scheduled task @${taskId}.` }],
                details: {
                  action: 'save',
                  profile,
                  taskId,
                  filePath,
                },
              };
            }

            case 'delete': {
              const taskId = readRequiredString(params.taskId, 'taskId');
              const { task } = resolveTaskForProfile(profile, taskId);
              rmSync(task.filePath, { force: true });
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
              const loaded = loadParsedTasksForProfile(profile);
              if (params.taskId) {
                const taskId = readRequiredString(params.taskId, 'taskId');
                const match = loaded.tasks.find((task) => task.id === taskId);
                const parseError = loaded.parseErrors.find((entry) => entry.filePath.endsWith(`/${fileNameForTaskId(taskId)}`));

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
              const { task } = resolveTaskForProfile(profile, taskId);
              await ensureDaemonAvailable();
              const result = await startScheduledTaskRun(task.filePath);
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
