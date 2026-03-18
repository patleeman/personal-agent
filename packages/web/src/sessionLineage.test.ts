import { describe, expect, it } from 'vitest';
import {
  buildNestedSessionRows,
  resolveSessionLineageAutoOpen,
  resolveSessionParentConversationId,
} from './sessionLineage.js';
import type { DurableRunRecord, SessionMeta } from './types';

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-123',
    file: '/tmp/conv-123.jsonl',
    timestamp: '2026-03-18T00:00:00.000Z',
    cwd: '/repo',
    cwdSlug: 'repo',
    model: 'openai/gpt-5.4',
    title: 'Parent conversation',
    messageCount: 4,
    ...overrides,
  };
}

function createRun(overrides: Partial<DurableRunRecord> = {}): DurableRunRecord {
  return {
    runId: 'run-subagent-123',
    paths: {
      root: '/tmp/runs/run-subagent-123',
      manifestPath: '/tmp/runs/run-subagent-123/manifest.json',
      statusPath: '/tmp/runs/run-subagent-123/status.json',
      checkpointPath: '/tmp/runs/run-subagent-123/checkpoint.json',
      eventsPath: '/tmp/runs/run-subagent-123/events.jsonl',
      outputLogPath: '/tmp/runs/run-subagent-123/output.log',
      resultPath: '/tmp/runs/run-subagent-123/result.json',
    },
    manifest: {
      version: 1,
      id: 'run-subagent-123',
      kind: 'background-run',
      resumePolicy: 'manual',
      createdAt: '2026-03-18T00:00:00.000Z',
      spec: {
        taskSlug: 'subagent',
      },
      source: {
        type: 'tool',
        id: 'conv-123',
      },
    },
    status: {
      version: 1,
      runId: 'run-subagent-123',
      status: 'running',
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:01:00.000Z',
      activeAttempt: 1,
      startedAt: '2026-03-18T00:00:10.000Z',
    },
    checkpoint: {
      version: 1,
      runId: 'run-subagent-123',
      updatedAt: '2026-03-18T00:01:00.000Z',
      payload: {},
    },
    problems: [],
    recoveryAction: 'none',
    ...overrides,
  };
}

describe('sessionLineage', () => {
  it('prefers direct parent session lineage when present', () => {
    const runsById = new Map<string, DurableRunRecord>();
    const child = createSession({ id: 'child-1', parentSessionId: 'conv-123' });

    expect(resolveSessionParentConversationId(child, runsById)).toBe('conv-123');
  });

  it('derives subagent parent lineage from the source run', () => {
    const runsById = new Map<string, DurableRunRecord>([
      ['run-subagent-123', createRun()],
    ]);
    const child = createSession({
      id: 'child-1',
      sourceRunId: 'run-subagent-123',
    });

    expect(resolveSessionParentConversationId(child, runsById)).toBe('conv-123');
  });

  it('builds nested rows in parent-first order', () => {
    const runsById = new Map<string, DurableRunRecord>([
      ['run-subagent-123', createRun()],
    ]);
    const rows = buildNestedSessionRows([
      createSession({ id: 'conv-123', title: 'Parent conversation' }),
      createSession({ id: 'sibling-1', title: 'Sibling conversation', file: '/tmp/sibling-1.jsonl' }),
      createSession({ id: 'child-1', title: 'Child conversation', file: '/tmp/child-1.jsonl', sourceRunId: 'run-subagent-123' }),
    ], runsById);

    expect(rows.map((row) => ({ id: row.session.id, depth: row.depth }))).toEqual([
      { id: 'conv-123', depth: 0 },
      { id: 'child-1', depth: 1 },
      { id: 'sibling-1', depth: 0 },
    ]);
  });

  it('auto-opens new child sessions under visible open parents', () => {
    const runsById = new Map<string, DurableRunRecord>([
      ['run-subagent-123', createRun()],
    ]);

    const result = resolveSessionLineageAutoOpen({
      sessions: [
        createSession({ id: 'conv-123' }),
        createSession({ id: 'child-1', file: '/tmp/child-1.jsonl', sourceRunId: 'run-subagent-123' }),
      ],
      runsById,
      openIds: ['conv-123'],
      pinnedIds: [],
      knownSessionIds: ['conv-123'],
      pendingSessionIds: [],
    });

    expect(result.changed).toBe(true);
    expect(result.nextOpenIds).toEqual(['conv-123', 'child-1']);
    expect(result.nextPinnedIds).toEqual([]);
    expect(result.nextPendingSessionIds).toEqual([]);
  });

  it('auto-pins new child sessions under visible pinned parents', () => {
    const runsById = new Map<string, DurableRunRecord>([
      ['run-subagent-123', createRun()],
    ]);

    const result = resolveSessionLineageAutoOpen({
      sessions: [
        createSession({ id: 'conv-123' }),
        createSession({ id: 'child-1', file: '/tmp/child-1.jsonl', sourceRunId: 'run-subagent-123' }),
      ],
      runsById,
      openIds: [],
      pinnedIds: ['conv-123'],
      knownSessionIds: ['conv-123'],
      pendingSessionIds: [],
    });

    expect(result.changed).toBe(true);
    expect(result.nextOpenIds).toEqual([]);
    expect(result.nextPinnedIds).toEqual(['conv-123', 'child-1']);
    expect(result.nextPendingSessionIds).toEqual([]);
  });
});
