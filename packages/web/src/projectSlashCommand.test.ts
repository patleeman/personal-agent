import { describe, expect, it } from 'vitest';
import { parseProjectSlashCommand, PROJECT_SLASH_USAGE } from './projectSlashCommand';

describe('parseProjectSlashCommand', () => {
  it('returns null for non-project slash commands', () => {
    expect(parseProjectSlashCommand('/model gpt-5.4')).toBeNull();
  });

  it('parses page creation commands', () => {
    expect(parseProjectSlashCommand('/page new Build the web UI shell')).toEqual({
      kind: 'command',
      command: {
        action: 'new',
        description: 'Build the web UI shell',
      },
    });
  });

  it('parses page reference commands', () => {
    expect(parseProjectSlashCommand('/page reference artifact-model')).toEqual({
      kind: 'command',
      command: {
        action: 'reference',
        projectId: 'artifact-model',
      },
    });
  });

  it('parses page unreference aliases', () => {
    expect(parseProjectSlashCommand('/page remove artifact-model')).toEqual({
      kind: 'command',
      command: {
        action: 'unreference',
        projectId: 'artifact-model',
      },
    });
  });

  it('returns usage for invalid commands', () => {
    expect(parseProjectSlashCommand('/page')).toEqual({
      kind: 'invalid',
      message: PROJECT_SLASH_USAGE,
    });
    expect(parseProjectSlashCommand('/page new')).toEqual({
      kind: 'invalid',
      message: 'Usage: /page new <title>',
    });
  });
});
