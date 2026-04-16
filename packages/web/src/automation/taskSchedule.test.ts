import { describe, expect, it } from 'vitest';
import {
  buildCronFromEasyTaskSchedule,
  createCronEditorState,
  humanizeCronExpression,
  parseCronToEasyTaskSchedule,
} from './taskSchedule';

describe('taskSchedule helpers', () => {
  it('parses every-n-hours cron expressions for the builder', () => {
    expect(parseCronToEasyTaskSchedule('11 */4 * * *')).toEqual({
      cadence: 'interval',
      minute: 11,
      hour: 0,
      intervalHours: 4,
      weekdays: [1],
      dayOfMonth: 1,
    });
  });

  it('parses weekday cron expressions for the builder', () => {
    expect(parseCronToEasyTaskSchedule('0 9 * * 1-5')).toEqual({
      cadence: 'weekdays',
      minute: 0,
      hour: 9,
      intervalHours: 4,
      weekdays: [1, 2, 3, 4, 5],
      dayOfMonth: 1,
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

  it('humanizes supported cron expressions', () => {
    expect(humanizeCronExpression('11 */4 * * *')).toBe('every 4h at :11');
    expect(humanizeCronExpression('0 9 * * 1-5')).toBe('weekdays at 09:00');
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
});
