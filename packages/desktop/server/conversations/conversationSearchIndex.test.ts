import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listSessionsMock = vi.hoisted(() => vi.fn());
const readSessionSearchTextMock = vi.hoisted(() => vi.fn());
const readConversationSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('./sessions.js', () => ({
  listSessions: listSessionsMock,
  readSessionSearchText: readSessionSearchTextMock,
}));

vi.mock('./conversationSummaries.js', () => ({
  readConversationSummary: readConversationSummaryMock,
}));

afterEach(async () => {
  const mod = await import('./conversationSearchIndex.js');
  mod.resetConversationSearchIndexForTests();
  vi.resetAllMocks();
  delete process.env.PERSONAL_AGENT_STATE_ROOT;
});

describe('conversationSearchIndex', () => {
  it('indexes changed sessions and searches recent FTS documents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-search-index-'));
    process.env.PERSONAL_AGENT_STATE_ROOT = root;
    const sessionFile = join(root, 'session.jsonl');
    writeFileSync(sessionFile, '{"type":"session"}\n{"type":"message"}\n');
    listSessionsMock.mockReturnValue([{
      id: 'session-1',
      file: sessionFile,
      timestamp: '2026-04-21T10:00:00.000Z',
      lastActivityAt: '2026-04-21T10:00:00.000Z',
      cwd: '/repo/a',
      cwdSlug: 'repo-a',
      model: 'gpt',
      title: 'Release signing',
      messageCount: 2,
    }]);
    readConversationSummaryMock.mockReturnValue({
      displaySummary: 'Fixed notarization release upload',
      outcome: '',
      promptSummary: '',
      searchText: '',
      keyTerms: [],
      filesTouched: [],
    });
    readSessionSearchTextMock.mockReturnValue('apple credentials notarization');

    const mod = await import('./conversationSearchIndex.js');
    expect(mod.indexConversationSearchBatch({ maxSessions: 10, maxDurationMs: 1000 })).toEqual({ indexed: 1, remaining: 0 });

    expect(mod.searchIndexedConversationDocuments({
      terms: ['notarization'],
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: Date.parse('2026-04-22T10:00:00.000Z'),
      recentWindowMs: 3 * 24 * 60 * 60 * 1000,
      limit: 5,
    }).map((candidate) => candidate.sessionId)).toEqual(['session-1']);

    expect(mod.searchIndexedConversationDocuments({
      terms: ['notarization'],
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: Date.parse('2026-04-30T10:00:00.000Z'),
      recentWindowMs: 3 * 24 * 60 * 60 * 1000,
      limit: 5,
    })).toEqual([]);
  });
});
