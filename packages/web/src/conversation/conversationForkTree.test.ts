import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../shared/types';
import { buildConversationForkTree } from './conversationForkTree';

function session(input: Partial<SessionMeta> & { id: string; title?: string; parentSessionId?: string }): SessionMeta {
  return {
    id: input.id,
    file: `/tmp/${input.id}.jsonl`,
    timestamp: input.timestamp ?? '2026-01-01T00:00:00.000Z',
    cwd: '/tmp',
    cwdSlug: 'tmp',
    model: 'test-model',
    title: input.title ?? input.id,
    messageCount: input.messageCount ?? 1,
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.lastActivityAt ? { lastActivityAt: input.lastActivityAt } : {}),
    ...(input.isRunning ? { isRunning: input.isRunning } : {}),
  };
}

describe('buildConversationForkTree', () => {
  it('returns null for conversations without relatives', () => {
    expect(buildConversationForkTree([session({ id: 'solo' })], 'solo')).toBeNull();
  });

  it('builds the whole fork family from the root when the active conversation is nested', () => {
    const tree = buildConversationForkTree([
      session({ id: 'root', title: 'Root' }),
      session({ id: 'sibling', title: 'Sibling', parentSessionId: 'root', lastActivityAt: '2026-01-03T00:00:00.000Z' }),
      session({ id: 'child', title: 'Child', parentSessionId: 'root', lastActivityAt: '2026-01-02T00:00:00.000Z' }),
      session({ id: 'grandchild', title: 'Grandchild', parentSessionId: 'child' }),
    ], 'grandchild');

    expect(tree?.rootId).toBe('root');
    expect(tree?.relatedCount).toBe(3);
    expect(tree?.nodes.map((node) => ({
      id: node.session.id,
      depth: node.depth,
      childCount: node.childCount,
      isAncestor: node.isAncestor,
      isCurrent: node.isCurrent,
    }))).toEqual([
      { id: 'root', depth: 0, childCount: 2, isAncestor: true, isCurrent: false },
      { id: 'sibling', depth: 1, childCount: 0, isAncestor: false, isCurrent: false },
      { id: 'child', depth: 1, childCount: 1, isAncestor: true, isCurrent: false },
      { id: 'grandchild', depth: 2, childCount: 0, isAncestor: false, isCurrent: true },
    ]);
  });
});
