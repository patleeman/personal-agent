import { describe, expect, it } from 'vitest';
import { extractProfileFlag, parseCommand } from './args.js';

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
});

describe('extractProfileFlag', () => {
  it('extracts --profile and leaves remaining args', () => {
    expect(extractProfileFlag(['--profile', 'datadog', '--model', 'kimi-coding/k2p5'])).toEqual({
      profile: 'datadog',
      remainingArgs: ['--model', 'kimi-coding/k2p5'],
    });
  });

  it('returns undefined profile when absent', () => {
    expect(extractProfileFlag(['--thinking', 'off'])).toEqual({
      profile: undefined,
      remainingArgs: ['--thinking', 'off'],
    });
  });

  it('throws when --profile is missing value', () => {
    expect(() => extractProfileFlag(['--profile'])).toThrow('--profile requires a value');
  });
});
