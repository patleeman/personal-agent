import { describe, expect, it } from 'vitest';
import { formatMemoryCard, parseAndNormalizeMemoryCard } from './memory-card.js';

describe('memory card parsing', () => {
  it('normalizes schema, enforces fixed keys, and truncates lists', () => {
    const raw = JSON.stringify({
      type: 'memory_card',
      session_id: 'wrong-id',
      cwd: '/tmp/other',
      subsystems: ['cli', 'gateway', 'daemon', 'memory', 'resources', 'extra'],
      primary_topics: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
      durable_decisions: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'],
      invariants: ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'],
      pitfalls: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      open_loops: ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'],
      supersedes: 'session-old',
      summary_path: 'wrong/path.md',
      unknown_field: true,
    });

    const card = parseAndNormalizeMemoryCard(raw, {
      sessionFile: '/tmp/s.jsonl',
      sessionId: 'session-1',
      cwd: '/tmp/project',
      transcript: 'USER: test',
      summaryRelativePath: 'workspace/session-1.md',
    });

    expect(card.type).toBe('memory_card');
    expect(card.session_id).toBe('session-1');
    expect(card.cwd).toBe('/tmp/project');
    expect(card.summary_path).toBe('workspace/session-1.md');

    expect(card.subsystems).toHaveLength(5);
    expect(card.primary_topics).toHaveLength(10);
    expect(card.durable_decisions).toHaveLength(6);
    expect(card.invariants).toHaveLength(5);
    expect(card.pitfalls).toHaveLength(5);
    expect(card.open_loops).toHaveLength(5);
    expect(card.supersedes).toBe('session-old');

    const formatted = formatMemoryCard(card);
    const reparsed = JSON.parse(formatted) as Record<string, unknown>;
    expect(Object.keys(reparsed).sort()).toEqual([
      'cwd',
      'durable_decisions',
      'invariants',
      'open_loops',
      'pitfalls',
      'primary_topics',
      'session_id',
      'subsystems',
      'summary_path',
      'supersedes',
      'type',
    ]);
  });

  it('parses fenced JSON responses', () => {
    const card = parseAndNormalizeMemoryCard(
      '```json\n{"subsystems":["memory"],"primary_topics":["qmd"],"durable_decisions":[],"invariants":[],"pitfalls":[],"open_loops":[],"supersedes":null}\n```',
      {
        sessionFile: '/tmp/s.jsonl',
        sessionId: 'session-2',
        cwd: '/tmp/project-2',
        transcript: 'USER: test 2',
        summaryRelativePath: 'workspace/session-2.md',
      },
    );

    expect(card.session_id).toBe('session-2');
    expect(card.subsystems).toEqual(['memory']);
    expect(card.primary_topics).toEqual(['qmd']);
    expect(card.supersedes).toBeNull();
  });
});
