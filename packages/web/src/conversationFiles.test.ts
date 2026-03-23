import { describe, expect, it } from 'vitest';
import {
  getConversationFileTargetFromSearch,
  resolveConversationFileTarget,
  setConversationFileTargetInSearch,
} from './conversationFiles.js';

describe('conversation file search params', () => {
  it('stores and restores the modal target while preserving unrelated params', () => {
    const search = setConversationFileTargetInSearch('?artifact=demo', {
      cwd: '/repo',
      file: 'packages/web/src/pages/ConversationPage.tsx',
    });

    expect(search).toBe('?artifact=demo&peekCwd=%2Frepo&peekFile=packages%2Fweb%2Fsrc%2Fpages%2FConversationPage.tsx');
    expect(getConversationFileTargetFromSearch(search)).toEqual({
      cwd: '/repo',
      file: 'packages/web/src/pages/ConversationPage.tsx',
    });
    expect(setConversationFileTargetInSearch(search, null)).toBe('?artifact=demo');
  });
});

describe('resolveConversationFileTarget', () => {
  it('keeps workspace-relative paths anchored to the current conversation cwd', () => {
    expect(resolveConversationFileTarget('packages/web/src/App.tsx', '/repo')).toEqual({
      cwd: '/repo',
      file: 'packages/web/src/App.tsx',
    });
  });

  it('resolves dot-relative paths against the current conversation cwd', () => {
    expect(resolveConversationFileTarget('../README.md', '/repo/packages/web/src')).toEqual({
      cwd: '/repo/packages/web/src',
      file: '/repo/packages/web/README.md',
    });
  });

  it('opens absolute and home-relative paths from their containing folders', () => {
    expect(resolveConversationFileTarget('/Users/patrick/notes/today.md', '/repo')).toEqual({
      cwd: '/Users/patrick/notes',
      file: '/Users/patrick/notes/today.md',
    });
    expect(resolveConversationFileTarget('~/notes/today.md', '/repo')).toEqual({
      cwd: '~/notes',
      file: '~/notes/today.md',
    });
  });
});
