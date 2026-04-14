import { describe, expect, it } from 'vitest';
import { getScheduledTaskBody, isScheduledTaskDetail } from './scheduledTaskDetail';

describe('scheduledTaskDetail helpers', () => {
  it('accepts a valid scheduled task detail payload', () => {
    expect(isScheduledTaskDetail({
      id: 'daily-status',
      title: 'Daily status',
      running: false,
      enabled: true,
      scheduleType: 'cron',
      cron: '0 9 * * *',
      model: 'openai/gpt-5',
      timeoutSeconds: 1800,
      prompt: 'Summarize the day.',
      lastStatus: 'success',
      lastRunAt: '2026-03-12T20:15:00.000Z',
      threadMode: 'dedicated',
      threadConversationId: 'automation.daily-status',
      threadTitle: 'Automation: Daily status',
    })).toBe(true);
  });

  it('rejects malformed payloads missing prompt content', () => {
    expect(isScheduledTaskDetail({
      id: 'daily-status',
      running: false,
      enabled: true,
      threadMode: 'dedicated',
    })).toBe(false);
  });

  it('returns the stored prompt body as-is', () => {
    expect(getScheduledTaskBody('Summarize the day.\n- Include blockers')).toBe(
      'Summarize the day.\n- Include blockers',
    );
  });
});
