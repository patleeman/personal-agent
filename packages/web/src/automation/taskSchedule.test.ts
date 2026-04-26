import { describe, expect, it } from 'vitest';
import {
  buildCronFromEasyTaskSchedule,
  createCronEditorState,
  formatTaskNextRunCountdown,
  formatTaskSchedule,
  getNextTaskRunAt,
} from './taskSchedule';

describe('taskSchedule helpers', () => {
  it('parses supported cron expressions into builder state', () => {
    expect(createCronEditorState('11 */4 * * *')).toEqual({
      mode: 'builder',
      builder: {
        cadence: 'interval',
        minute: 11,
        hour: 0,
        intervalHours: 4,
        weekdays: [1],
        dayOfMonth: 1,
      },
      rawCron: '11 */4 * * *',
      supported: true,
    });

    expect(createCronEditorState('0 9 * * 1-5')).toEqual({
      mode: 'builder',
      builder: {
        cadence: 'weekdays',
        minute: 0,
        hour: 9,
        intervalHours: 4,
        weekdays: [1, 2, 3, 4, 5],
        dayOfMonth: 1,
      },
      rawCron: '0 9 * * 1-5',
      supported: true,
    });
  });

  it('builds cron expressions from simple schedules', () => {
    expect(buildCronFromEasyTaskSchedule({
      cadence: 'weekly',
      minute: 30,
      hour: 8,
      intervalHours: 4,
      weekdays: [1, 3, 5],
      dayOfMonth: 1,
    })).toBe('30 8 * * 1,3,5');
  });

  it('formats supported schedules for display', () => {
    expect(formatTaskSchedule({ cron: '11 */4 * * *' })).toBe('every 4h at :11');
    expect(formatTaskSchedule({ cron: '0 */4 * * *' })).toBe('every 4h on the hour');
    expect(formatTaskSchedule({ cron: '0 9 * * 1-5' })).toBe('weekdays at 09:00');
  });

  it('falls back to raw mode for unsupported cron expressions', () => {
    expect(createCronEditorState('*/15 * * * *')).toEqual({
      mode: 'raw',
      builder: {
        cadence: 'daily',
        minute: 0,
        hour: 9,
        intervalHours: 4,
        weekdays: [1],
        dayOfMonth: 1,
      },
      rawCron: '*/15 * * * *',
      supported: false,
    });
  });

  it('finds the next cron run after the current minute', () => {
    const now = Date.parse('2026-03-18T08:58:30');
    expect(getNextTaskRunAt({ enabled: true, cron: '0 9 * * 1-5' }, now)?.toISOString()).toBe(new Date('2026-03-18T09:00:00').toISOString());
    expect(getNextTaskRunAt({ enabled: true, cron: '*/15 * * * *' }, Date.parse('2026-03-18T08:45:00'))?.toISOString()).toBe(new Date('2026-03-18T09:00:00').toISOString());
  });

  it('does not report disabled or expired one-time schedules as upcoming', () => {
    const now = Date.parse('2026-03-18T08:00:00Z');
    expect(getNextTaskRunAt({ enabled: false, cron: '* * * * *' }, now)).toBeNull();
    expect(getNextTaskRunAt({ enabled: true, at: '2026-03-18T07:00:00Z' }, now)).toBeNull();
    expect(getNextTaskRunAt({ enabled: true, at: '2026-03-18T09:00:00Z' }, now)?.toISOString()).toBe('2026-03-18T09:00:00.000Z');
  });

  it('formats next-run countdowns with second-level precision near the run', () => {
    const now = Date.parse('2026-03-18T08:58:30Z');
    expect(formatTaskNextRunCountdown(new Date('2026-03-18T08:59:05Z'), now)).toBe('in 35s');
    expect(formatTaskNextRunCountdown(new Date('2026-03-18T09:00:00Z'), now)).toBe('in 1m 30s');
    expect(formatTaskNextRunCountdown(new Date('2026-03-19T10:00:00Z'), now)).toBe('in 1d 1h');
  });
});
