import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDaemonConfig, parseTaskDefinition, type ParsedTaskDefinition } from '@personal-agent/daemon';

export interface TaskRuntimeEntry {
  id: string;
  filePath: string;
  scheduleType: string;
  running: boolean;
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

function readParsedTaskDefinition(filePath: string, rawContent: string): ParsedTaskDefinition {
  return parseTaskDefinition({
    filePath,
    rawContent,
    defaultTimeoutSeconds: loadDaemonConfig().modules.tasks.defaultTimeoutSeconds,
  });
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
