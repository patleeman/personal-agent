import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../shared/types';
import {
  pruneRelatedThreadSelectionIds,
  resolveRelatedThreadPreselectionUpdate,
  selectMissingRelatedThreadSearchIndexIds,
  selectMissingRelatedThreadSummaryIds,
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

  it('keeps selected related threads constrained to available candidates', () => {
    expect(pruneRelatedThreadSelectionIds(
      ['a', 'missing', 'b'],
      new Map([['a', session('a')], ['b', session('b')]]),
    )).toEqual(['a', 'b']);
  });

  it('selects missing related-thread search and summary metadata ids', () => {
    expect(selectMissingRelatedThreadSearchIndexIds({
      draft: true,
      inputText: 'find context',
      selectedThreadIds: [],
      candidateIds: ['a', 'b', 'c'],
      searchIndex: { a: 'indexed', c: '' },
    })).toEqual(['b']);

    expect(selectMissingRelatedThreadSearchIndexIds({
      draft: true,
      inputText: ' ',
      selectedThreadIds: [],
      candidateIds: ['a'],
      searchIndex: {},
    })).toEqual([]);

    expect(selectMissingRelatedThreadSummaryIds({
      draft: true,
      candidateIds: ['a', 'b'],
      summaries: {
        a: {
          sessionId: 'a',
          displaySummary: 'A summary',
          generatedAt: '2026-04-01T00:00:00.000Z',
        },
      },
    })).toEqual(['b']);

    expect(selectMissingRelatedThreadSummaryIds({
      draft: false,
      candidateIds: ['a'],
      summaries: {},
    })).toEqual([]);
  });

  it('auto-selects, preserves manual choices, and clears stale related-thread preselection', () => {
    const strongResult = {
      sessionId: 'strong',
      title: 'Strong',
      cwd: '/repo',
      timestamp: 't',
      snippet: 'matching prompt context',
      matchedTerms: ['matching', 'prompt', 'context'],
      score: 500,
      sameWorkspace: true,
      summary: {
        sessionId: 'strong',
        displaySummary: 'strong summary',
        generatedAt: '2026-04-01T00:00:00.000Z',
      },
      reason: 'Strong semantic match',
    } as const;

    expect(resolveRelatedThreadPreselectionUpdate({
      draft: true,
      query: 'matching prompt context',
      selectedThreadIds: [],
      autoSelectedThreadId: null,
      searchResults: [strongResult],
    })).toEqual({
      selectedThreadIds: ['strong'],
      autoSelectedThreadId: 'strong',
      changed: true,
    });

    expect(resolveRelatedThreadPreselectionUpdate({
      draft: true,
      query: 'matching prompt context',
      selectedThreadIds: ['manual'],
      autoSelectedThreadId: null,
      searchResults: [strongResult],
    })).toEqual({
      selectedThreadIds: ['manual'],
      autoSelectedThreadId: null,
      changed: false,
    });

    expect(resolveRelatedThreadPreselectionUpdate({
      draft: true,
      query: 'short',
      selectedThreadIds: ['strong'],
      autoSelectedThreadId: 'strong',
      searchResults: [strongResult],
    })).toEqual({
      selectedThreadIds: [],
      autoSelectedThreadId: null,
      changed: true,
    });

    expect(resolveRelatedThreadPreselectionUpdate({
      draft: true,
      query: 'matching prompt context',
      selectedThreadIds: ['strong'],
      autoSelectedThreadId: 'strong',
      searchResults: [strongResult],
    })).toEqual({
      selectedThreadIds: ['strong'],
      autoSelectedThreadId: 'strong',
      changed: false,
    });
  });
});
