import { describe, expect, it } from 'vitest';
import { cronMatches, parseCronExpression, parseTaskDefinition } from './tasks-parser.js';

describe('tasks parser', () => {
  it('parses cron tasks with runtime overrides', () => {
    const task = parseTaskDefinition({
      filePath: '/tmp/tasks/daily-status.task.md',
      rawContent: `---
id: daily-status
enabled: true
cron: "0 9 * * 1-5"
profile: assistant
provider: openai-codex
model: gpt-5.4
cwd: ~/agent-workspace
timeoutSeconds: 900
---
Summarize yesterday's progress.
`,
      defaultTimeoutSeconds: 1800,
    });

    expect(task.id).toBe('daily-status');
    expect(task.enabled).toBe(true);
    expect(task.schedule.type).toBe('cron');
    expect(task.profile).toBe('assistant');
    expect(task.modelRef).toBe('openai-codex/gpt-5.4');
    expect(task.cwd).toContain('agent-workspace');
    expect(task.timeoutSeconds).toBe(900);
    expect(task.prompt).toContain('Summarize yesterday');
  });

  it('parses one-time at tasks', () => {
    const task = parseTaskDefinition({
      filePath: '/tmp/tasks/taxes-reminder.task.md',
      rawContent: `---
at: "2026-04-15T09:00:00-04:00"
model: openai-codex/gpt-5.4
---
Prepare tax checklist.
`,
      defaultTimeoutSeconds: 1800,
    });

    expect(task.id).toBe('taxes-reminder');
    expect(task.schedule.type).toBe('at');
    expect(task.profile).toBe('shared');
    expect(task.modelRef).toBe('openai-codex/gpt-5.4');
    expect(task.timeoutSeconds).toBe(1800);
  });

  it('rejects tasks without cron or at schedule', () => {
    expect(() => parseTaskDefinition({
      filePath: '/tmp/tasks/no-schedule.task.md',
      rawContent: `---
id: no-schedule
---
hello
`,
      defaultTimeoutSeconds: 1800,
    })).toThrow('must define one schedule key');
  });

  it('rejects unsafe timeoutSeconds values', () => {
    expect(() => parseTaskDefinition({
      filePath: '/tmp/tasks/unsafe-timeout.task.md',
      rawContent: `---
cron: "0 * * * *"
timeoutSeconds: ${Number.MAX_SAFE_INTEGER + 1}
---
hello
`,
      defaultTimeoutSeconds: 1800,
    })).toThrow('Frontmatter key timeoutSeconds must be a positive integer');
  });

  it('matches cron expressions using cron day-of-month/day-of-week semantics', () => {
    const expression = parseCronExpression('0 9 15 * 1');

    // Monday on the 8th -> should match day-of-week
    const monday = new Date(2026, 5, 8, 9, 0, 0, 0);
    expect(cronMatches(expression, monday)).toBe(true);

    // Saturday on the 15th -> should match day-of-month
    const saturdayFifteenth = new Date(2026, 7, 15, 9, 0, 0, 0);
    expect(cronMatches(expression, saturdayFifteenth)).toBe(true);

    // Not Monday and not 15th -> no match
    const saturdayOtherDay = new Date(2026, 7, 22, 9, 0, 0, 0);
    expect(cronMatches(expression, saturdayOtherDay)).toBe(false);
  });
});
