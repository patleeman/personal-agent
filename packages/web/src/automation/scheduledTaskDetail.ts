import type { ScheduledTaskDetail } from '../shared/types';

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value > 0);
}

function isOptionalActivity(value: unknown): boolean {
  return value === undefined || (
    Array.isArray(value)
    && value.every((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }

      const record = entry as Record<string, unknown>;
      return typeof record.id === 'string'
        && record.kind === 'missed'
        && typeof record.createdAt === 'string'
        && Number.isInteger(record.count)
        && (record.count as number) > 0
        && typeof record.firstScheduledAt === 'string'
        && typeof record.lastScheduledAt === 'string'
        && Array.isArray(record.exampleScheduledAt)
        && record.exampleScheduledAt.every((scheduledAt) => typeof scheduledAt === 'string')
        && (record.outcome === 'skipped' || record.outcome === 'catch-up-started');
    })
  );
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
    && isOptionalString(record.targetType)
    && typeof record.prompt === 'string'
    && typeof record.threadMode === 'string'
    && isOptionalString(record.filePath)
    && isOptionalString(record.cron)
    && isOptionalString(record.at)
    && isOptionalString(record.model)
    && isOptionalString(record.thinkingLevel)
    && isOptionalString(record.cwd)
    && isOptionalPositiveInteger(record.timeoutSeconds)
    && isOptionalPositiveInteger(record.catchUpWindowSeconds)
    && isOptionalString(record.lastStatus)
    && isOptionalString(record.lastRunAt)
    && isOptionalActivity(record.activity)
    && isOptionalString(record.threadConversationId)
    && isOptionalString(record.threadTitle);
}

