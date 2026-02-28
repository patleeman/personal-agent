import { describe, expect, it } from 'vitest';
import { parseCommand } from './args.js';

describe('parseCommand', () => {
  it('defaults to run when no command is provided', () => {
    expect(parseCommand([])).toEqual({ command: 'run', args: [] });
  });

  it('detects explicit commands', () => {
    expect(parseCommand(['profile', 'list'])).toEqual({ command: 'profile', args: ['list'] });
    expect(parseCommand(['doctor'])).toEqual({ command: 'doctor', args: [] });
    expect(parseCommand(['daemon', 'status'])).toEqual({ command: 'daemon', args: ['status'] });
    expect(parseCommand(['run', '--profile', 'shared'])).toEqual({
      command: 'run',
      args: ['--profile', 'shared'],
    });
  });

  it('treats unknown first token as run args', () => {
    expect(parseCommand(['--profile', 'shared'])).toEqual({
      command: 'run',
      args: ['--profile', 'shared'],
    });
  });

  it('supports caller-provided commands for plugin registration', () => {
    expect(parseCommand(['gateway', 'start'], ['run', 'gateway'])).toEqual({
      command: 'gateway',
      args: ['start'],
    });
  });
});

