import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  persistTraceSuggestedContext: vi.fn(),
  readConversationSummary: vi.fn(),
  readSessionBlocks: vi.fn(),
  readSessionMeta: vi.fn(),
  scheduleConversationSearchIndexing: vi.fn(),
  searchIndexedConversationDocuments: vi.fn(),
}));

vi.mock('stopword', () => ({
  eng: [],
  removeStopwords: (tokens: string[]) => tokens,
}));

vi.mock('@personal-agent/extensions/backend/conversations', () => ({
  persistTraceSuggestedContext: mocks.persistTraceSuggestedContext,
  readConversationSummary: mocks.readConversationSummary,
  readSessionBlocks: mocks.readSessionBlocks,
  readSessionMeta: mocks.readSessionMeta,
  scheduleConversationSearchIndexing: mocks.scheduleConversationSearchIndexing,
  searchIndexedConversationDocuments: mocks.searchIndexedConversationDocuments,
}));

import { providePromptContext, warmPointers } from './backend.js';

describe('system-suggested-context backend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deduplicates indexed pointer candidates before injecting context', async () => {
    mocks.readSessionBlocks.mockResolvedValue({ totalBlocks: 0 });
    mocks.searchIndexedConversationDocuments.mockResolvedValue([
      {
        sessionId: 'conv-related',
        title: 'Architecture Review',
        cwd: '/repo',
        timestamp: '2026-05-01T00:00:00.000Z',
        searchText: 'architecture review routing',
      },
      {
        sessionId: 'conv-related',
        title: 'Architecture Review',
        cwd: '/repo',
        timestamp: '2026-05-01T00:00:00.000Z',
        searchText: 'architecture review routing',
      },
    ]);

    await warmPointers({ prompt: 'architecture routing review', currentConversationId: 'conv-new', currentCwd: '/repo' }, {} as never);
    const result = await providePromptContext(
      { prompt: 'architecture routing review', conversationId: 'conv-new', currentCwd: '/repo' },
      {} as never,
    );

    expect(result.contextMessages).toHaveLength(1);
    expect(result.contextMessages[0]?.content.match(/id: conv-related/g)).toHaveLength(1);
  });
});
