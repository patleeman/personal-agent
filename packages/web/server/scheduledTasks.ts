import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDurableTasksDir } from '@personal-agent/core';
import {
  loadDaemonConfig,
  parseTaskDefinition,
  resolveDaemonPaths,
  type ParsedTaskDefinition,
} from '@personal-agent/daemon';

export interface TaskRuntimeEntry {
  id?: string;
  filePath: string;
  scheduleType?: string;
  running?: boolean;
  lastStatus?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastScheduledMinute?: string;
  lastAttemptCount?: number;
  lastLogPath?: string;
}

export interface ScheduledTaskFileMetadata {
  id: string;
  fileContent: string;
  enabled: boolean;
  scheduleType: ParsedTaskDefinition['schedule']['type'];
  cron?: string;
  at?: string;
  model?: string;
  profile?: string;
  cwd?: string;
  timeoutSeconds?: number;
  prompt: string;
  promptBody: string;
  output?: ParsedTaskDefinition['output'];
}

export interface ScheduledTaskParseError {
  filePath: string;
  error: string;
}

export interface LoadedScheduledTasksForProfile {
  taskDir: string;
  tasks: ParsedTaskDefinition[];
  parseErrors: ScheduledTaskParseError[];
  runtimeState: Record<string, TaskRuntimeEntry>;
  runtimeEntries: TaskRuntimeEntry[];
}

function normalizePath(value: string): string {
  return resolve(value).replace(/\\/g, '/');
}

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function readOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readParsedTaskDefinition(filePath: string, rawContent: string): ParsedTaskDefinition {
  return parseTaskDefinition({
    filePath,
    rawContent,
    defaultTimeoutSeconds: loadDaemonConfig().modules.tasks.defaultTimeoutSeconds,
  });
}

export function validateScheduledTaskDefinition(filePath: string, rawContent: string): ParsedTaskDefinition {
  return readParsedTaskDefinition(filePath, rawContent);
}

export function getScheduledTaskStateFilePath(): string {
  return join(resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root, 'task-state.json');
}

export function taskDirForProfile(_profile: string): string {
  return getDurableTasksDir();
}

export function listScheduledTaskDefinitionFiles(taskDir: string): string[] {
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

export function loadScheduledTaskRuntimeState(): Record<string, TaskRuntimeEntry> {
  const stateFile = getScheduledTaskStateFilePath();
  if (!existsSync(stateFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf-8')) as { tasks?: Record<string, unknown> };
    if (!isRecord(parsed.tasks)) {
      return {};
    }

    const output: Record<string, TaskRuntimeEntry> = {};
    for (const [key, value] of Object.entries(parsed.tasks)) {
      if (!isRecord(value) || typeof value.filePath !== 'string' || value.filePath.trim().length === 0) {
        continue;
      }

      output[key] = {
        id: typeof value.id === 'string' ? value.id : undefined,
        filePath: value.filePath,
        scheduleType: typeof value.scheduleType === 'string' ? value.scheduleType : undefined,
        running: typeof value.running === 'boolean' ? value.running : undefined,
        lastStatus: typeof value.lastStatus === 'string' ? value.lastStatus : undefined,
        lastRunAt: typeof value.lastRunAt === 'string' ? value.lastRunAt : undefined,
        lastSuccessAt: typeof value.lastSuccessAt === 'string' ? value.lastSuccessAt : undefined,
        lastScheduledMinute: typeof value.lastScheduledMinute === 'string' ? value.lastScheduledMinute : undefined,
        lastAttemptCount: typeof value.lastAttemptCount === 'number' ? value.lastAttemptCount : undefined,
        lastLogPath: typeof value.lastLogPath === 'string' ? value.lastLogPath : undefined,
      };
    }

    return output;
  } catch {
    return {};
  }
}

export function inferTaskProfileFromFilePath(filePath: string): string | undefined {
  const normalized = normalizePath(filePath);
  const match = normalized.match(/\/profiles\/([^/]+)\/agent\/tasks(?:\/|$)/);
  return match?.[1];
}

export function readScheduledTaskFileMetadata(filePath: string): ScheduledTaskFileMetadata {
  const fileContent = readFileSync(filePath, 'utf-8');
  const parsed = readParsedTaskDefinition(filePath, fileContent);

  return {
    id: parsed.id,
    fileContent,
    enabled: parsed.enabled,
    scheduleType: parsed.schedule.type,
    cron: parsed.schedule.type === 'cron' ? parsed.schedule.expression : undefined,
    at: parsed.schedule.type === 'at' ? parsed.schedule.at : undefined,
    model: parsed.modelRef,
    profile: parsed.profile,
    cwd: parsed.cwd,
    timeoutSeconds: parsed.timeoutSeconds,
    prompt: parsed.prompt.split('\n')[0]?.slice(0, 120) ?? '',
    promptBody: parsed.prompt,
    output: parsed.output,
  };
}

export function loadScheduledTasksForProfile(profile: string): LoadedScheduledTasksForProfile {
  const taskDir = taskDirForProfile(profile);
  const tasks: ParsedTaskDefinition[] = [];
  const parseErrors: ScheduledTaskParseError[] = [];

  for (const filePath of listScheduledTaskDefinitionFiles(taskDir)) {
    try {
      const parsed = readParsedTaskDefinition(filePath, readFileSync(filePath, 'utf-8'));
      if (parsed.profile !== profile) {
        continue;
      }
      tasks.push(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(`profile`) || message.length > 0) {
        parseErrors.push({
          filePath,
          error: message,
        });
      }
    }
  }

  tasks.sort((left, right) => left.id.localeCompare(right.id) || left.filePath.localeCompare(right.filePath));

  const runtimeState = loadScheduledTaskRuntimeState();
  const runtimeEntries = Object.values(runtimeState)
    .filter((task) => taskBelongsToProfile(task, profile))
    .sort((left, right) => {
      const leftId = left.id ?? '';
      const rightId = right.id ?? '';
      return leftId.localeCompare(rightId) || left.filePath.localeCompare(right.filePath);
    });

  return {
    taskDir,
    tasks,
    parseErrors,
    runtimeState,
    runtimeEntries,
  };
}

export function resolveScheduledTaskForProfile(profile: string, taskId: string): {
  taskDir: string;
  task: ParsedTaskDefinition;
  runtime?: TaskRuntimeEntry;
} {
  const loaded = loadScheduledTasksForProfile(profile);
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

export function buildScheduledTaskMarkdown(input: {
  taskId: string;
  profile: string;
  enabled: boolean;
  cron?: string | null;
  at?: string | null;
  model?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number | null;
  prompt: string;
  output?: ParsedTaskDefinition['output'];
}): string {
  const cron = readOptionalString(input.cron);
  const at = readOptionalString(input.at);
  if (Boolean(cron) === Boolean(at)) {
    throw new Error('Provide exactly one of cron or at.');
  }

  const lines = [
    '---',
    `id: ${yamlString(input.taskId)}`,
    `enabled: ${input.enabled ? 'true' : 'false'}`,
  ];

  if (cron) {
    lines.push(`cron: ${yamlString(cron)}`);
  } else {
    lines.push(`at: ${yamlString(readRequiredString(at, 'at'))}`);
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

  if (input.timeoutSeconds !== undefined && input.timeoutSeconds !== null) {
    lines.push(`timeoutSeconds: ${Math.max(1, Math.floor(input.timeoutSeconds))}`);
  }

  if (input.output && input.output.targets.length > 0) {
    lines.push('output:');
    lines.push(`  when: ${input.output.when}`);
    lines.push('  targets:');
    for (const target of input.output.targets) {
      lines.push('    - gateway: telegram');
      lines.push(`      chatId: ${yamlString(readRequiredString(target.chatId, 'output.targets[].chatId'))}`);
      if (target.messageThreadId !== undefined) {
        lines.push(`      messageThreadId: ${Math.floor(target.messageThreadId)}`);
      }
    }
  }

  lines.push('---');
  lines.push(readRequiredString(input.prompt, 'prompt'));

  return `${lines.join('\n').trimEnd()}\n`;
}

export function taskBelongsToProfile(task: { filePath: string }, profile: string): boolean {
  const inferredProfile = inferTaskProfileFromFilePath(task.filePath);
  if (inferredProfile) {
    return inferredProfile === profile;
  }

  if (!existsSync(task.filePath)) {
    return false;
  }

  try {
    const metadata = readScheduledTaskFileMetadata(task.filePath);
    return metadata.profile === profile;
  } catch {
    return false;
  }
}
