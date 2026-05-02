import { describe, expect, it } from 'vitest';

import { parseDeferredResumeSlashCommand } from './deferredResumeSlashCommand';

describe('parseDeferredResumeSlashCommand', () => {
  it('returns null for unrelated commands', () => {
    expect(parseDeferredResumeSlashCommand('/project new Something')).toBeNull();
  });

  it('parses the primary resume slash command', () => {
    expect(parseDeferredResumeSlashCommand('/resume 10m check the logs')).toEqual({
      kind: 'command',
      command: {
        action: 'schedule',
        delay: '10m',
        prompt: 'check the logs',
      },
    });
  });

  it('accepts the legacy defer alias', () => {
    expect(parseDeferredResumeSlashCommand('/defer 30s')).toEqual({
      kind: 'command',
      command: {
        action: 'schedule',
        delay: '30s',
      },
    });
  });

  it('parses the follow-up scheduling flag', () => {
    expect(parseDeferredResumeSlashCommand('/resume 10m --follow-up keep going')).toEqual({
      kind: 'command',
      command: {
        action: 'schedule',
        delay: '10m',
        behavior: 'followUp',
        prompt: 'keep going',
      },
    });
  });

  it('returns usage for invalid resume commands', () => {
    expect(parseDeferredResumeSlashCommand('/resume')).toEqual({
      kind: 'invalid',
      message: 'Usage: /resume <delay> [--follow-up] [prompt]',
    });
  });
});
