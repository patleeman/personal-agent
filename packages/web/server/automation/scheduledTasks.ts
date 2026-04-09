import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ensureLegacyTaskImports,
  getAutomationDbPath,
  getStoredAutomation,
  listStoredAutomations,
  loadAutomationRuntimeStateMap,
  loadDaemonConfig,
  parseTaskDefinition,
  type ParsedTaskDefinition,
  type StoredAutomation,
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
  title: string;
  enabled: boolean;
  scheduleType: ParsedTaskDefinition['schedule']['type'];
  cron?: string;
  at?: string;
  model?: string;
  thinkingLevel?: string;
  profile?: string;
  cwd?: string;
  timeoutSeconds?: number;
  prompt: string;
  promptBody: string;
}

export interface ScheduledTaskParseError {
  filePath: string;
  error: string;
}

export interface LoadedScheduledTasksForProfile {
  taskDir: string;
  tasks: StoredAutomation[];
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

function toRuntimeEntries(): { runtimeState: Record<string, TaskRuntimeEntry>; runtimeEntries: TaskRuntimeEntry[] } {
  const runtimeState = loadAutomationRuntimeStateMap({ dbPath: getAutomationDbPath() });
  const entries = Object.values(runtimeState).map((record) => ({
    id: record.id,
    filePath: record.filePath,
    scheduleType: record.scheduleType,
    running: record.running,
    lastStatus: record.lastStatus,
    lastRunAt: record.lastRunAt,
    lastSuccessAt: record.lastSuccessAt,
    lastScheduledMinute: record.lastScheduledMinute,
    lastAttemptCount: record.lastAttemptCount,
    lastLogPath: record.lastLogPath,
  }));

  return {
    runtimeState: Object.fromEntries(entries.flatMap((entry) => entry.id ? [[entry.id, entry] as const] : [])),
    runtimeEntries: entries,
  };
}

function hydrateMetadata(task: StoredAutomation): ScheduledTaskFileMetadata {
  return {
    id: task.id,
    title: task.title,
    enabled: task.enabled,
    scheduleType: task.schedule.type,
    cron: task.schedule.type === 'cron' ? task.schedule.expression : undefined,
    at: task.schedule.type === 'at' ? task.schedule.at : undefined,
    model: task.modelRef,
    thinkingLevel: task.thinkingLevel,
    profile: task.profile,
    cwd: task.cwd,
    timeoutSeconds: task.timeoutSeconds,
    prompt: task.prompt.split('\n')[0]?.slice(0, 120) ?? '',
    promptBody: task.prompt,
  };
}

export function validateScheduledTaskDefinition(filePath: string, rawContent: string): ParsedTaskDefinition {
  return parseTaskDefinition({
    filePath,
    rawContent,
    defaultTimeoutSeconds: loadDaemonConfig().modules.tasks.defaultTimeoutSeconds,
  });
}

export function getScheduledTaskStateFilePath(): string {
  return getAutomationDbPath();
}

export function taskDirForProfile(_profile: string): string {
  return loadDaemonConfig().modules.tasks.taskDir;
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
  return toRuntimeEntries().runtimeState;
}

export function inferTaskProfileFromFilePath(filePath: string): string | undefined {
  const normalized = normalizePath(filePath);
  const match = normalized.match(/\/profiles\/([^/]+)\/agent\/tasks(?:\/|$)/);
  return match?.[1];
}

export function readScheduledTaskFileMetadata(filePath: string): ScheduledTaskFileMetadata {
  const fileContent = readFileSync(filePath, 'utf-8');
  const parsed = validateScheduledTaskDefinition(filePath, fileContent);

  return {
    id: parsed.id,
    title: parsed.title ?? parsed.id,
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
  };
}

export function loadScheduledTasksForProfile(profile: string): LoadedScheduledTasksForProfile {
  const config = loadDaemonConfig();
  const taskDir = taskDirForProfile(profile);
  const importResult = ensureLegacyTaskImports({
    taskDir,
    defaultTimeoutSeconds: config.modules.tasks.defaultTimeoutSeconds,
    dbPath: getAutomationDbPath(config),
  });
  const tasks = listStoredAutomations({ profile, dbPath: getAutomationDbPath(config) });
  const { runtimeState, runtimeEntries } = toRuntimeEntries();

  return {
    taskDir,
    tasks,
    parseErrors: importResult.parseErrors,
    runtimeState,
    runtimeEntries,
  };
}

export function resolveScheduledTaskForProfile(profile: string, taskId: string): {
  taskDir: string;
  task: StoredAutomation;
  runtime?: TaskRuntimeEntry;
} {
  const loaded = loadScheduledTasksForProfile(profile);
  const task = getStoredAutomation(taskId, { profile, dbPath: getAutomationDbPath() });

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return {
    taskDir: loaded.taskDir,
    task,
    runtime: loaded.runtimeState[task.id],
  };
}

export function buildScheduledTaskMarkdown(input: {
  taskId: string;
  profile: string;
  title?: string | null;
  enabled: boolean;
  cron?: string | null;
  at?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number | null;
  prompt: string;
}): string {
  const cron = readOptionalString(input.cron);
  const at = readOptionalString(input.at);
  if (Boolean(cron) === Boolean(at)) {
    throw new Error('Provide exactly one of cron or at.');
  }

  const lines = [
    '---',
    `id: ${yamlString(input.taskId)}`,
  ];

  const title = readOptionalString(input.title ?? undefined);
  if (title) {
    lines.push(`title: ${yamlString(title)}`);
  }

  lines.push(`enabled: ${input.enabled ? 'true' : 'false'}`);

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

  const thinkingLevel = readOptionalString(input.thinkingLevel);
  if (thinkingLevel) {
    lines.push(`thinking: ${yamlString(thinkingLevel)}`);
  }

  const cwd = readOptionalString(input.cwd);
  if (cwd) {
    lines.push(`cwd: ${yamlString(cwd)}`);
  }

  if (input.timeoutSeconds !== undefined && input.timeoutSeconds !== null) {
    lines.push(`timeoutSeconds: ${Math.max(1, Math.floor(input.timeoutSeconds))}`);
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

export function toScheduledTaskMetadata(task: StoredAutomation): ScheduledTaskFileMetadata {
  return hydrateMetadata(task);
}
