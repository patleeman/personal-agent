import { describe, expect, it } from 'vitest';
import { parseCommand } from './args.js';

describe('parseCommand', () => {
  it('defaults to tui when no command is provided', () => {
    expect(parseCommand([])).toEqual({ command: 'tui', args: [] });
  });

  it('detects explicit commands', () => {
    expect(parseCommand(['profile', 'list'])).toEqual({ command: 'profile', args: ['list'] });
    expect(parseCommand(['doctor'])).toEqual({ command: 'doctor', args: [] });
    expect(parseCommand(['restart'])).toEqual({ command: 'restart', args: [] });
    expect(parseCommand(['update'])).toEqual({ command: 'update', args: [] });
    expect(parseCommand(['daemon', 'status'])).toEqual({ command: 'daemon', args: ['status'] });
    expect(parseCommand(['tasks', 'list'])).toEqual({ command: 'tasks', args: ['list'] });
    expect(parseCommand(['inbox', 'list'])).toEqual({ command: 'inbox', args: ['list'] });
    expect(parseCommand(['runs', 'list'])).toEqual({ command: 'runs', args: ['list'] });
    expect(parseCommand(['tmux', 'list'])).toEqual({ command: 'tmux', args: ['list'] });
    expect(parseCommand(['gateway', 'start'])).toEqual({ command: 'gateway', args: ['start'] });
    expect(parseCommand(['tui', '--profile', 'shared'])).toEqual({
      command: 'tui',
      args: ['--profile', 'shared'],
    });
  });

  it('treats unknown first token as tui args', () => {
    expect(parseCommand(['--profile', 'shared'])).toEqual({
      command: 'tui',
      args: ['--profile', 'shared'],
    });
  });

  it('supports caller-provided commands for plugin registration', () => {
    expect(parseCommand(['gateway', 'start'], ['tui', 'gateway'])).toEqual({
      command: 'gateway',
      args: ['start'],
    });
  });
});

