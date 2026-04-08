import type { ScheduledTaskDetail } from './types';

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number';
}

export function isScheduledTaskDetail(value: unknown): value is ScheduledTaskDetail {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && isOptionalString(record.title)
    && typeof record.running === 'boolean'
    && typeof record.enabled === 'boolean'
    && typeof record.scheduleType === 'string'
    && typeof record.prompt === 'string'
    && isOptionalString(record.filePath)
    && isOptionalString(record.cron)
    && isOptionalString(record.at)
    && isOptionalString(record.model)
    && isOptionalString(record.cwd)
    && isOptionalNumber(record.timeoutSeconds)
    && isOptionalString(record.lastStatus)
    && isOptionalString(record.lastRunAt);
}

export function getScheduledTaskBody(prompt: string): string {
  return prompt.trim();
}
