import { describe, expect, it } from 'vitest';
import type { ScheduledTaskDetail } from '../shared/types';
import { taskStatusMeta } from './ScheduledTaskPanel';

function createTask(overrides: Partial<ScheduledTaskDetail>): ScheduledTaskDetail {
  return {
    id: 'daily-report',
    title: 'Daily report',
    filePath: '/__automations__/daily-report.automation.md',
    scheduleType: 'cron',
    targetType: 'background-agent',
    running: false,
    enabled: true,
    cron: '0 9 * * *',
    prompt: 'Send report.',
    threadMode: 'dedicated',
    ...overrides,
  };
}

describe('ScheduledTaskPanel status presentation', () => {
  it('marks daemon failed status as failed', () => {
    expect(taskStatusMeta(createTask({ lastStatus: 'failed' }))).toEqual({
      text: 'failed',
      cls: 'text-danger',
    });
  });
});
