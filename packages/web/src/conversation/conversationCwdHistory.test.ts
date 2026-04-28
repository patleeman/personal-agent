import { describe, expect, it } from 'vitest';
import { summarizeConversationCwd, truncateConversationCwdFromFront } from './conversationCwdHistory';

describe('conversation cwd history helpers', () => {
  it('summarizes cwd labels using the trailing path segment', () => {
    expect(summarizeConversationCwd('/Users/patrickc.lee/personal/personal-agent')).toBe('personal-agent');
    expect(summarizeConversationCwd('~/worktrees/dd-source/')).toBe('dd-source');
    expect(summarizeConversationCwd('/')).toBe('/');
  });

  it('truncates cwd paths from the front while keeping the tail visible', () => {
    expect(truncateConversationCwdFromFront('/Users/patrickc.lee/personal/personal-agent', 24)).toBe('…personal/personal-agent');
    expect(truncateConversationCwdFromFront('~/workingdir/dd-source', 64)).toBe('~/workingdir/dd-source');
    expect(truncateConversationCwdFromFront('/tmp/project', 1)).toBe('…');
  });

  it('uses the default truncation limit for unsafe max character values', () => {
    const cwd = `/Users/patrick/${'nested/'.repeat(12)}personal-agent`;

    expect(truncateConversationCwdFromFront(cwd, Number.MAX_SAFE_INTEGER + 1)).toBe(
      truncateConversationCwdFromFront(cwd),
    );
    expect(truncateConversationCwdFromFront(cwd, 24.5)).toBe(
      truncateConversationCwdFromFront(cwd),
    );
  });
});
