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
  resolveConversationGitSummaryPresentation,
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
  });

  it('formats queued prompt and parallel job shelf text compactly', () => {
    expect(truncateConversationShelfText('one\ntwo\nthree', { maxLines: 2 })).toBe('one\ntwo…');
    expect(truncateConversationShelfText('abcdef', { maxChars: 3 })).toBe('abc…');
    expect(formatQueuedPromptShelfText('', 1)).toBe('(image only)');
    expect(formatQueuedPromptShelfText('  ', 0)).toBe('(empty queued prompt)');
    expect(formatQueuedPromptImageSummary(2)).toBe('2 images attached');
    expect(formatParallelJobStatusLabel('importing')).toBe('appending');
    expect(formatParallelJobContextSummary({ imageCount: 1, attachmentRefs: ['a', 'b'] })).toBe('1 image · 2 attachments');
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
});
