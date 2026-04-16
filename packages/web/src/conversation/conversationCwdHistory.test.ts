import { describe, expect, it } from 'vitest';
import { summarizeConversationCwd } from './conversationCwdHistory';

describe('conversation cwd history helpers', () => {
  it('summarizes cwd labels using the trailing path segment', () => {
    expect(summarizeConversationCwd('/Users/patrickc.lee/personal/personal-agent')).toBe('personal-agent');
    expect(summarizeConversationCwd('~/worktrees/dd-source/')).toBe('dd-source');
    expect(summarizeConversationCwd('/')).toBe('/');
  });
});
