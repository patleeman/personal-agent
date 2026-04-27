import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../shared/types';
import {
  selectVisibleRelatedThreadResults,
  toggleRelatedThreadSelectionIds,
} from './relatedThreadSelection';

function session(id: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    file: `/tmp/${id}.jsonl`,
    timestamp: '2026-04-01T00:00:00.000Z',
    cwd: '/repo',
    cwdSlug: '-repo',
    model: 'model-a',
    title: `Title ${id}`,
    messageCount: 3,
    ...overrides,
  };
}

describe('related thread selection helpers', () => {
  it('keeps selected threads visible even when they are missing from base results', () => {
    const candidate = session('selected', { lastActivityAt: '2026-04-02T00:00:00.000Z' });
    const visible = selectVisibleRelatedThreadResults({
      selectedRelatedThreadIds: ['selected'],
      query: '',
      searchResults: [],
      recentResults: [{
        sessionId: 'recent',
        title: 'Recent',
        cwd: '/repo',
        timestamp: '2026-04-01T00:00:00.000Z',
        snippet: 'recent snippet',
        matchedTerms: [],
        score: 10,
        sameWorkspace: true,
      }],
      candidateById: new Map([['selected', candidate]]),
      searchIndex: { selected: 'a longish selected transcript snippet' },
      summaries: {
        selected: {
          sessionId: 'selected',
          displaySummary: 'selected summary',
          generatedAt: '2026-04-01T00:00:00.000Z',
        },
      },
      workspaceCwd: '/repo',
      limit: 10,
    });

    expect(visible.map((result) => result.sessionId)).toEqual(['selected', 'recent']);
    expect(visible[0]).toMatchObject({
      title: 'Title selected',
      timestamp: '2026-04-02T00:00:00.000Z',
      snippet: 'selected summary',
      reason: 'Same workspace',
      sameWorkspace: true,
    });
  });

  it('dedupes selected ids and respects the result limit', () => {
    const visible = selectVisibleRelatedThreadResults({
      selectedRelatedThreadIds: ['a', 'a'],
      query: 'needle',
      searchResults: [
        { sessionId: 'a', title: 'A', cwd: '/repo', timestamp: 't', snippet: 'a', matchedTerms: [], score: 9, sameWorkspace: true },
        { sessionId: 'b', title: 'B', cwd: '/repo', timestamp: 't', snippet: 'b', matchedTerms: [], score: 8, sameWorkspace: true },
      ],
      recentResults: [],
      candidateById: new Map(),
      searchIndex: {},
      summaries: {},
      workspaceCwd: '/repo',
      limit: 1,
    });

    expect(visible.map((result) => result.sessionId)).toEqual(['a']);
  });

  it('toggles selections while enforcing the maximum', () => {
    expect(toggleRelatedThreadSelectionIds({
      current: ['a'],
      sessionId: 'a',
      maxSelections: 2,
    })).toEqual({ next: [], rejected: false });

    expect(toggleRelatedThreadSelectionIds({
      current: ['a'],
      sessionId: 'b',
      maxSelections: 2,
    })).toEqual({ next: ['a', 'b'], rejected: false });

    expect(toggleRelatedThreadSelectionIds({
      current: ['a', 'b'],
      sessionId: 'c',
      maxSelections: 2,
    })).toEqual({ next: ['a', 'b'], rejected: true });
  });
});
