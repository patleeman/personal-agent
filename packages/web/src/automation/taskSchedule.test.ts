import { describe, expect, it } from 'vitest';
import {
  buildCronFromEasyTaskSchedule,
  createCronEditorState,
  formatTaskSchedule,
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
});
