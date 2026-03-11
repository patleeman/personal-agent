import { describe, expect, it } from 'vitest';
import { parseProjectSlashCommand, PROJECT_SLASH_USAGE } from './projectSlashCommand';

describe('parseProjectSlashCommand', () => {
  it('returns null for non-project slash commands', () => {
    expect(parseProjectSlashCommand('/model gpt-5.4')).toBeNull();
  });

  it('parses project creation commands', () => {
    expect(parseProjectSlashCommand('/project new Build the web UI shell')).toEqual({
      kind: 'command',
      command: {
        action: 'new',
        description: 'Build the web UI shell',
      },
    });
  });

  it('parses project reference commands', () => {
    expect(parseProjectSlashCommand('/project reference artifact-model')).toEqual({
      kind: 'command',
      command: {
        action: 'reference',
        projectId: 'artifact-model',
      },
    });
  });

  it('parses project unreference aliases', () => {
    expect(parseProjectSlashCommand('/project remove artifact-model')).toEqual({
      kind: 'command',
      command: {
        action: 'unreference',
        projectId: 'artifact-model',
      },
    });
  });

  it('returns usage for invalid commands', () => {
    expect(parseProjectSlashCommand('/project')).toEqual({
      kind: 'invalid',
      message: PROJECT_SLASH_USAGE,
    });
    expect(parseProjectSlashCommand('/project new')).toEqual({
      kind: 'invalid',
      message: 'Usage: /project new <description>',
    });
  });
});
