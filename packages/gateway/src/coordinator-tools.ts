import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Type } from '@sinclair/typebox';
import type { ExtensionContext, ToolDefinition } from '@mariozechner/pi-coding-agent';
import {
  getProfilesRoot,
  loadDeferredResumeState,
  parseDeferredResumeDelayMs,
  readSessionConversationId,
  removeDeferredResume,
  saveDeferredResumeState,
  scheduleDeferredResume,
} from '@personal-agent/core';
import {
  cancelDeferredResumeConversationRun,
  cancelDurableRun,
  getDurableRun,
  listDurableRuns,
  loadDaemonConfig,
  parseTaskDefinition,
  pingDaemon,
  resolveDaemonPaths,
  scheduleDeferredResumeConversationRun,
  startDaemonDetached,
  startScheduledTaskRun,
  type ParsedTaskDefinition,
} from '@personal-agent/daemon';
import { getGatewayExtensionRuntimeContext } from './extensions/runtime-context.js';

const DELEGATE_ACTION_VALUES = ['start', 'list', 'get', 'logs', 'cancel'] as const;
const DELEGATE_NOTIFY_MODE_VALUES = ['none', 'message', 'resume'] as const;
const SCHEDULED_TASK_ACTION_VALUES = ['list', 'get', 'save', 'delete', 'validate', 'run'] as const;
const TASK_OUTPUT_WHEN_VALUES = ['success', 'failure', 'always'] as const;

const DEFAULT_DEFERRED_RESUME_PROMPT = 'Continue from where you left off and keep going.';
const GATEWAY_DELEGATE_SOURCE_TYPE = 'gateway-delegate';

type DelegateAction = (typeof DELEGATE_ACTION_VALUES)[number];
type DelegateNotifyMode = (typeof DELEGATE_NOTIFY_MODE_VALUES)[number];
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

export interface GatewayDelegateStartInput {
  conversationId: string;
  sessionFile?: string;
  taskSlug: string;
  taskPrompt: string;
  workerPrompt: string;
  cwd: string;
  model?: string;
  notifyMode: DelegateNotifyMode;
}

export interface GatewayDelegateStartResult {
  runId: string;
  logPath?: string;
}

export interface GatewayCoordinatorToolOptions {
  profileName: string;
  startDelegateRun: (input: GatewayDelegateStartInput) => Promise<GatewayDelegateStartResult>;
}

const DelegateToolParams = Type.Object({
  action: Type.Union(DELEGATE_ACTION_VALUES.map((value) => Type.Literal(value))),
  runId: Type.Optional(Type.String({ description: 'Delegated run id for get/logs/cancel actions.' })),
  taskSlug: Type.Optional(Type.String({ description: 'Short delegated task slug for start, for example code-review.' })),
  prompt: Type.Optional(Type.String({ description: 'Delegated worker instructions. Keep them focused and concrete.' })),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the delegated worker. Defaults to the current conversation cwd.' })),
  model: Type.Optional(Type.String({ description: 'Optional full model ref for the delegated worker, for example openai/gpt-5.4.' })),
  notifyMode: Type.Optional(Type.Union(DELEGATE_NOTIFY_MODE_VALUES.map((value) => Type.Literal(value)))),
  tail: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, description: 'Number of log lines to include for logs.' })),
});

const ScheduledTaskToolParams = Type.Object({
  action: Type.Union(SCHEDULED_TASK_ACTION_VALUES.map((value) => Type.Literal(value))),
  profile: Type.Optional(Type.String({ description: 'Profile whose task dir should be inspected. Defaults to the active gateway profile.' })),
  taskId: Type.Optional(Type.String({ description: 'Task id for get/save/delete/run/validate.' })),
  enabled: Type.Optional(Type.Boolean({ description: 'Whether the task is enabled when saving.' })),
  cron: Type.Optional(Type.String({ description: 'Recurring 5-field cron expression.' })),
  at: Type.Optional(Type.String({ description: 'One-time timestamp parseable by Date.parse.' })),
  model: Type.Optional(Type.String({ description: 'Full model ref, for example openai/gpt-5.4.' })),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the task.' })),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, description: 'Per-run timeout in seconds.' })),
  prompt: Type.Optional(Type.String({ description: 'Task prompt body.' })),
  outputWhen: Type.Optional(Type.Union(TASK_OUTPUT_WHEN_VALUES.map((value) => Type.Literal(value)))),
  outputTargets: Type.Optional(Type.Array(Type.Object({
    chatId: Type.String({ minLength: 1 }),
    messageThreadId: Type.Optional(Type.Number()),
  }), { description: 'Optional Telegram delivery targets for output routing.' })),
});

const DeferredResumeToolParams = Type.Object({
  delay: Type.String({ description: 'Delay until resume, for example 30s, 10m, 2h, or 1d.' }),
  prompt: Type.Optional(Type.String({ description: 'Optional prompt to inject when the deferred resume triggers. Defaults to continuing from the current point.' })),
});

function toTextResult(text: string, details: Record<string, unknown> = {}): {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

function toErrorResult(error: unknown, details: Record<string, unknown> = {}): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
  details: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    isError: true,
    details,
  };
}

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

function isModelReference(value: string): boolean {
  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf('/');
  return separatorIndex > 0 && separatorIndex < trimmed.length - 1;
}

function readOptionalModelReference(value: string | undefined, label = 'model'): string | undefined {
  const normalized = readOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (!isModelReference(normalized)) {
    throw new Error(`${label} must use format provider/model.`);
  }

  return normalized;
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

  const model = readOptionalModelReference(input.model);
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
  lines.push('');
  lines.push(readRequiredString(input.prompt, 'prompt'));
  lines.push('');

  return lines.join('\n');
}

function formatTaskDefinition(task: ParsedTaskDefinition, runtime?: TaskRuntimeEntry): string {
  const lines = [
    `Task ${task.id}`,
    `profile: ${task.profile}`,
    `enabled: ${task.enabled ? 'yes' : 'no'}`,
    task.schedule.type === 'cron'
      ? `schedule: cron ${task.schedule.expression}`
      : `schedule: at ${task.schedule.at}`,
    `cwd: ${task.cwd}`,
    `timeoutSeconds: ${task.timeoutSeconds}`,
    `model: ${task.modelRef ?? '(profile default)'}`,
  ];

  if (task.output && task.output.targets.length > 0) {
    lines.push(`output: ${task.output.when} -> ${task.output.targets.map((target) => `${target.gateway}:${target.chatId}`).join(', ')}`);
  }

  if (runtime?.lastRunAt) {
    lines.push(`lastRunAt: ${runtime.lastRunAt}`);
  }

  if (runtime?.lastStatus) {
    lines.push(`lastStatus: ${runtime.lastStatus}`);
  }

  if (runtime?.lastLogPath) {
    lines.push(`lastLogPath: ${runtime.lastLogPath}`);
  }

  lines.push('', task.prompt);
  return lines.join('\n');
}

function formatTaskList(profile: string): string {
  const loaded = loadParsedTasksForProfile(profile);
  if (loaded.tasks.length === 0 && loaded.parseErrors.length === 0) {
    return `No scheduled tasks found for profile ${profile}.`;
  }

  const lines = [`Scheduled tasks for profile ${profile}:`];

  for (const task of loaded.tasks) {
    const runtime = loaded.runtimeState[task.key];
    const status = runtime?.running
      ? 'running'
      : runtime?.lastStatus === 'failed'
        ? 'error'
        : task.enabled
          ? 'active'
          : 'disabled';

    const schedule = task.schedule.type === 'cron'
      ? `cron ${task.schedule.expression}`
      : `at ${task.schedule.at}`;

    const details: string[] = [schedule, status];
    if (runtime?.lastRunAt) {
      details.push(`lastRunAt=${runtime.lastRunAt}`);
    }

    lines.push(`- ${task.id} · ${details.join(' · ')}`);
  }

  if (loaded.parseErrors.length > 0) {
    lines.push('', `Parse errors (${loaded.parseErrors.length}):`);
    for (const error of loaded.parseErrors) {
      lines.push(`- ${error.filePath}: ${error.error}`);
    }
  }

  return lines.join('\n');
}

async function ensureDaemonAvailable(): Promise<void> {
  if (await pingDaemon()) {
    return;
  }

  await startDaemonDetached();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await pingDaemon()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Daemon did not become available. Start it with: pa daemon start');
}

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

function getConversationIdFromContext(ctx: ExtensionContext): string {
  const runtimeContext = getGatewayExtensionRuntimeContext(ctx.sessionManager);
  const conversationId = runtimeContext?.conversationId?.trim();
  if (!conversationId) {
    throw new Error('Gateway runtime context is unavailable for this session.');
  }

  return conversationId;
}

function buildDelegateWorkerPrompt(input: {
  taskPrompt: string;
  cwd: string;
}): string {
  const taskPrompt = readRequiredString(input.taskPrompt, 'prompt');

  return [
    'You are a focused subagent running in a durable background task.',
    '',
    'Task:',
    taskPrompt,
    '',
    'Context:',
    `- Working directory: ${input.cwd}`,
    '- Complete the task end-to-end without asking the user questions.',
    '- If blocked, explain the exact blocker and attempted steps.',
    '- Write for a human maintainer, not a parser.',
    '',
    'Output style:',
    '- Start with `## Executive summary` containing one short paragraph or 2-4 short bullets.',
    '- Then add `## Details` in readable prose.',
    '- Use bullets only for real artifacts, checks, or risks.',
    '- Avoid raw YAML or key:value dumps unless explicitly requested.',
    '- Use Markdown footnotes for secondary file paths, commands, and logs when useful.',
    '',
    'Include, when relevant:',
    '- result/status in the summary sentence',
    '- artifacts changed/created',
    '- checks run and outcomes',
    '- remaining risks or blockers',
  ].join('\n');
}

function formatDelegateRunList(runs: Awaited<ReturnType<typeof listDurableRuns>>['runs']): string {
  if (runs.length === 0) {
    return 'No delegated runs found for this conversation.';
  }

  const lines = ['Delegated runs:'];
  for (const run of runs) {
    const taskSlug = typeof run.manifest?.spec?.taskSlug === 'string'
      ? run.manifest.spec.taskSlug
      : 'unknown';
    const status = run.status?.status ?? 'unknown';
    const updatedAt = run.status?.updatedAt ?? run.manifest?.createdAt ?? 'unknown';
    lines.push(`- ${run.runId} [${status}] task=${taskSlug} updated=${updatedAt}`);
  }

  return lines.join('\n');
}

function readRunLogTailText(filePath: string | undefined, maxLines = 120): string {
  if (!filePath || !existsSync(filePath)) {
    return '';
  }

  try {
    return readFileSync(filePath, 'utf-8')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .slice(-maxLines)
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

function formatDelegateRunDetail(run: NonNullable<Awaited<ReturnType<typeof getDurableRun>>>['run']): string {
  const taskSlug = typeof run.manifest?.spec?.taskSlug === 'string'
    ? run.manifest.spec.taskSlug
    : 'unknown';
  const lines = [
    `Delegated run ${run.runId}`,
    `task: ${taskSlug}`,
    `status: ${run.status?.status ?? 'unknown'}`,
    `cwd: ${typeof run.manifest?.spec?.cwd === 'string' ? run.manifest.spec.cwd : 'unknown'}`,
    `log: ${run.paths.outputLogPath}`,
  ];

  if (run.status?.startedAt) {
    lines.push(`startedAt: ${run.status.startedAt}`);
  }

  if (run.status?.completedAt) {
    lines.push(`completedAt: ${run.status.completedAt}`);
  }

  if (run.status?.lastError) {
    lines.push(`lastError: ${run.status.lastError}`);
  }

  return lines.join('\n');
}

function isRunOwnedByConversation(
  run: Awaited<ReturnType<typeof listDurableRuns>>['runs'][number],
  conversationId: string,
): boolean {
  return run.manifest?.source?.type === GATEWAY_DELEGATE_SOURCE_TYPE
    && run.manifest?.source?.id === conversationId;
}

async function getOwnedDelegateRun(conversationId: string, runId: string) {
  const result = await getDurableRun(runId);
  if (!result) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (!isRunOwnedByConversation(result.run, conversationId)) {
    throw new Error(`Run ${runId} does not belong to this gateway conversation.`);
  }

  return result;
}

export function createGatewayCoordinatorTools(options: GatewayCoordinatorToolOptions): Array<ToolDefinition> {
  const delegateTool: ToolDefinition<typeof DelegateToolParams> = {
    name: 'delegate',
    label: 'Delegate',
    description: 'Launch and inspect delegated background agent runs for this gateway conversation.',
    promptSnippet: 'Use delegate to hand off substantive work to a durable background agent run instead of doing it inline.',
    promptGuidelines: [
      'In gateway mode you are a lightweight coordinator. Delegate substantive work instead of trying to do it inline.',
      'Use start for multi-step work, code changes, research, or anything that may take more than a short reply.',
      'Prefer notifyMode=resume when you want to continue automatically after the delegated worker finishes.',
      'Use get/logs if you need to inspect a delegated run before answering the user.',
    ],
    parameters: DelegateToolParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const conversationId = getConversationIdFromContext(ctx);

      try {
        switch (params.action as DelegateAction) {
          case 'start': {
            const taskSlug = readRequiredString(params.taskSlug, 'taskSlug');
            const taskPrompt = readRequiredString(params.prompt, 'prompt');
            const cwd = readRequiredString(params.cwd ?? ctx.cwd, 'cwd');
            const model = readOptionalModelReference(params.model);
            const notifyMode = (params.notifyMode as DelegateNotifyMode | undefined) ?? 'resume';
            const sessionFile = ctx.sessionManager.getSessionFile();
            if (notifyMode === 'resume' && !sessionFile) {
              throw new Error('Delegated resume requires a persisted session file.');
            }

            const workerPrompt = buildDelegateWorkerPrompt({ taskPrompt, cwd });
            const result = await options.startDelegateRun({
              conversationId,
              sessionFile: sessionFile ?? undefined,
              taskSlug,
              taskPrompt,
              workerPrompt,
              cwd,
              model,
              notifyMode,
            });

            const lines = [
              `Delegated run started: ${result.runId}`,
              `task=${taskSlug}`,
              `notify=${notifyMode}`,
            ];

            if (model) {
              lines.push(`model=${model}`);
            }

            if (result.logPath) {
              lines.push(`log=${result.logPath}`);
            }

            return toTextResult(lines.join('\n'), {
              action: 'start',
              runId: result.runId,
              taskSlug,
              cwd,
              model,
              notifyMode,
              logPath: result.logPath,
            });
          }

          case 'list': {
            const result = await listDurableRuns();
            const ownedRuns = result.runs.filter((run) => isRunOwnedByConversation(run, conversationId));
            return toTextResult(formatDelegateRunList(ownedRuns), {
              action: 'list',
              runCount: ownedRuns.length,
              runIds: ownedRuns.map((run) => run.runId),
            });
          }

          case 'get': {
            const runId = readRequiredString(params.runId, 'runId');
            const result = await getOwnedDelegateRun(conversationId, runId);
            return toTextResult(formatDelegateRunDetail(result.run), {
              action: 'get',
              runId,
              status: result.run.status?.status,
            });
          }

          case 'logs': {
            const runId = readRequiredString(params.runId, 'runId');
            const detail = await getOwnedDelegateRun(conversationId, runId);
            const tail = Math.max(1, Math.min(1000, Math.floor(params.tail ?? 120)));
            const path = detail.run.paths.outputLogPath;
            const log = readRunLogTailText(path, tail);

            return toTextResult(
              [`Delegated run logs: ${runId}`, `path: ${path}`, '', log || '(empty log)'].join('\n'),
              {
                action: 'logs',
                runId,
                tail,
                path,
              },
            );
          }

          case 'cancel': {
            const runId = readRequiredString(params.runId, 'runId');
            await getOwnedDelegateRun(conversationId, runId);
            await ensureDaemonAvailable();
            const result = await cancelDurableRun(runId);
            if (!result.cancelled) {
              throw new Error(result.reason ?? `Could not cancel run ${runId}.`);
            }

            return toTextResult(`Cancelled delegated run ${runId}.`, {
              action: 'cancel',
              runId,
              cancelled: true,
            });
          }

          default:
            throw new Error(`Unsupported delegate action: ${String(params.action)}`);
        }
      } catch (error) {
        return toErrorResult(error, { action: params.action });
      }
    },
  };

  const scheduledTaskTool: ToolDefinition<typeof ScheduledTaskToolParams> = {
    name: 'scheduled_task',
    label: 'Scheduled Task',
    description: 'Create, inspect, validate, run, and delete daemon-managed scheduled tasks.',
    promptSnippet: 'Use scheduled_task for daemon-managed recurring or one-time automation.',
    promptGuidelines: [
      'Use this tool when the user wants recurring automation, one-time scheduled prompts, or task inspection.',
      'Use save to create or update a task definition, validate to check definitions, and run to trigger one immediately.',
      'Keep tasks high-signal: clear schedule, explicit profile, and a concise prompt body.',
    ],
    parameters: ScheduledTaskToolParams,
    async execute(_toolCallId, params) {
      try {
        const profile = readOptionalString(params.profile) ?? options.profileName;

        switch (params.action as ScheduledTaskAction) {
          case 'list':
            return toTextResult(formatTaskList(profile), { action: 'list', profile });

          case 'get': {
            const taskId = readRequiredString(params.taskId, 'taskId');
            const resolved = resolveTaskForProfile(profile, taskId);
            return toTextResult(formatTaskDefinition(resolved.task, resolved.runtime), {
              action: 'get',
              profile,
              taskId,
              filePath: resolved.task.filePath,
            });
          }

          case 'save': {
            const taskId = readRequiredString(params.taskId, 'taskId');
            const prompt = readRequiredString(params.prompt, 'prompt');
            const taskDir = taskDirForProfile(profile);
            const filePath = join(taskDir, `${taskId}.task.md`);
            mkdirSync(dirname(filePath), { recursive: true });

            const content = buildTaskMarkdown({
              taskId,
              profile,
              enabled: params.enabled ?? true,
              cron: readOptionalString(params.cron),
              at: readOptionalString(params.at),
              model: readOptionalModelReference(params.model),
              cwd: readOptionalString(params.cwd),
              timeoutSeconds: params.timeoutSeconds !== undefined ? Math.floor(params.timeoutSeconds) : undefined,
              prompt,
              outputWhen: params.outputWhen as TaskOutputWhen | undefined,
              outputTargets: params.outputTargets,
            });

            const parsed = parseTaskDefinition({
              filePath,
              rawContent: content,
              defaultTimeoutSeconds: loadDaemonConfig().modules.tasks.defaultTimeoutSeconds,
            });

            writeFileSync(filePath, content, 'utf-8');
            return toTextResult(`Saved scheduled task ${parsed.id}.`, {
              action: 'save',
              profile,
              taskId: parsed.id,
              filePath,
            });
          }

          case 'delete': {
            const taskId = readRequiredString(params.taskId, 'taskId');
            const resolved = resolveTaskForProfile(profile, taskId);
            rmSync(resolved.task.filePath, { force: true });
            return toTextResult(`Deleted scheduled task ${resolved.task.id}.`, {
              action: 'delete',
              profile,
              taskId: resolved.task.id,
              filePath: resolved.task.filePath,
            });
          }

          case 'validate': {
            const taskId = readRequiredString(params.taskId, 'taskId');
            const resolved = resolveTaskForProfile(profile, taskId);
            const validated = parseTaskDefinition({
              filePath: resolved.task.filePath,
              rawContent: readFileSync(resolved.task.filePath, 'utf-8'),
              defaultTimeoutSeconds: loadDaemonConfig().modules.tasks.defaultTimeoutSeconds,
            });
            return toTextResult(`Task ${validated.id} is valid.`, {
              action: 'validate',
              profile,
              taskId: validated.id,
              filePath: validated.filePath,
            });
          }

          case 'run': {
            const taskId = readRequiredString(params.taskId, 'taskId');
            const resolved = resolveTaskForProfile(profile, taskId);
            await ensureDaemonAvailable();
            const result = await startScheduledTaskRun(resolved.task.filePath);
            if (!result.accepted) {
              throw new Error(result.reason ?? `Could not start task ${resolved.task.id}.`);
            }

            return toTextResult(`Started scheduled task ${resolved.task.id} (${result.runId}).`, {
              action: 'run',
              profile,
              taskId: resolved.task.id,
              runId: result.runId,
              filePath: resolved.task.filePath,
            });
          }

          default:
            throw new Error(`Unsupported scheduled_task action: ${String(params.action)}`);
        }
      } catch (error) {
        return toErrorResult(error, { action: params.action });
      }
    },
  };

  const deferredResumeTool: ToolDefinition<typeof DeferredResumeToolParams> = {
    name: 'deferred_resume',
    label: 'Deferred Resume',
    description: 'Schedule this gateway conversation to continue later through daemon-backed deferred resume state.',
    promptSnippet: 'Schedule this same gateway conversation to resume later.',
    promptGuidelines: [
      'Use this tool when you should pause now and continue later after waiting for time to pass or for background work to make progress.',
      'Good uses: waiting before checking delegated runs, retrying later, or staging unattended multi-step work.',
      'Use delays like 30s, 10m, 2h, or 1d.',
      'Provide a concise future prompt describing exactly what to continue or check next.',
    ],
    parameters: DeferredResumeToolParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (!sessionFile) {
          throw new Error('Deferred resume requires a persisted session file.');
        }

        const delayMs = parseDeferredResumeDelayMs(params.delay);
        if (!delayMs) {
          throw new Error('Invalid delay. Use forms like 30s, 10m, 2h, or 1d.');
        }

        const now = new Date();
        const state = loadDeferredResumeState();
        const record = scheduleDeferredResume(state, {
          id: `resume_${now.getTime()}_${Math.random().toString(36).slice(2, 10)}`,
          sessionFile,
          prompt: params.prompt?.trim() || DEFAULT_DEFERRED_RESUME_PROMPT,
          dueAt: new Date(now.getTime() + delayMs).toISOString(),
          createdAt: now.toISOString(),
          attempts: 0,
        });

        saveDeferredResumeState(state);
        await scheduleDeferredResumeConversationRun({
          daemonRoot: resolveDaemonRoot(),
          deferredResumeId: record.id,
          sessionFile: record.sessionFile,
          prompt: record.prompt,
          dueAt: record.dueAt,
          createdAt: record.createdAt,
          conversationId: readSessionConversationId(record.sessionFile),
        });

        return toTextResult(`Scheduled deferred resume ${record.id} in ${params.delay} (due ${record.dueAt}).`, {
          action: 'schedule',
          id: record.id,
          sessionFile,
          prompt: record.prompt,
          dueAt: record.dueAt,
        });
      } catch (error) {
        return toErrorResult(error, { action: 'schedule' });
      }
    },
  };

  return [delegateTool, scheduledTaskTool, deferredResumeTool] as unknown as Array<ToolDefinition>;
}

export async function cancelDeferredResumeForSessionFile(input: {
  sessionFile: string;
  id: string;
}): Promise<void> {
  const state = loadDeferredResumeState();
  const record = state.resumes[input.id];
  if (!record || record.sessionFile !== input.sessionFile) {
    throw new Error(`No deferred resume found for this conversation: ${input.id}`);
  }

  removeDeferredResume(state, input.id);
  saveDeferredResumeState(state);
  await cancelDeferredResumeConversationRun({
    daemonRoot: resolveDaemonRoot(),
    deferredResumeId: record.id,
    sessionFile: record.sessionFile,
    prompt: record.prompt,
    dueAt: record.dueAt,
    createdAt: record.createdAt,
    readyAt: record.readyAt,
    cancelledAt: new Date().toISOString(),
    conversationId: readSessionConversationId(record.sessionFile),
    reason: 'Deferred resume cancelled by user.',
  });
}

export { DEFAULT_DEFERRED_RESUME_PROMPT, GATEWAY_DELEGATE_SOURCE_TYPE };
