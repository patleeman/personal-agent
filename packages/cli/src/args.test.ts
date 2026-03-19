import { describe, expect, it } from 'vitest';
import { hasOption, parseCommand } from './args.js';

describe('parseCommand', () => {
  it('defaults to tui for empty argv', () => {
    expect(parseCommand([])).toEqual({ command: 'tui', args: [] });
  });

  it('parses help aliases', () => {
    expect(parseCommand(['--help'])).toEqual({ command: 'help', args: [] });
    expect(parseCommand(['-h', 'profile'])).toEqual({ command: 'help', args: ['profile'] });
    expect(parseCommand(['help', 'doctor'])).toEqual({ command: 'help', args: ['doctor'] });
  });

  it('parses known commands and preserves rest args', () => {
    expect(parseCommand(['profile', 'use', 'shared'])).toEqual({
      command: 'profile',
      args: ['use', 'shared'],
    });
    expect(parseCommand(['tasks', 'list'])).toEqual({
      command: 'tasks',
      args: ['list'],
    });
    expect(parseCommand(['runs', 'list'])).toEqual({
      command: 'runs',
      args: ['list'],
    });
    expect(parseCommand(['targets', 'list'])).toEqual({
      command: 'targets',
      args: ['list'],
    });
  });

  it('treats unknown first token as tui args passthrough', () => {
    expect(parseCommand(['-p', 'hello'])).toEqual({ command: 'tui', args: ['-p', 'hello'] });
  });

  it('supports custom known command list', () => {
    expect(parseCommand(['custom', '--flag'], ['custom'])).toEqual({
      command: 'custom',
      args: ['--flag'],
    });
  });
});

describe('hasOption', () => {
  it('returns true only when option is present exactly', () => {
    expect(hasOption(['--json', '--plain'], '--json')).toBe(true);
    expect(hasOption(['--json'], '--plain')).toBe(false);
  });
});
