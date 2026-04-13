import { describe, expect, it } from 'vitest';
import { buildConversationGroupLabels, getConversationGroupLabel, groupConversationItemsByCwd } from './conversationCwdGroups.js';

describe('conversationCwdGroups', () => {
  it('merges cwd groups that only differ by trailing slashes', () => {
    const groups = groupConversationItemsByCwd(
      [
        { id: 'alpha-a', cwd: '/tmp/alpha-worktree' },
        { id: 'alpha-b', cwd: '/tmp/alpha-worktree/' },
      ],
      (item) => item.cwd,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('/tmp/alpha-worktree');
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['alpha-a', 'alpha-b']);
  });

  it('disambiguates workspaces that share the same basename', () => {
    const labelsByCwd = buildConversationGroupLabels([
      '/Users/patrickc.lee/personal/personal-agent',
      '/Users/patrickc.lee/Documents/personal-agent',
    ]);

    expect(getConversationGroupLabel('/Users/patrickc.lee/personal/personal-agent', { labelsByCwd })).toBe('personal/personal-agent');
    expect(getConversationGroupLabel('/Users/patrickc.lee/Documents/personal-agent', { labelsByCwd })).toBe('Documents/personal-agent');
  });
});
