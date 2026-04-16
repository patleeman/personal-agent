import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../shared/types';
import { buildConversationCwdHistory, summarizeConversationCwd } from './conversationCwdHistory';

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: overrides.id ?? 'conv-1',
    file: overrides.file ?? '/tmp/conv-1.jsonl',
    timestamp: overrides.timestamp ?? '2026-03-30T12:00:00.000Z',
    cwd: overrides.cwd ?? '/tmp/project-a',
    cwdSlug: overrides.cwdSlug ?? 'project-a',
    model: overrides.model ?? 'gpt-test',
    title: overrides.title ?? 'Conversation',
    messageCount: overrides.messageCount ?? 0,
    ...overrides,
  };
}

describe('conversation cwd history helpers', () => {
  it('builds a unique cwd history with the current draft cwd first', () => {
    const sessions = [
      createSession({ id: 'conv-1', cwd: '/tmp/project-a' }),
      createSession({ id: 'conv-2', cwd: '/tmp/project-b' }),
      createSession({ id: 'conv-3', cwd: '/tmp/project-a' }),
    ];

    expect(buildConversationCwdHistory(sessions, '/tmp/project-c')).toEqual([
      '/tmp/project-c',
      '/tmp/project-a',
      '/tmp/project-b',
    ]);
  });

  it('drops empty and synthetic draft cwd values', () => {
    const sessions = [
      createSession({ id: 'conv-1', cwd: 'Draft' }),
      createSession({ id: 'conv-2', cwd: '   ' }),
      createSession({ id: 'conv-3', cwd: '/tmp/project-a' }),
    ];

    expect(buildConversationCwdHistory(sessions, '   ')).toEqual(['/tmp/project-a']);
  });

  it('summarizes cwd labels using the trailing path segment', () => {
    expect(summarizeConversationCwd('/Users/patrickc.lee/personal/personal-agent')).toBe('personal-agent');
    expect(summarizeConversationCwd('~/worktrees/dd-source/')).toBe('dd-source');
    expect(summarizeConversationCwd('/')).toBe('/');
  });
});
