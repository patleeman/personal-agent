import { describe, expect, it } from 'vitest';
import { getScheduledTaskBody, isScheduledTaskDetail } from './scheduledTaskDetail';

describe('scheduledTaskDetail helpers', () => {
  it('accepts a valid scheduled task detail payload', () => {
    expect(isScheduledTaskDetail({
      id: 'daily-status',
      running: false,
      enabled: true,
      cron: '0 9 * * *',
      model: 'openai/gpt-5',
      lastStatus: 'success',
      lastRunAt: '2026-03-12T20:15:00.000Z',
      fileContent: '---\ncron: "0 9 * * *"\n---\nSummarize the day.',
    })).toBe(true);
  });

  it('rejects malformed payloads missing file content', () => {
    expect(isScheduledTaskDetail({
      id: 'daily-status',
      running: false,
      enabled: true,
    })).toBe(false);
  });

  it('extracts the task body from frontmatter-backed files', () => {
    expect(getScheduledTaskBody('---\ncron: "0 9 * * *"\nprofile: shared\n---\nSummarize the day.\n- Include blockers')).toBe(
      'Summarize the day.\n- Include blockers',
    );
  });
});
