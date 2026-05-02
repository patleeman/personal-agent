import { describe, expect, it } from 'vitest';

import { parseFutureHumanDateTime, parseHumanDateTime } from './humanDateTime.js';

describe('humanDateTime', () => {
  it('parses exact relative expressions', () => {
    const parsed = parseFutureHumanDateTime('now+90m', {
      now: new Date('2026-04-28T12:00:00.000Z'),
    });

    expect(parsed.dueAt).toBe('2026-04-28T13:30:00.000Z');
  });

  it('sets a local clock time after applying a calendar-day relative expression', () => {
    const now = new Date(2026, 3, 28, 10, 15, 0, 0);
    const parsed = parseFutureHumanDateTime('now+1d@20:00', { now });

    expect(parsed.date.getFullYear()).toBe(2026);
    expect(parsed.date.getMonth()).toBe(3);
    expect(parsed.date.getDate()).toBe(29);
    expect(parsed.date.getHours()).toBe(20);
    expect(parsed.date.getMinutes()).toBe(0);
  });

  it('parses natural language relative dates with chrono', () => {
    const now = new Date(2026, 3, 28, 10, 15, 0, 0);
    const parsed = parseFutureHumanDateTime('tomorrow at 8pm', { now });

    expect(parsed.date.getFullYear()).toBe(2026);
    expect(parsed.date.getMonth()).toBe(3);
    expect(parsed.date.getDate()).toBe(29);
    expect(parsed.date.getHours()).toBe(20);
    expect(parsed.date.getMinutes()).toBe(0);
  });

  it('rejects expressions that resolve to the past', () => {
    expect(() =>
      parseFutureHumanDateTime('now-1d', {
        now: new Date('2026-04-28T12:00:00.000Z'),
      }),
    ).toThrow('must resolve to the future');
  });

  it('returns null for unparseable input', () => {
    expect(
      parseHumanDateTime('not a date', {
        now: new Date('2026-04-28T12:00:00.000Z'),
      }),
    ).toBeNull();
  });
});
