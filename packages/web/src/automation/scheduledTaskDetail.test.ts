import { describe, expect, it } from 'vitest';
import { isScheduledTaskDetail } from './scheduledTaskDetail';

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
      activity: [{
        id: 'daily-status:1',
        kind: 'missed',
        createdAt: '2026-03-12T20:20:00.000Z',
        count: 1,
        firstScheduledAt: '2026-03-12T20:00:00.000Z',
        lastScheduledAt: '2026-03-12T20:00:00.000Z',
        exampleScheduledAt: ['2026-03-12T20:00:00.000Z'],
        outcome: 'skipped',
      }],
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

    expect(isScheduledTaskDetail({
      id: 'fractional-timeout',
      running: false,
      enabled: true,
      scheduleType: 'cron',
      prompt: 'Run cleanup.',
      threadMode: 'dedicated',
      timeoutSeconds: 1.5,
    })).toBe(false);

    expect(isScheduledTaskDetail({
      id: 'unsafe-timeout',
      running: false,
      enabled: true,
      scheduleType: 'cron',
      prompt: 'Run cleanup.',
      threadMode: 'dedicated',
      timeoutSeconds: Number.MAX_SAFE_INTEGER + 1,
    })).toBe(false);

    expect(isScheduledTaskDetail({
      id: 'unsafe-activity-count',
      running: false,
      enabled: true,
      scheduleType: 'cron',
      prompt: 'Run cleanup.',
      threadMode: 'dedicated',
      activity: [{
        id: 'unsafe-activity-count:1',
        kind: 'missed',
        createdAt: '2026-03-12T20:20:00.000Z',
        count: Number.MAX_SAFE_INTEGER + 1,
        firstScheduledAt: '2026-03-12T20:00:00.000Z',
        lastScheduledAt: '2026-03-12T20:00:00.000Z',
        exampleScheduledAt: ['2026-03-12T20:00:00.000Z'],
        outcome: 'skipped',
      }],
    })).toBe(false);
  });

});
