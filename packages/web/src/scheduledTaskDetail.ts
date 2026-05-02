import type { ScheduledTaskDetail } from './types';

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

export function isScheduledTaskDetail(value: unknown): value is ScheduledTaskDetail {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.running === 'boolean'
    && typeof record.enabled === 'boolean'
    && typeof record.fileContent === 'string'
    && isOptionalString(record.cron)
    && isOptionalString(record.model)
    && isOptionalString(record.lastStatus)
    && isOptionalString(record.lastRunAt);
}

export function getScheduledTaskBody(fileContent: string): string {
  return fileContent.replace(/^---[\s\S]*?---\n?/, '').trim();
}
