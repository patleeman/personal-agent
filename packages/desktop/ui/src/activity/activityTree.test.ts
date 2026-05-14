import { describe, expect, it } from 'vitest';

import type { DurableRunRecord, SessionMeta } from '../shared/types';
import { buildActivityTreeItems, buildConversationActivityId, buildRunActivityId } from './activityTree';

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

function run(overrides: Partial<DurableRunRecord> & Pick<DurableRunRecord, 'runId'>): DurableRunRecord {
  return {
    runId: overrides.runId,
    paths: overrides.paths ?? {
      root: '/runs/run-1',
      manifestPath: '/runs/run-1/manifest.json',
      statusPath: '/runs/run-1/status.json',
      checkpointPath: '/runs/run-1/checkpoint.json',
      eventsPath: '/runs/run-1/events.jsonl',
      outputLogPath: '/runs/run-1/output.log',
      resultPath: '/runs/run-1/result.json',
    },
    manifest: overrides.manifest,
    status: overrides.status,
    checkpoint: overrides.checkpoint,
    result: overrides.result,
    problems: overrides.problems ?? [],
    recoveryAction: overrides.recoveryAction ?? 'none',
  } as DurableRunRecord;
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

  it('nests runs under their source conversation when metadata links them', () => {
    const items = buildActivityTreeItems({
      conversations: [session({ id: 'conv-1', title: 'Build the thing' })],
      runs: [
        run({
          runId: 'run-1',
          manifest: {
            version: 1,
            id: 'run-1',
            kind: 'background-agent',
            resumePolicy: 'never',
            createdAt: '2026-05-12T10:01:00.000Z',
            spec: { conversationId: 'conv-1', title: 'Visual QA' },
          },
          status: {
            version: 1,
            runId: 'run-1',
            status: 'running',
            createdAt: '2026-05-12T10:01:00.000Z',
            updatedAt: '2026-05-12T10:02:00.000Z',
            activeAttempt: 1,
          },
        }),
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({ id: buildConversationActivityId('conv-1'), kind: 'conversation' }),
      expect.objectContaining({
        id: buildRunActivityId('run-1'),
        kind: 'run',
        parentId: buildConversationActivityId('conv-1'),
        title: 'Visual QA',
        status: 'running',
        route: '/conversations/conv-1?run=run-1',
      }),
    ]);
  });

  it('uses manifest source metadata to nest runs under conversations', () => {
    const items = buildActivityTreeItems({
      conversations: [session({ id: 'conv-source', title: 'Source conversation' })],
      runs: [
        run({
          runId: 'run-source',
          manifest: {
            version: 1,
            id: 'run-source',
            kind: 'background-agent',
            resumePolicy: 'never',
            createdAt: '2026-05-12T10:01:00.000Z',
            spec: { title: 'Source-linked run' },
            source: { type: 'conversation', id: 'conv-source' },
          },
        }),
      ],
    });

    expect(items.find((item) => item.id === buildRunActivityId('run-source'))).toEqual(
      expect.objectContaining({ parentId: buildConversationActivityId('conv-source') }),
    );
  });

  it('skips live conversation runtime runs', () => {
    const items = buildActivityTreeItems({
      conversations: [session({ id: 'conv-1', title: 'Build the thing' })],
      runs: [
        run({
          runId: 'conversation-live-conv-1',
          manifest: {
            version: 1,
            id: 'conversation-live-conv-1',
            kind: 'conversation',
            resumePolicy: 'continue',
            createdAt: '2026-05-12T10:03:00.000Z',
            spec: { mode: 'web-live-session', conversationId: 'conv-1' },
          },
        }),
      ],
    });

    expect(items).toEqual([expect.objectContaining({ id: buildConversationActivityId('conv-1') })]);
  });

  it('skips unlinked runs', () => {
    const items = buildActivityTreeItems({
      conversations: [session({ id: 'conv-1', title: 'Build the thing' })],
      runs: [
        run({
          runId: 'run-2',
          manifest: {
            version: 1,
            id: 'run-2',
            kind: 'shell',
            resumePolicy: 'never',
            createdAt: '2026-05-12T10:03:00.000Z',
            spec: { title: 'npm test', conversationId: 'missing' },
          },
          status: {
            version: 1,
            runId: 'run-2',
            status: 'completed',
            createdAt: '2026-05-12T10:03:00.000Z',
            updatedAt: '2026-05-12T10:04:00.000Z',
            activeAttempt: 1,
          },
        }),
      ],
    });

    expect(items.find((item) => item.id === buildRunActivityId('run-2'))).toBeUndefined();
  });
});
