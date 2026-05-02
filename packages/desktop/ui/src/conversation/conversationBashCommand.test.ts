import { describe, expect, it } from 'vitest';
import { parseWholeLineBashCommand } from './conversationBashCommand';

describe('parseWholeLineBashCommand', () => {
  it('parses whole-line bash commands with ! and !! prefixes', () => {
    expect(parseWholeLineBashCommand('!git status')).toEqual({
      command: 'git status',
      excludeFromContext: false,
    });
    expect(parseWholeLineBashCommand('  !!npm test  ')).toEqual({
      command: 'npm test',
      excludeFromContext: true,
    });
  });

  it('ignores empty bang commands and inline bash syntax', () => {
    expect(parseWholeLineBashCommand('!')).toBeNull();
    expect(parseWholeLineBashCommand('!!')).toBeNull();
    expect(parseWholeLineBashCommand('!{pwd}')).toBeNull();
  });

  it('ignores normal prompts', () => {
    expect(parseWholeLineBashCommand('please run !git status')).toBeNull();
    expect(parseWholeLineBashCommand('/run git status')).toBeNull();
  });
});
