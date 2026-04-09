import { describe, expect, it } from 'vitest';
import {
  buildScheduleInput,
  formatDelay,
  isValidCron,
  isValidTimestamp,
  parseDelay,
  parseRunArgs,
} from './cli.js';

describe('run CLI helpers', () => {
  it('parses delay strings with supported units and fractions', () => {
    expect(parseDelay('30s')).toBe(30_000);
    expect(parseDelay('15m')).toBe(15 * 60_000);
    expect(parseDelay('1.25H')).toBe(4_500_000);
    expect(parseDelay('2d')).toBe(2 * 24 * 60 * 60_000);
  });

  it('returns null for invalid delay strings', () => {
    expect(parseDelay('')).toBeNull();
    expect(parseDelay('10')).toBeNull();
    expect(parseDelay('5w')).toBeNull();
    expect(parseDelay('soon')).toBeNull();
  });

  it('formats delay values across second, minute, hour, and day ranges', () => {
    expect(formatDelay(45_000)).toBe('45s');
    expect(formatDelay(10 * 60_000)).toBe('10m');
    expect(formatDelay(3 * 60 * 60_000)).toBe('3h');
    expect(formatDelay(2 * 24 * 60 * 60_000)).toBe('2d');
  });

  it('validates cron expressions and timestamps with basic parsing rules', () => {
    expect(isValidCron('0 9 * * 1-5')).toBe(true);
    expect(isValidCron('0 9 * *')).toBe(false);

    expect(isValidTimestamp('2026-04-11T09:30:00.000Z')).toBe(true);
    expect(isValidTimestamp('not-a-date')).toBe(false);
  });

  it('builds a default now trigger and includes optional target metadata', () => {
    expect(buildScheduleInput({
      target: 'review the latest diff',
      profile: 'assistant',
      model: 'gpt-5',
    })).toEqual({
      trigger: { type: 'now' },
      target: {
        type: 'agent',
        prompt: 'review the latest diff',
        profile: 'assistant',
        model: 'gpt-5',
      },
    });
  });

  it('builds defer, cron, and at triggers from CLI input', () => {
    expect(buildScheduleInput({
      target: 'follow up later',
      trigger: { type: 'defer' },
    })).toEqual({
      trigger: { type: 'defer', delay: '1h' },
      target: {
        type: 'agent',
        prompt: 'follow up later',
      },
    });

    expect(buildScheduleInput({
      target: 'weekday summary',
      trigger: { type: 'cron', value: '0 9 * * 1-5' },
    })).toEqual({
      trigger: { type: 'cron', expression: '0 9 * * 1-5' },
      target: {
        type: 'agent',
        prompt: 'weekday summary',
      },
    });

    expect(buildScheduleInput({
      target: 'resume later',
      trigger: { type: 'at', value: '2026-04-11T09:30:00.000Z' },
    })).toEqual({
      trigger: { type: 'at', at: new Date('2026-04-11T09:30:00.000Z') },
      target: {
        type: 'agent',
        prompt: 'resume later',
      },
    });
  });

  it('falls back to a now trigger for unknown trigger types', () => {
    expect(buildScheduleInput({
      target: 'fallback trigger',
      trigger: { type: 'unexpected', value: 'ignored' } as never,
    })).toEqual({
      trigger: { type: 'now' },
      target: {
        type: 'agent',
        prompt: 'fallback trigger',
      },
    });
  });

  it('parses target text with defer trigger and alias flags', () => {
    const { input, errors } = parseRunArgs([
      '--defer',
      '1.5h',
      'review',
      'the',
      'deployment',
      '-p',
      'assistant',
      '-m',
      'gpt-5',
      '-C',
      '/tmp/worktree',
    ]);

    expect(errors).toEqual([]);
    expect(input).toEqual({
      target: 'review the deployment',
      trigger: { type: 'defer', value: '1.5h' },
      profile: 'assistant',
      model: 'gpt-5',
      cwd: '/tmp/worktree',
    });
  });

  it('parses cron and at triggers with long-form flags', () => {
    expect(parseRunArgs(['--cron', '0 9 * * 1-5', 'daily', 'check'])).toEqual({
      input: {
        target: 'daily check',
        trigger: { type: 'cron', value: '0 9 * * 1-5' },
      },
      errors: [],
    });

    expect(parseRunArgs(['--at', '2026-04-11T09:30:00.000Z', 'resume', 'conversation'])).toEqual({
      input: {
        target: 'resume conversation',
        trigger: { type: 'at', value: '2026-04-11T09:30:00.000Z' },
      },
      errors: [],
    });
  });

  it.each([
    {
      args: ['--defer'],
      message: '--defer requires a delay argument (e.g., 1h, 30m)',
    },
    {
      args: ['--defer', 'nope', 'review'],
      message: 'Invalid delay format: nope. Use: 30s, 10m, 2h, 1d',
    },
    {
      args: ['--cron'],
      message: '--cron requires a cron expression',
    },
    {
      args: ['--cron', '0 9 * *', 'review'],
      message: 'Invalid cron expression: 0 9 * *',
    },
    {
      args: ['--at'],
      message: '--at requires a timestamp',
    },
    {
      args: ['--at', 'not-a-date', 'review'],
      message: 'Invalid timestamp: not-a-date',
    },
    {
      args: ['--profile'],
      message: '--profile requires a profile name',
    },
    {
      args: ['--model'],
      message: '--model requires a model name',
    },
    {
      args: ['--cwd'],
      message: '--cwd requires a directory path',
    },
  ])('reports input validation errors for $args', ({ args, message }) => {
    expect(parseRunArgs(args).errors).toContain(message);
  });

  it('reports unknown options and missing target prompts', () => {
    expect(parseRunArgs(['--unknown'])).toEqual({
      input: { target: '' },
      errors: ['Unknown option: --unknown', 'Target prompt is required'],
    });
  });
});
