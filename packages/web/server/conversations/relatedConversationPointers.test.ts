import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listSessionsMock,
  readSessionMetaMock,
  readSessionSearchTextMock,
  readConversationSummaryMock,
  scheduleConversationSearchIndexingMock,
  searchIndexedConversationDocumentsMock,
} = vi.hoisted(() => ({
  listSessionsMock: vi.fn(),
  readSessionMetaMock: vi.fn(),
  readSessionSearchTextMock: vi.fn(),
  readConversationSummaryMock: vi.fn(),
  scheduleConversationSearchIndexingMock: vi.fn(),
  searchIndexedConversationDocumentsMock: vi.fn(),
}));

vi.mock('./sessions.js', () => ({
  listSessions: listSessionsMock,
  readSessionMeta: readSessionMetaMock,
  readSessionSearchText: readSessionSearchTextMock,
}));

vi.mock('./conversationSummaries.js', () => ({
  readConversationSummary: readConversationSummaryMock,
}));

vi.mock('./conversationSearchIndex.js', () => ({
  scheduleConversationSearchIndexing: scheduleConversationSearchIndexingMock,
  searchIndexedConversationDocuments: searchIndexedConversationDocumentsMock,
}));

import {
  RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE,
  buildRelatedConversationPointers,
  clearRelatedConversationPointerCache,
  readCachedRelatedConversationPointers,
  warmRelatedConversationPointerCache,
} from './relatedConversationPointers.js';

const baseMeta = {
  file: '/sessions/conv.jsonl',
  timestamp: '2026-04-10T10:00:00.000Z',
  cwd: '/repo/a',
  cwdSlug: 'repo-a',
  model: 'gpt',
  messageCount: 4,
  title: 'Release signing',
};
const TEST_NOW_MS = Date.parse('2026-04-22T10:00:00.000Z');

beforeEach(() => {
  listSessionsMock.mockReset();
  readSessionMetaMock.mockReset();
  readSessionSearchTextMock.mockReset();
  readConversationSummaryMock.mockReset();
  scheduleConversationSearchIndexingMock.mockReset();
  searchIndexedConversationDocumentsMock.mockReset();
  clearRelatedConversationPointerCache();
  listSessionsMock.mockReturnValue([]);
  readSessionSearchTextMock.mockReturnValue('');
  readConversationSummaryMock.mockReturnValue(null);
  searchIndexedConversationDocumentsMock.mockReturnValue([]);
} );

describe('buildRelatedConversationPointers', () => {
  it('includes manual selections even when weak', () => {
    readSessionMetaMock.mockReturnValue({ ...baseMeta, id: 'manual-1', title: 'Totally unrelated' });

    const result = buildRelatedConversationPointers({
      prompt: 'Fix the notarization release flow',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      selectedSessionIds: ['manual-1'],
      nowMs: TEST_NOW_MS,
    });

    expect(result.pointers).toHaveLength(1);
    expect(result.pointers[0]).toMatchObject({ sessionId: 'manual-1', source: 'manual', weakMatch: true });
    expect(result.warnings).toEqual([]);
    expect(result.contextMessages[0]).toMatchObject({ customType: RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE });
  });

  it('serves warmed pointer results from a short-lived cache', () => {
    searchIndexedConversationDocumentsMock.mockReturnValue([{ sessionId: 'cached-hit', title: 'Release signing cached', cwd: '/repo/a', timestamp: '2026-04-21T10:00:00.000Z', lastActivityAt: '2026-04-21T10:00:00.000Z', searchText: 'release signing fix' }]);

    warmRelatedConversationPointerCache({
      prompt: 'Fix release signing',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: TEST_NOW_MS,
    });

    expect(scheduleConversationSearchIndexingMock).toHaveBeenCalledTimes(1);
    expect(readCachedRelatedConversationPointers({
      prompt: 'Fix release signing',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: TEST_NOW_MS + 30_000,
    })?.pointers.map((pointer) => pointer.sessionId)).toEqual(['cached-hit']);
    expect(readCachedRelatedConversationPointers({
      prompt: 'Fix release signing',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: TEST_NOW_MS + 61_000,
    })).toBeNull();
  });

  it('fills remaining slots with auto-ranked conversations above threshold', () => {
    readSessionMetaMock.mockReturnValue({ ...baseMeta, id: 'manual-1', title: 'Manual release' });
    readConversationSummaryMock.mockImplementation((sessionId: string) => sessionId === 'auto-1'
      ? { displaySummary: 'Notarization release upload fix', promptSummary: '', keyTerms: [], filesTouched: [] }
      : null);
    readSessionSearchTextMock.mockImplementation((sessionId: string) => sessionId === 'auto-1'
      ? 'release notarization Apple credentials'
      : 'bananas only');
    searchIndexedConversationDocumentsMock.mockReturnValue([
      { sessionId: 'auto-1', title: 'Notarization release fix', cwd: '/repo/a', timestamp: '2026-04-20T10:00:00.000Z', lastActivityAt: '2026-04-20T10:00:00.000Z', searchText: 'release notarization Apple credentials' },
    ]);

    const result = buildRelatedConversationPointers({
      prompt: 'Fix the notarization release flow',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      selectedSessionIds: ['manual-1'],
      nowMs: TEST_NOW_MS,
    });

    expect(result.pointers.map((pointer) => pointer.sessionId)).toEqual(['manual-1', 'auto-1']);
    expect(result.contextMessages[0]?.content).toContain('Do not treat these pointer previews as factual source context');
  });

  it('does not auto-rank conversations from generic prompt terms alone', () => {
    readConversationSummaryMock.mockImplementation((sessionId: string) => sessionId === 'generic-1'
      ? { displaySummary: 'Paused before rewriting our private repo history', promptSummary: '', keyTerms: [], filesTouched: [] }
      : null);
    readSessionSearchTextMock.mockReturnValue('our app looks good now');
    listSessionsMock.mockReturnValue([
      { ...baseMeta, id: 'generic-1', title: 'Sanitize Git History for Open Source', messageCount: 6, lastActivityAt: '2026-04-20T10:00:00.000Z' },
    ]);

    const result = buildRelatedConversationPointers({
      prompt: 'Why is our app bundle 730MB?',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: TEST_NOW_MS,
    });

    expect(result.pointers).toEqual([]);
    expect(result.contextMessages).toEqual([]);
  });

  it('keeps feature terms after aggressive stopword removal', () => {
    readConversationSummaryMock.mockReturnValue({ displaySummary: 'Dictation was added with a mic button and transcription provider', promptSummary: '', keyTerms: [], filesTouched: [] });
    readSessionSearchTextMock.mockReturnValue('dictation whisper transcription streaming');
    searchIndexedConversationDocumentsMock.mockReturnValue([
      { sessionId: 'dictation-1', title: 'Add Whisper Dictation to PA', cwd: '/repo/a', timestamp: '2026-04-20T10:00:00.000Z', lastActivityAt: '2026-04-20T10:00:00.000Z', searchText: 'dictation whisper transcription streaming' },
    ]);

    const result = buildRelatedConversationPointers({
      prompt: "Dictation isn't working. Is there a way to stream dictation?",
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: TEST_NOW_MS,
    });

    expect(result.pointers.map((pointer) => pointer.sessionId)).toEqual(['dictation-1']);
    expect(result.pointers[0]?.reasons.join(' ')).toContain('dictation');
  });

  it('uses indexed search text for auto ranking without reading session files', () => {
    readConversationSummaryMock.mockImplementation((sessionId: string) => sessionId === 'summary-hit'
      ? { displaySummary: '', promptSummary: '', searchText: 'release signing fix', keyTerms: [], filesTouched: [] }
      : null);
    searchIndexedConversationDocumentsMock.mockReturnValue([
      { sessionId: 'summary-hit', title: 'Mac app packaging', cwd: '/repo/a', timestamp: '2026-04-20T10:00:00.000Z', lastActivityAt: '2026-04-20T10:00:00.000Z', searchText: 'release signing fix' },
    ]);

    const result = buildRelatedConversationPointers({
      prompt: 'Fix the release signing flow',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: TEST_NOW_MS,
    });

    expect(result.pointers.map((pointer) => pointer.sessionId)).toEqual(['summary-hit']);
    expect(readSessionSearchTextMock).not.toHaveBeenCalled();
  });

  it('does not read transcript files for auto ranking unless explicitly requested', () => {
    const metas = Array.from({ length: 40 }, (_, index) => ({
      ...baseMeta,
      id: `candidate-${index}`,
      title: `Candidate ${index}`,
      messageCount: 6,
      timestamp: '2026-04-21T10:00:00.000Z',
      lastActivityAt: '2026-04-21T10:00:00.000Z',
    }));
    listSessionsMock.mockReturnValue(metas);
    readSessionSearchTextMock.mockImplementation((sessionId: string) => sessionId === 'candidate-39'
      ? 'needle release signing fix'
      : 'bananas only');

    const result = buildRelatedConversationPointers({
      prompt: 'Find the needle release signing fix',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: TEST_NOW_MS,
    });

    expect(result.pointers).toEqual([]);
    expect(readSessionSearchTextMock).not.toHaveBeenCalled();
  });

  it('omits missing manual selections after retry and warns', () => {
    readSessionMetaMock.mockReturnValue(null);

    const result = buildRelatedConversationPointers({
      prompt: 'Fix release flow',
      selectedSessionIds: ['missing-1'],
    });

    expect(readSessionMetaMock).toHaveBeenCalledTimes(2);
    expect(result.pointers).toEqual([]);
    expect(result.contextMessages).toEqual([]);
    expect(result.warnings).toEqual(['Selected related conversation missing-1 could not be read and was omitted.']);
  });

  it('uses the default pointer limit for fractional limits', () => {
    readSessionMetaMock.mockImplementation((sessionId: string) => ({
      ...baseMeta,
      id: sessionId,
      title: `Manual ${sessionId}`,
    }));

    const result = buildRelatedConversationPointers({
      prompt: 'Fix the notarization release flow',
      selectedSessionIds: ['manual-1', 'manual-2', 'manual-3', 'manual-4'],
      limit: 2.5,
    });

    expect(result.pointers.map((pointer) => pointer.sessionId)).toEqual([
      'manual-1',
      'manual-2',
      'manual-3',
      'manual-4',
    ]);
  });

  it('only auto-ranks recent conversations', () => {
    readConversationSummaryMock.mockReturnValue({ displaySummary: 'release signing fix', promptSummary: '', keyTerms: [], filesTouched: [] });
    readSessionSearchTextMock.mockReturnValue('release signing fix');
    searchIndexedConversationDocumentsMock.mockReturnValue([
      { sessionId: 'recent', title: 'Release signing recent', cwd: '/repo/a', timestamp: '2026-04-21T10:00:00.000Z', lastActivityAt: '2026-04-21T10:00:00.000Z', searchText: 'release signing fix' },
    ]);

    const result = buildRelatedConversationPointers({
      prompt: 'Fix the release signing flow',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: TEST_NOW_MS,
    });

    expect(result.pointers.map((pointer) => pointer.sessionId)).toEqual(['recent']);
    expect(searchIndexedConversationDocumentsMock).toHaveBeenCalledWith(expect.objectContaining({
      recentWindowMs: 3 * 24 * 60 * 60 * 1000,
    }));
  });

  it('skips auto candidates with malformed activity timestamps', () => {
    readConversationSummaryMock.mockReturnValue({ displaySummary: 'release signing fix', promptSummary: '', keyTerms: [], filesTouched: [] });
    readSessionSearchTextMock.mockReturnValue('release signing fix');
    searchIndexedConversationDocumentsMock.mockReturnValue([
      { sessionId: 'valid-time', title: 'Release signing valid', cwd: '/repo/a', timestamp: '2026-04-21T10:00:00.000Z', lastActivityAt: '2026-04-21T10:00:00.000Z', searchText: 'release signing fix' },
    ]);

    const result = buildRelatedConversationPointers({
      prompt: 'Fix the release signing flow',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      nowMs: TEST_NOW_MS,
    });

    expect(result.pointers.map((pointer) => pointer.sessionId)).toEqual(['valid-time']);
  });
});
