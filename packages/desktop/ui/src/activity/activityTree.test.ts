import { describe, expect, it } from 'vitest';

import type { ExecutionRecord, SessionMeta } from '../shared/types';
import { buildActivityTreeItems, buildConversationActivityId, buildExecutionActivityId, buildRunActivityId } from './activityTree';

function session(overrides: Partial<SessionMeta> & Pick<SessionMeta, 'id' | 'title'>): SessionMeta {
  return {
    id: overrides.id,
    title: overrides.title,
    cwd: overrides.cwd ?? '/repo',
    createdAt: overrides.createdAt ?? '2026-05-12T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-12T10:00:00.000Z',
    isRunning: overrides.isRunning ?? false,
    parentSessionId: overrides.parentSessionId,
  } as SessionMeta;
}

function execution(overrides: Partial<ExecutionRecord> & Pick<ExecutionRecord, 'id'>): ExecutionRecord {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'background-command',
    visibility: overrides.visibility ?? 'primary',
    conversationId: overrides.conversationId,
    title: overrides.title ?? overrides.id,
    status: overrides.status ?? 'running',
    createdAt: overrides.createdAt ?? '2026-05-12T10:01:00.000Z',
    updatedAt: overrides.updatedAt,
    capabilities: overrides.capabilities ?? { canCancel: true, canRerun: false, canFollowUp: false, hasLog: true, hasResult: false },
  };
}

describe('buildActivityTreeItems', () => {
  it('turns conversations into root activity items', () => {
    const items = buildActivityTreeItems({
      conversations: [session({ id: 'conv-1', title: 'Build the thing', isRunning: true })],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: buildConversationActivityId('conv-1'),
        kind: 'conversation',
        title: 'Build the thing',
        status: 'running',
        route: '/conversations/conv-1',
        metadata: expect.objectContaining({ isRunning: true, needsAttention: false }),
      }),
    ]);
  });

  it('preserves caller-provided conversation order', () => {
    const items = buildActivityTreeItems({
      conversations: [
        session({ id: 'pinned', title: 'Pinned thread', updatedAt: '2026-05-12T09:00:00.000Z' }),
        session({ id: 'recent', title: 'Recent thread', updatedAt: '2026-05-12T10:00:00.000Z' }),
      ],
    });

    expect(items.map((activityItem) => activityItem.id)).toEqual([
      buildConversationActivityId('pinned'),
      buildConversationActivityId('recent'),
    ]);
  });

  it('nests child conversations under their parent conversation', () => {
    const items = buildActivityTreeItems({
      conversations: [
        session({ id: 'conv-parent', title: 'Parent conversation', updatedAt: '2026-05-12T10:00:00.000Z' }),
        session({
          id: 'conv-child',
          title: 'Subagent conversation',
          parentSessionId: 'conv-parent',
          updatedAt: '2026-05-12T10:01:00.000Z',
        }),
      ],
    });

    expect(items.find((item) => item.id === buildConversationActivityId('conv-child'))).toEqual(
      expect.objectContaining({ parentId: buildConversationActivityId('conv-parent') }),
    );
  });

  it('nests executions under their source conversation', () => {
    const items = buildActivityTreeItems({
      conversations: [session({ id: 'conv-1', title: 'Build the thing' })],
      executions: [execution({ id: 'run-1', conversationId: 'conv-1', title: 'Visual QA', status: 'running' })],
    });

    expect(items).toEqual([
      expect.objectContaining({ id: buildConversationActivityId('conv-1'), kind: 'conversation' }),
      expect.objectContaining({
        id: buildExecutionActivityId('run-1'),
        kind: 'execution',
        parentId: buildConversationActivityId('conv-1'),
        title: 'Visual QA',
        status: 'running',
        route: '/conversations/conv-1?run=run-1',
      }),
    ]);
    expect(buildRunActivityId('run-1')).toBe(buildExecutionActivityId('run-1'));
  });

  it('skips hidden and unlinked executions', () => {
    const items = buildActivityTreeItems({
      conversations: [session({ id: 'conv-1', title: 'Build the thing' })],
      executions: [
        execution({ id: 'run-hidden', conversationId: 'conv-1', visibility: 'hidden' }),
        execution({ id: 'run-missing', conversationId: 'missing', status: 'completed' }),
      ],
    });

    expect(items.find((item) => item.id === buildExecutionActivityId('run-hidden'))).toBeUndefined();
    expect(items.find((item) => item.id === buildExecutionActivityId('run-missing'))).toBeUndefined();
  });
});
