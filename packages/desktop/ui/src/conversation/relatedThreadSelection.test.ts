import { describe, expect, it } from 'vitest';

import type { SessionMeta } from '../shared/types';
import {
  buildRelatedThreadCandidateLookup,
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
  it('builds candidate lookup data from session candidates', () => {
    const first = session('a');
    const second = session('b');

    const lookup = buildRelatedThreadCandidateLookup([first, second]);

    expect(lookup.candidateIds).toEqual(['a', 'b']);
    expect(lookup.candidateById.get('a')).toBe(first);
    expect(lookup.candidateById.get('b')).toBe(second);
  });

  it('keeps selected threads visible even when they are missing from base results', () => {
    const candidate = session('selected', { lastActivityAt: '2026-04-02T00:00:00.000Z' });
    const visible = selectVisibleRelatedThreadResults({
      selectedRelatedThreadIds: ['selected'],
      query: '',
      searchResults: [],
      recentResults: [
        {
          sessionId: 'recent',
          title: 'Recent',
          cwd: '/repo',
          timestamp: '2026-04-01T00:00:00.000Z',
          snippet: 'recent snippet',
          matchedTerms: [],
          score: 10,
          sameWorkspace: true,
        },
      ],
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

  it('rejects fractional visible related-thread limits instead of letting slice truncate them', () => {
    const visible = selectVisibleRelatedThreadResults({
      selectedRelatedThreadIds: [],
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
      limit: 1.5,
    });

    expect(visible).toEqual([]);
  });

  it('caps expensive visible related-thread limits', () => {
    const searchResults = Array.from({ length: 150 }, (_, index) => ({
      sessionId: `match-${index}`,
      title: `Match ${index}`,
      cwd: '/repo',
      timestamp: 't',
      snippet: 'match',
      matchedTerms: [],
      score: 150 - index,
      sameWorkspace: true,
    }));

    const visible = selectVisibleRelatedThreadResults({
      selectedRelatedThreadIds: [],
      query: 'needle',
      searchResults,
      recentResults: [],
      candidateById: new Map(),
      searchIndex: {},
      summaries: {},
      workspaceCwd: '/repo',
      limit: 5000,
    });

    expect(visible).toHaveLength(100);
  });

  it('toggles selections while enforcing the maximum', () => {
    expect(
      toggleRelatedThreadSelectionIds({
        current: ['a'],
        sessionId: 'a',
        maxSelections: 2,
      }),
    ).toEqual({ next: [], rejected: false });

    expect(
      toggleRelatedThreadSelectionIds({
        current: ['a'],
        sessionId: 'b',
        maxSelections: 2,
      }),
    ).toEqual({ next: ['a', 'b'], rejected: false });

    expect(
      toggleRelatedThreadSelectionIds({
        current: ['a', 'b'],
        sessionId: 'c',
        maxSelections: 2,
      }),
    ).toEqual({ next: ['a', 'b'], rejected: true });
  });

  it('keeps selected related threads constrained to available candidates', () => {
    expect(
      pruneRelatedThreadSelectionIds(
        ['a', 'missing', 'b'],
        new Map([
          ['a', session('a')],
          ['b', session('b')],
        ]),
      ),
    ).toEqual(['a', 'b']);
  });

  it('selects missing related-thread search and summary metadata ids', () => {
    expect(
      selectMissingRelatedThreadSearchIndexIds({
        draft: true,
        inputText: 'find context',
        selectedThreadIds: [],
        candidateIds: ['a', 'b', 'c'],
        searchIndex: { a: 'indexed', c: '' },
      }),
    ).toEqual(['b']);

    expect(
      selectMissingRelatedThreadSearchIndexIds({
        draft: true,
        inputText: ' ',
        selectedThreadIds: [],
        candidateIds: ['a'],
        searchIndex: {},
      }),
    ).toEqual([]);

    expect(
      selectMissingRelatedThreadSummaryIds({
        draft: true,
        candidateIds: ['a', 'b'],
        summaries: {
          a: {
            sessionId: 'a',
            displaySummary: 'A summary',
            generatedAt: '2026-04-01T00:00:00.000Z',
          },
        },
      }),
    ).toEqual(['b']);

    expect(
      selectMissingRelatedThreadSummaryIds({
        draft: false,
        candidateIds: ['a'],
        summaries: {},
      }),
    ).toEqual([]);
  });

  it('auto-selects ranked results, preserves manual choices, and clears stale related-thread preselection', () => {
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
    const secondResult = {
      ...strongResult,
      sessionId: 'second',
      title: 'Second',
      score: 420,
    } as const;

    expect(
      resolveRelatedThreadPreselectionUpdate({
        draft: true,
        query: 'matching prompt context',
        selectedThreadIds: [],
        autoSelectedThreadIds: [],
        searchResults: [strongResult, secondResult],
        maxAutoSelections: 5,
      }),
    ).toEqual({
      selectedThreadIds: ['strong', 'second'],
      autoSelectedThreadIds: ['strong', 'second'],
      changed: true,
    });

    expect(
      resolveRelatedThreadPreselectionUpdate({
        draft: true,
        query: 'matching prompt context',
        selectedThreadIds: ['manual'],
        autoSelectedThreadIds: [],
        searchResults: [strongResult],
        maxAutoSelections: 5,
      }),
    ).toEqual({
      selectedThreadIds: ['manual'],
      autoSelectedThreadIds: [],
      changed: false,
    });

    expect(
      resolveRelatedThreadPreselectionUpdate({
        draft: true,
        query: 'hi',
        selectedThreadIds: ['strong'],
        autoSelectedThreadIds: ['strong'],
        searchResults: [strongResult],
        maxAutoSelections: 5,
      }),
    ).toEqual({
      selectedThreadIds: [],
      autoSelectedThreadIds: [],
      changed: true,
    });

    expect(
      resolveRelatedThreadPreselectionUpdate({
        draft: true,
        query: 'hi',
        selectedThreadIds: ['strong', 'manual'],
        autoSelectedThreadIds: ['strong'],
        searchResults: [strongResult],
        maxAutoSelections: 5,
      }),
    ).toEqual({
      selectedThreadIds: ['manual'],
      autoSelectedThreadIds: [],
      changed: true,
    });

    expect(
      resolveRelatedThreadPreselectionUpdate({
        draft: true,
        query: 'hi',
        selectedThreadIds: ['strong', 'manual'],
        autoSelectedThreadIds: ['strong', 'missing'],
        searchResults: [strongResult],
        maxAutoSelections: 5,
      }),
    ).toEqual({
      selectedThreadIds: ['manual'],
      autoSelectedThreadIds: [],
      changed: true,
    });

    expect(
      resolveRelatedThreadPreselectionUpdate({
        draft: true,
        query: 'matching prompt context',
        selectedThreadIds: [],
        autoSelectedThreadIds: ['strong'],
        searchResults: [strongResult],
        maxAutoSelections: 5,
      }),
    ).toEqual({
      selectedThreadIds: [],
      autoSelectedThreadIds: [],
      changed: true,
    });

    expect(
      resolveRelatedThreadPreselectionUpdate({
        draft: true,
        query: 'matching prompt context',
        selectedThreadIds: ['manual'],
        autoSelectedThreadIds: ['strong'],
        searchResults: [strongResult],
        maxAutoSelections: 5,
      }),
    ).toEqual({
      selectedThreadIds: ['manual'],
      autoSelectedThreadIds: [],
      changed: true,
    });

    expect(
      resolveRelatedThreadPreselectionUpdate({
        draft: true,
        query: 'matching prompt context',
        selectedThreadIds: [],
        autoSelectedThreadIds: [],
        searchResults: [strongResult, secondResult],
        maxAutoSelections: 1.5,
      }),
    ).toEqual({
      selectedThreadIds: [],
      autoSelectedThreadIds: [],
      changed: false,
    });

    expect(
      resolveRelatedThreadPreselectionUpdate({
        draft: true,
        query: 'matching prompt context',
        selectedThreadIds: [],
        autoSelectedThreadIds: [],
        searchResults: Array.from({ length: 12 }, (_, index) => ({
          ...strongResult,
          sessionId: `result-${index}`,
          title: `Result ${index}`,
        })),
        maxAutoSelections: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({
      selectedThreadIds: ['result-0', 'result-1', 'result-2', 'result-3', 'result-4'],
      autoSelectedThreadIds: ['result-0', 'result-1', 'result-2', 'result-3', 'result-4'],
      changed: true,
    });
  });
});
