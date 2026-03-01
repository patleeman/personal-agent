import { describe, expect, it } from 'vitest';
import {
  buildMemoryCandidatesBlock,
  filterHitsByTtl,
  parseQmdMemoryCardHits,
  shouldInjectMemoryCards,
  type MemoryCardHit,
} from './helpers';

function createHit(sessionId: string, score = 0.9): MemoryCardHit {
  return {
    score,
    file: `qmd://memory_cards/workspace/${sessionId}.json`,
    card: {
      type: 'memory_card',
      session_id: sessionId,
      cwd: '/tmp/project',
      subsystems: ['memory'],
      primary_topics: ['qmd', 'memory_cards'],
      durable_decisions: [`decision-${sessionId}`],
      invariants: [`invariant-${sessionId}`],
      pitfalls: [`pitfall-${sessionId}`],
      open_loops: [`loop-${sessionId}`],
      supersedes: null,
      summary_path: `workspace/${sessionId}.md`,
    },
  };
}

describe('memory-cards helpers', () => {
  it('filters hits by TTL cutoff', () => {
    const nowMs = Date.UTC(2026, 1, 1);
    const hits = [createHit('old', 0.8), createHit('new', 0.9)];

    const filtered = filterHitsByTtl({
      hits,
      nowMs,
      ttlDays: 90,
      getMtimeMs: (hit) => {
        if (hit.card.session_id === 'new') {
          return nowMs - 10 * 24 * 60 * 60 * 1000;
        }
        return nowMs - 120 * 24 * 60 * 60 * 1000;
      },
    });

    expect(filtered.map((hit) => hit.card.session_id)).toEqual(['new']);
  });

  it('packs injection block under token cap', () => {
    const hits = [createHit('s1', 0.99), createHit('s2', 0.95), createHit('s3', 0.94)];

    const block = buildMemoryCandidatesBlock({
      hits,
      cwd: '/tmp/project',
      maxCards: 3,
      maxTokens: 80,
    });

    expect(block).toContain('MEMORY_CANDIDATES');
    expect(block).toContain('session_id=s1');
    // Token cap should prevent all cards from being included.
    expect(block.includes('session_id=s3')).toBe(false);
  });

  it('gates injection by score threshold unless recall intent', () => {
    expect(shouldInjectMemoryCards({
      topScore: 0.8,
      prompt: 'normal prompt',
      threshold: 0.55,
    })).toBe(true);

    expect(shouldInjectMemoryCards({
      topScore: 0.2,
      prompt: 'normal prompt',
      threshold: 0.55,
    })).toBe(false);

    expect(shouldInjectMemoryCards({
      topScore: 0.2,
      prompt: 'can you recall what we decided last time?',
      threshold: 0.55,
    })).toBe(true);
  });

  it('parses qmd --json --full output rows into card hits', () => {
    const raw = JSON.stringify([
      {
        score: 0.91,
        file: 'qmd://memory_cards/workspace/s1.json',
        body: JSON.stringify({
          type: 'memory_card',
          session_id: 's1',
          cwd: '/tmp/project',
          subsystems: ['memory'],
          primary_topics: ['qmd'],
          durable_decisions: ['d1'],
          invariants: [],
          pitfalls: [],
          open_loops: [],
          supersedes: null,
          summary_path: 'workspace/s1.md',
        }),
      },
    ]);

    const hits = parseQmdMemoryCardHits(raw);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.card.session_id).toBe('s1');
    expect(hits[0]?.score).toBe(0.91);
  });
});
