import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  readSessionMetaMock,
  summarizeSessionFileForPromptMock,
  readCachedRelatedConversationSummaryMock,
  writeCachedRelatedConversationSummaryMock,
} = vi.hoisted(() => ({
  readSessionMetaMock: vi.fn(),
  summarizeSessionFileForPromptMock: vi.fn(),
  readCachedRelatedConversationSummaryMock: vi.fn(),
  writeCachedRelatedConversationSummaryMock: vi.fn(),
}));

vi.mock('./sessions.js', () => ({
  readSessionMeta: readSessionMetaMock,
}));

vi.mock('./liveSessions.js', () => ({
  summarizeSessionFileForPrompt: summarizeSessionFileForPromptMock,
}));

vi.mock('./relatedConversationSummaryCache.js', () => ({
  readCachedRelatedConversationSummary: readCachedRelatedConversationSummaryMock,
  writeCachedRelatedConversationSummary: writeCachedRelatedConversationSummaryMock,
}));

import {
  RELATED_THREADS_CONTEXT_CUSTOM_TYPE,
  buildRelatedConversationContext,
} from './relatedConversationContext.js';

beforeEach(() => {
  readSessionMetaMock.mockReset();
  summarizeSessionFileForPromptMock.mockReset();
  readCachedRelatedConversationSummaryMock.mockReset();
  readCachedRelatedConversationSummaryMock.mockReturnValue(null);
  writeCachedRelatedConversationSummaryMock.mockReset();
});

describe('buildRelatedConversationContext', () => {
  it('builds hidden context from the selected conversations in input order', async () => {
    readSessionMetaMock
      .mockReturnValueOnce({ id: 'conv-1', file: '/sessions/conv-1.jsonl', cwd: '/repo/a', timestamp: '2026-04-10T10:00:00.000Z', title: 'Release signing' })
      .mockReturnValueOnce({ id: 'conv-2', file: '/sessions/conv-2.jsonl', cwd: '/repo/b', timestamp: '2026-04-11T10:00:00.000Z', title: 'Auto mode wakeups' });
    summarizeSessionFileForPromptMock
      .mockResolvedValueOnce('Keep the notarization mapping fix.')
      .mockResolvedValueOnce('Wakeups use durable run callbacks.');

    const result = await buildRelatedConversationContext({
      sessionIds: ['conv-1', 'conv-2'],
      prompt: 'Ship the release flow fix.',
      loaderOptions: { initialModel: 'openai/gpt-5' },
    });

    expect(summarizeSessionFileForPromptMock).toHaveBeenNthCalledWith(
      1,
      '/sessions/conv-1.jsonl',
      '/repo/a',
      'Ship the release flow fix.',
      { initialModel: 'openai/gpt-5' },
    );
    expect(result.summaries.map((summary) => summary.sessionId)).toEqual(['conv-1', 'conv-2']);
    expect(writeCachedRelatedConversationSummaryMock).toHaveBeenCalledWith({
      sessionId: 'conv-1',
      sessionFile: '/sessions/conv-1.jsonl',
      prompt: 'Ship the release flow fix.',
      summary: 'Keep the notarization mapping fix.',
    });
    expect(result.contextMessages).toEqual([
      expect.objectContaining({
        customType: RELATED_THREADS_CONTEXT_CUSTOM_TYPE,
        content: expect.stringContaining('Conversation 1 — Release signing'),
      }),
    ]);

    const content = result.contextMessages[0]?.content ?? '';
    expect(content).toContain('Wakeups use durable run callbacks.');
    expect(content.indexOf('Keep the notarization mapping fix.')).toBeGreaterThan(content.indexOf('Conversation 1 — Release signing'));
    expect(content.indexOf('Keep the notarization mapping fix.')).toBeLessThan(content.indexOf('Workspace: /repo/a'));
  });

  it('rejects blank prompts, missing sessions, and oversized selections', async () => {
    await expect(buildRelatedConversationContext({ sessionIds: ['conv-1'], prompt: '   ' }))
      .rejects.toThrow('prompt required');
    await expect(buildRelatedConversationContext({ sessionIds: [], prompt: 'hello' }))
      .rejects.toThrow('sessionIds required');
    await expect(buildRelatedConversationContext({ sessionIds: ['1', '2', '3', '4'], prompt: 'hello' }))
      .rejects.toThrow('Pick at most 3 related threads.');

    readSessionMetaMock.mockReturnValueOnce(null);
    await expect(buildRelatedConversationContext({ sessionIds: ['missing'], prompt: 'hello' }))
      .rejects.toThrow('Conversation missing not found.');
  });

  it('deduplicates repeated session ids before summarizing', async () => {
    readSessionMetaMock.mockReturnValue({
      id: 'conv-1',
      file: '/sessions/conv-1.jsonl',
      cwd: '/repo/a',
      timestamp: '2026-04-10T10:00:00.000Z',
      title: 'Release signing',
    });
    summarizeSessionFileForPromptMock.mockResolvedValue('Keep the notarization mapping fix.');

    const result = await buildRelatedConversationContext({
      sessionIds: [' conv-1 ', 'conv-1'],
      prompt: 'Ship the release flow fix.',
    });

    expect(readSessionMetaMock).toHaveBeenCalledTimes(1);
    expect(result.summaries).toHaveLength(1);
  });

  it('reuses cached summaries instead of summarizing the same session again', async () => {
    readSessionMetaMock.mockReturnValue({
      id: 'conv-1',
      file: '/sessions/conv-1.jsonl',
      cwd: '/repo/a',
      timestamp: '2026-04-10T10:00:00.000Z',
      title: 'Release signing',
    });
    readCachedRelatedConversationSummaryMock.mockReturnValue('Cached notarization context.');

    const result = await buildRelatedConversationContext({
      sessionIds: ['conv-1'],
      prompt: 'Ship the release flow fix.',
    });

    expect(summarizeSessionFileForPromptMock).not.toHaveBeenCalled();
    expect(writeCachedRelatedConversationSummaryMock).not.toHaveBeenCalled();
    expect(result.summaries[0]?.summary).toBe('Cached notarization context.');
  });
});
