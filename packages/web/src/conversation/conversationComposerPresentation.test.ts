import { describe, expect, it } from 'vitest';
import {
  appendMentionedConversationContextDocs,
  dedupeConversationContextDocs,
  formatComposerActionLabel,
  formatParallelJobContextSummary,
  formatParallelJobStatusLabel,
  formatQueuedPromptImageSummary,
  formatQueuedPromptShelfText,
  isAttachableMentionItem,
  mentionItemToConversationContextDoc,
  removeConversationContextDocByPath,
  resolveConversationAutocompleteCatalogDemand,
  resolveConversationContextUsageTokens,
  resolveConversationGitSummaryPresentation,
  selectUnattachedMentionItems,
  truncateConversationShelfText,
} from './conversationComposerPresentation';

describe('conversation composer presentation helpers', () => {
  it('loads autocomplete catalogs only when the current input needs them', () => {
    expect(resolveConversationAutocompleteCatalogDemand('hello')).toEqual({
      needsMemoryData: false,
      needsVaultFiles: false,
    });
    expect(resolveConversationAutocompleteCatalogDemand('ask @proj')).toEqual({
      needsMemoryData: true,
      needsVaultFiles: true,
    });
    expect(resolveConversationAutocompleteCatalogDemand('/model gpt')).toEqual({
      needsMemoryData: false,
      needsVaultFiles: false,
    });
    expect(resolveConversationAutocompleteCatalogDemand('/skill build')).toEqual({
      needsMemoryData: true,
      needsVaultFiles: false,
    });
  });

  it('converts and dedupes mentioned docs by normalized path', () => {
    expect(isAttachableMentionItem({
      kind: 'note',
      id: 'note:one',
      label: 'One',
      path: '/notes/one.md',
    })).toBe(true);
    expect(isAttachableMentionItem({
      kind: 'skill',
      id: 'skill:one',
      label: 'One',
    })).toBe(false);

    expect(mentionItemToConversationContextDoc({
      kind: 'note',
      id: 'note:one',
      label: 'One',
      title: '  Better title  ',
      summary: '  useful  ',
      path: '/notes/one.md',
    })).toEqual({
      path: '/notes/one.md',
      title: 'Better title',
      kind: 'doc',
      mentionId: 'note:one',
      summary: 'useful',
    });

    expect(dedupeConversationContextDocs([
      { path: ' /a.md ', title: '', kind: 'file' },
      { path: '/a.md', title: 'Duplicate', kind: 'file' },
      { path: ' ', title: 'Empty', kind: 'file' },
      { path: '/b.md', title: 'Bee', kind: 'doc' },
    ])).toEqual([
      { path: '/a.md', title: '/a.md', kind: 'file' },
      { path: '/b.md', title: 'Bee', kind: 'doc' },
    ]);

    expect(appendMentionedConversationContextDocs([
      { path: '/a.md', title: 'A', kind: 'file' },
    ], [{
      kind: 'note',
      id: 'note:b',
      label: 'Bee',
      path: ' /b.md ',
    }, {
      kind: 'file',
      id: 'file:a',
      label: 'Duplicate A',
      path: '/a.md',
    }])).toEqual([
      { path: '/a.md', title: 'A', kind: 'file' },
      { path: '/b.md', title: 'Bee', kind: 'doc', mentionId: 'note:b' },
    ]);

    expect(removeConversationContextDocByPath([
      { path: '/a.md', title: 'A', kind: 'file' },
      { path: '/b.md', title: 'Bee', kind: 'doc' },
    ], '/a.md')).toEqual([
      { path: '/b.md', title: 'Bee', kind: 'doc' },
    ]);

    expect(selectUnattachedMentionItems([
      { kind: 'note', id: 'note:a', label: 'A', path: '/a.md' },
      { kind: 'file', id: 'file:b', label: 'B', path: '/b.ts' },
      { kind: 'skill', id: 'skill:c', label: 'C' },
    ], [
      { path: '/a.md', title: 'A', kind: 'doc' },
    ])).toEqual([
      { kind: 'file', id: 'file:b', label: 'B', path: '/b.ts' },
    ]);
  });

  it('formats queued prompt and parallel job shelf text compactly', () => {
    expect(truncateConversationShelfText('one\ntwo\nthree', { maxLines: 2 })).toBe('one\ntwo…');
    expect(truncateConversationShelfText('abcdef', { maxChars: 3 })).toBe('abc…');
    expect(truncateConversationShelfText('one\ntwo\nthree', { maxLines: 1.5 })).toBe('one\ntwo\nthree');
    expect(truncateConversationShelfText('abcdef', { maxChars: 3.5 })).toBe('abcdef');
    expect(truncateConversationShelfText(Array.from({ length: 10 }, (_, index) => `line-${index}`).join('\n'), { maxLines: Number.MAX_SAFE_INTEGER })).toBe('line-0\nline-1\nline-2\nline-3\nline-4\nline-5\nline-6\nline-7…');
    expect(truncateConversationShelfText('a'.repeat(700), { maxChars: Number.MAX_SAFE_INTEGER })).toBe(`${'a'.repeat(640)}…`);
    expect(formatQueuedPromptShelfText('', 1)).toBe('(image only)');
    expect(formatQueuedPromptShelfText('  ', 0)).toBe('(empty queued prompt)');
    expect(formatQueuedPromptImageSummary(2)).toBe('2 images attached');
    expect(formatQueuedPromptImageSummary(1.5)).toBeNull();
    expect(formatParallelJobStatusLabel('importing')).toBe('appending');
    expect(formatParallelJobContextSummary({ imageCount: 1, attachmentRefs: ['a', 'b'] })).toBe('1 image · 2 attachments');
    expect(formatParallelJobContextSummary({ imageCount: 1.5, attachmentRefs: [] })).toBeNull();
    expect(formatParallelJobContextSummary({ imageCount: 0, attachmentRefs: [] })).toBeNull();
  });

  it('formats composer actions and git summary chips', () => {
    expect(formatComposerActionLabel('Follow up')).toBe('followup');
    expect(formatComposerActionLabel('Parallel')).toBe('parallel');
    expect(resolveConversationGitSummaryPresentation(null)).toEqual({ kind: 'none' });
    expect(resolveConversationGitSummaryPresentation({
      branch: 'main',
      hasChanges: false,
      changeCount: 0,
      linesAdded: 0,
      linesDeleted: 0,
    })).toEqual({ kind: 'summary', text: 'clean' });
    expect(resolveConversationGitSummaryPresentation({
      branch: 'main',
      hasChanges: true,
      changeCount: 3,
      linesAdded: 1234,
      linesDeleted: 56,
    })).toEqual({ kind: 'diff', added: '+1,234', deleted: '-56' });
  });

  it('resolves context usage tokens for live and historical sessions', () => {
    const models = [{
      id: 'model-a',
      provider: 'Provider',
      name: 'Model A',
      context: 100000,
      supportedServiceTiers: [],
    }];

    expect(resolveConversationContextUsageTokens({
      isLiveSession: true,
      liveUsage: { tokens: 5000, modelId: 'model-a', segments: [{ label: 'input', tokens: 4000 }] },
      historicalUsage: null,
      models,
      currentModel: null,
      routeModel: null,
    })).toEqual({
      total: 5000,
      contextWindow: 100000,
      segments: [{ label: 'input', tokens: 4000 }],
    });

    expect(resolveConversationContextUsageTokens({
      isLiveSession: true,
      liveUsage: null,
      historicalUsage: null,
      models: [],
      currentModel: null,
      routeModel: null,
    })).toEqual({ total: null, contextWindow: 200000, segments: undefined });

    expect(resolveConversationContextUsageTokens({
      isLiveSession: false,
      liveUsage: null,
      historicalUsage: null,
      models,
      currentModel: 'model-a',
      routeModel: null,
    })).toBeNull();

    expect(resolveConversationContextUsageTokens({
      isLiveSession: false,
      liveUsage: null,
      historicalUsage: { tokens: null, modelId: 'missing-model' },
      models,
      currentModel: null,
      routeModel: null,
    })).toEqual({ total: null, contextWindow: 128000, segments: undefined });
  });
});
