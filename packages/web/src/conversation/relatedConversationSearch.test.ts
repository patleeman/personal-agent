import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummaryRecord, SessionMeta } from '../shared/types';
import { listRecentConversationResults, pickHighConfidenceRelatedConversation, rankRelatedConversationSessions, selectRecentConversationCandidates } from './relatedConversationSearch';

function buildSession(overrides: Partial<SessionMeta> & Pick<SessionMeta, 'id' | 'title' | 'cwd'>): SessionMeta {
  return {
    id: overrides.id,
    file: overrides.file ?? `/sessions/${overrides.id}.jsonl`,
    timestamp: overrides.timestamp ?? '2026-04-10T12:00:00.000Z',
    cwd: overrides.cwd,
    cwdSlug: overrides.cwd.replace(/\//g, '-'),
    model: overrides.model ?? 'openai/gpt-5',
    title: overrides.title,
    messageCount: overrides.messageCount ?? 6,
    ...(overrides.lastActivityAt ? { lastActivityAt: overrides.lastActivityAt } : {}),
    ...(overrides.isLive !== undefined ? { isLive: overrides.isLive } : {}),
    ...(overrides.isRunning !== undefined ? { isRunning: overrides.isRunning } : {}),
  };
}

function buildSummary(overrides: Partial<ConversationSummaryRecord> & Pick<ConversationSummaryRecord, 'sessionId'>): ConversationSummaryRecord {
  return {
    sessionId: overrides.sessionId,
    fingerprint: overrides.fingerprint ?? '1:2:3',
    title: overrides.title ?? 'Summary title',
    cwd: overrides.cwd ?? '/repo/current',
    displaySummary: overrides.displaySummary ?? 'Changed transcript context suggestions.',
    outcome: overrides.outcome ?? 'Finished the suggested context plan.',
    status: overrides.status ?? 'done',
    promptSummary: overrides.promptSummary ?? 'Use this context when working on suggested conversation context.',
    searchText: overrides.searchText ?? 'suggested context related thread conversation recovery',
    keyTerms: overrides.keyTerms ?? ['suggested context', 'conversation recovery'],
    filesTouched: overrides.filesTouched ?? ['packages/web/src/components/DraftRelatedThreadsPanel.tsx'],
    updatedAt: overrides.updatedAt ?? '2026-04-13T09:00:00.000Z',
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('selectRecentConversationCandidates', () => {
  it('keeps only recent conversations from the active workspace', () => {
    const sessions: SessionMeta[] = [
      buildSession({
        id: 'older',
        title: 'Older thread',
        cwd: '/repo/other',
        lastActivityAt: '2026-04-01T09:00:00.000Z',
      }),
      buildSession({
        id: 'recent-other',
        title: 'Recent other workspace',
        cwd: '/repo/other',
        lastActivityAt: '2026-04-12T09:00:00.000Z',
      }),
      buildSession({
        id: 'recent-current',
        title: 'Recent current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-11T09:00:00.000Z',
      }),
    ];

    expect(selectRecentConversationCandidates(sessions, {
      workspaceCwd: '/repo/current',
      nowMs: Date.parse('2026-04-13T09:00:00.000Z'),
    }).map((session) => session.id)).toEqual([
      'recent-current',
    ]);
  });

  it('can keep only closed conversations when requested', () => {
    const sessions: SessionMeta[] = [
      buildSession({
        id: 'closed-current',
        title: 'Closed current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-12T09:00:00.000Z',
      }),
      buildSession({
        id: 'live-current',
        title: 'Live current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-13T08:00:00.000Z',
        isLive: true,
      }),
      buildSession({
        id: 'running-other',
        title: 'Running other workspace',
        cwd: '/repo/other',
        lastActivityAt: '2026-04-13T07:00:00.000Z',
        isRunning: true,
      }),
      buildSession({
        id: 'closed-other',
        title: 'Closed other workspace',
        cwd: '/repo/other',
        lastActivityAt: '2026-04-11T09:00:00.000Z',
      }),
    ];

    expect(selectRecentConversationCandidates(sessions, {
      workspaceCwd: '/repo/current',
      nowMs: Date.parse('2026-04-13T09:00:00.000Z'),
      recentWindowDays: null,
      closedOnly: true,
    }).map((session) => session.id)).toEqual([
      'closed-current',
    ]);
  });

  it('honors a tighter recent window for related-thread candidates', () => {
    const sessions: SessionMeta[] = [
      buildSession({
        id: 'recent-current',
        title: 'Recent current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-12T09:00:00.000Z',
      }),
      buildSession({
        id: 'stale-other',
        title: 'Stale other workspace',
        cwd: '/repo/other',
        lastActivityAt: '2026-04-09T08:59:59.000Z',
      }),
    ];

    expect(selectRecentConversationCandidates(sessions, {
      workspaceCwd: '/repo/current',
      nowMs: Date.parse('2026-04-13T09:00:00.000Z'),
      recentWindowDays: 3,
    }).map((session) => session.id)).toEqual(['recent-current']);
  });

  it('uses the default recent window for unsafe window day values', () => {
    const sessions: SessionMeta[] = [
      buildSession({
        id: 'recent-current',
        title: 'Recent current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-12T09:00:00.000Z',
      }),
      buildSession({
        id: 'stale-current',
        title: 'Stale current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-03-01T09:00:00.000Z',
      }),
    ];

    expect(selectRecentConversationCandidates(sessions, {
      workspaceCwd: '/repo/current',
      nowMs: Date.parse('2026-04-13T09:00:00.000Z'),
      recentWindowDays: Number.MAX_SAFE_INTEGER + 1,
    }).map((session) => session.id)).toEqual(['recent-current']);
  });

  it('uses the current clock for unsafe current-time values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T09:00:00.000Z'));
    const sessions: SessionMeta[] = [
      buildSession({
        id: 'recent-current',
        title: 'Recent current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-12T09:00:00.000Z',
      }),
      buildSession({
        id: 'stale-current',
        title: 'Stale current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-03-01T09:00:00.000Z',
      }),
    ];

    expect(selectRecentConversationCandidates(sessions, {
      workspaceCwd: '/repo/current',
      nowMs: -Number.MAX_SAFE_INTEGER - 1,
    }).map((session) => session.id)).toEqual(['recent-current']);
  });

  it('sorts malformed recent timestamps after valid recent conversations', () => {
    const sessions: SessionMeta[] = [
      buildSession({
        id: 'malformed-current',
        title: 'Malformed current workspace',
        cwd: '/repo/current',
        lastActivityAt: '9999',
      }),
      buildSession({
        id: 'recent-current',
        title: 'Recent current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-12T09:00:00.000Z',
      }),
    ];

    expect(selectRecentConversationCandidates(sessions, {
      workspaceCwd: '/repo/current',
      recentWindowDays: null,
    }).map((session) => session.id)).toEqual(['recent-current', 'malformed-current']);
  });
});

describe('listRecentConversationResults', () => {
  it('lists the most recent closed conversations even when the draft query is blank', () => {
    const sessions: SessionMeta[] = [
      buildSession({
        id: 'very-old-closed',
        title: 'Very old closed thread',
        cwd: '/repo/other',
        lastActivityAt: '2026-03-10T09:00:00.000Z',
      }),
      buildSession({
        id: 'recent-current',
        title: 'Recent current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-12T09:00:00.000Z',
      }),
      buildSession({
        id: 'live-current',
        title: 'Live current workspace',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-13T08:00:00.000Z',
        isLive: true,
      }),
    ];

    const results = listRecentConversationResults(sessions, {
      workspaceCwd: '/repo/current',
      nowMs: Date.parse('2026-04-13T09:00:00.000Z'),
      closedOnly: true,
      limit: 5,
    });

    expect(results.map((result) => result.sessionId)).toEqual([
      'recent-current',
    ]);
    expect(results[0]?.sameWorkspace).toBe(true);
    expect(results[0]?.matchedTerms).toEqual([]);
  });

  it('uses the default recent-result limit for malformed numeric limits', () => {
    const sessions: SessionMeta[] = Array.from({ length: 3 }, (_, index) => buildSession({
      id: `recent-${index}`,
      title: `Recent ${index}`,
      cwd: '/repo/current',
      lastActivityAt: `2026-04-1${index}T09:00:00.000Z`,
    }));

    expect(listRecentConversationResults(sessions, {
      workspaceCwd: '/repo/current',
      limit: 1.5,
    })).toHaveLength(3);
  });

  it('caps expensive recent-result limits', () => {
    const sessions: SessionMeta[] = Array.from({ length: 150 }, (_, index) => buildSession({
      id: `recent-${index}`,
      title: `Recent ${index}`,
      cwd: '/repo/current',
      lastActivityAt: '2026-04-12T09:00:00.000Z',
    }));

    expect(listRecentConversationResults(sessions, {
      workspaceCwd: '/repo/current',
      recentWindowDays: null,
      limit: 5000,
    })).toHaveLength(100);
  });
});

describe('rankRelatedConversationSessions', () => {
  it('matches recent conversation text and boosts the active workspace', () => {
    const sessions: SessionMeta[] = [
      buildSession({
        id: 'workspace-match',
        title: 'Release signing flow',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-12T09:00:00.000Z',
      }),
      buildSession({
        id: 'text-match',
        title: 'Misc thread',
        cwd: '/repo/other',
        lastActivityAt: '2026-04-12T12:00:00.000Z',
      }),
    ];

    const results = rankRelatedConversationSessions({
      sessions,
      searchIndex: {
        'workspace-match': 'Investigated notarization failure and release signing flow for the desktop app.',
        'text-match': 'Investigated notarization failure and release signing flow for the desktop app.',
      },
      query: 'release signing',
      workspaceCwd: '/repo/current',
      nowMs: Date.parse('2026-04-13T09:00:00.000Z'),
    });

    expect(results[0]?.sessionId).toBe('workspace-match');
    expect(results[0]?.sameWorkspace).toBe(true);
    expect(results[0]?.matchedTerms).toEqual(['release', 'signing']);
    expect(results[1]?.sessionId).toBe('text-match');
  });

  it('builds a readable snippet around the best text match', () => {
    const sessions: SessionMeta[] = [
      buildSession({
        id: 'snippet',
        title: 'Desktop release',
        cwd: '/repo/current',
      }),
    ];

    const [result] = rankRelatedConversationSessions({
      sessions,
      searchIndex: {
        snippet: 'First we looked at logs. Then notarization failed unless APPLE_PASSWORD was mapped for the release flow. After that we retried.',
      },
      query: 'apple password',
      workspaceCwd: '/repo/current',
      nowMs: Date.parse('2026-04-13T09:00:00.000Z'),
    });

    expect(result?.snippet.toLowerCase()).toContain('apple_password');
    expect(result?.snippet.length).toBeGreaterThan(20);
  });

  it('keeps matching when the draft query contains extra filler words', () => {
    const sessions: SessionMeta[] = [
      buildSession({
        id: 'long-query',
        title: 'Release signing flow',
        cwd: '/repo/current',
        lastActivityAt: '2026-04-12T09:00:00.000Z',
      }),
    ];

    const [result] = rankRelatedConversationSessions({
      sessions,
      searchIndex: {
        'long-query': 'Investigated why release signing kept failing during macOS notarization and retried the release flow.',
      },
      query: 'can you help figure out why release signing keeps failing on mac',
      workspaceCwd: '/repo/current',
      nowMs: Date.parse('2026-04-13T09:00:00.000Z'),
    });

    expect(result?.sessionId).toBe('long-query');
    expect(result?.matchedTerms).toEqual(expect.arrayContaining(['release', 'signing', 'failing']));
  });

  it('returns no matches for a blank query', () => {
    const sessions: SessionMeta[] = [buildSession({ id: 'one', title: 'Thread one', cwd: '/repo/current' })];

    expect(rankRelatedConversationSessions({
      sessions,
      searchIndex: { one: 'Thread one details' },
      query: '   ',
    })).toEqual([]);
  });

  it('uses the default ranked-result limit for unsafe numeric limits', () => {
    const sessions: SessionMeta[] = Array.from({ length: 12 }, (_, index) => buildSession({
      id: `match-${index}`,
      title: `Release signing ${index}`,
      cwd: '/repo/current',
    }));

    expect(rankRelatedConversationSessions({
      sessions,
      searchIndex: Object.fromEntries(sessions.map((session) => [session.id, 'release signing flow'])),
      query: 'release signing',
      limit: Number.MAX_SAFE_INTEGER + 1,
    })).toHaveLength(9);
  });

  it('caps expensive ranked-result limits', () => {
    const sessions: SessionMeta[] = Array.from({ length: 150 }, (_, index) => buildSession({
      id: `match-${index}`,
      title: `Release signing ${index}`,
      cwd: '/repo/current',
    }));

    expect(rankRelatedConversationSessions({
      sessions,
      searchIndex: Object.fromEntries(sessions.map((session) => [session.id, 'release signing flow'])),
      query: 'release signing',
      limit: 5000,
    })).toHaveLength(100);
  });

  it('uses generated summaries for ranking reasons and high-confidence preselection', () => {
    const sessions: SessionMeta[] = [
      buildSession({ id: 'summary-match', title: 'Unclear old title', cwd: '/repo/current' }),
      buildSession({ id: 'runner-up', title: 'Related context', cwd: '/repo/current' }),
    ];

    const results = rankRelatedConversationSessions({
      sessions,
      searchIndex: {
        'summary-match': '',
        'runner-up': 'context recovery',
      },
      summaries: {
        'summary-match': buildSummary({ sessionId: 'summary-match' }),
      },
      query: 'suggested context conversation recovery',
      workspaceCwd: '/repo/current',
      nowMs: Date.parse('2026-04-13T09:00:00.000Z'),
    });

    expect(results[0]?.sessionId).toBe('summary-match');
    expect(results[0]?.reason).toContain('Same workspace');
    expect(results[0]?.reason).toContain('Touched packages/web/src/components/DraftRelatedThreadsPanel.tsx');
    expect(pickHighConfidenceRelatedConversation(results)?.sessionId).toBe('summary-match');
  });
});
