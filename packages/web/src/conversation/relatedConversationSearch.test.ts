import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../shared/types';
import { listRecentConversationResults, rankRelatedConversationSessions, selectRecentConversationCandidates } from './relatedConversationSearch';

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

describe('selectRecentConversationCandidates', () => {
  it('keeps only recent conversations and boosts the active workspace', () => {
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
      'recent-other',
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
      'closed-other',
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
      'very-old-closed',
    ]);
    expect(results[0]?.sameWorkspace).toBe(true);
    expect(results[0]?.matchedTerms).toEqual([]);
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
});
