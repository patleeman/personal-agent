import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listSessionsMock,
  readSessionMetaMock,
  readSessionSearchTextMock,
  readConversationSummaryMock,
} = vi.hoisted(() => ({
  listSessionsMock: vi.fn(),
  readSessionMetaMock: vi.fn(),
  readSessionSearchTextMock: vi.fn(),
  readConversationSummaryMock: vi.fn(),
}));

vi.mock('./sessions.js', () => ({
  listSessions: listSessionsMock,
  readSessionMeta: readSessionMetaMock,
  readSessionSearchText: readSessionSearchTextMock,
}));

vi.mock('./conversationSummaries.js', () => ({
  readConversationSummary: readConversationSummaryMock,
}));

import {
  RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE,
  buildRelatedConversationPointers,
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

beforeEach(() => {
  listSessionsMock.mockReset();
  readSessionMetaMock.mockReset();
  readSessionSearchTextMock.mockReset();
  readConversationSummaryMock.mockReset();
  listSessionsMock.mockReturnValue([]);
  readSessionSearchTextMock.mockReturnValue('');
  readConversationSummaryMock.mockReturnValue(null);
} );

describe('buildRelatedConversationPointers', () => {
  it('includes manual selections even when weak', () => {
    readSessionMetaMock.mockReturnValue({ ...baseMeta, id: 'manual-1', title: 'Totally unrelated' });

    const result = buildRelatedConversationPointers({
      prompt: 'Fix the notarization release flow',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      selectedSessionIds: ['manual-1'],
    });

    expect(result.pointers).toHaveLength(1);
    expect(result.pointers[0]).toMatchObject({ sessionId: 'manual-1', source: 'manual', weakMatch: true });
    expect(result.warnings).toEqual([]);
    expect(result.contextMessages[0]).toMatchObject({ customType: RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE });
  });

  it('fills remaining slots with auto-ranked conversations above threshold', () => {
    readSessionMetaMock.mockReturnValue({ ...baseMeta, id: 'manual-1', title: 'Manual release' });
    readConversationSummaryMock.mockImplementation((sessionId: string) => sessionId === 'auto-1'
      ? { displaySummary: 'Notarization release upload fix', promptSummary: '', keyTerms: [], filesTouched: [] }
      : null);
    readSessionSearchTextMock.mockImplementation((sessionId: string) => sessionId === 'auto-1'
      ? 'release notarization Apple credentials'
      : 'bananas only');
    listSessionsMock.mockReturnValue([
      { ...baseMeta, id: 'current', title: 'Current', messageCount: 1 },
      { ...baseMeta, id: 'auto-1', title: 'Notarization release fix', messageCount: 6, lastActivityAt: '2026-04-20T10:00:00.000Z' },
      { ...baseMeta, id: 'auto-weak', title: 'Bananas', messageCount: 6 },
    ]);

    const result = buildRelatedConversationPointers({
      prompt: 'Fix the notarization release flow',
      currentConversationId: 'current',
      currentCwd: '/repo/a',
      selectedSessionIds: ['manual-1'],
    });

    expect(result.pointers.map((pointer) => pointer.sessionId)).toEqual(['manual-1', 'auto-1']);
    expect(result.contextMessages[0]?.content).toContain('Do not treat these pointer previews as factual source context');
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
});
