import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../local/reloadState';
import {
  buildDraftConversationAttachmentsStorageKey,
  buildDraftConversationComposerStorageKey,
  buildDraftConversationCwdStorageKey,
  buildDraftConversationModelStorageKey,
  buildDraftConversationServiceTierStorageKey,
  buildDraftConversationThinkingLevelStorageKey,
  clearDraftConversationAttachments,
  clearDraftConversationComposer,
  clearDraftConversationCwd,
  clearDraftConversationModel,
  clearDraftConversationServiceTier,
  clearDraftConversationThinkingLevel,
  hasDraftConversationAttachments,
  persistDraftConversationAttachments,
  persistDraftConversationComposer,
  persistDraftConversationCwd,
  persistDraftConversationModel,
  persistDraftConversationServiceTier,
  persistDraftConversationThinkingLevel,
  readDraftConversationAttachments,
  readDraftConversationComposer,
  readDraftConversationCwd,
  readDraftConversationModel,
  readDraftConversationServiceTier,
  readDraftConversationThinkingLevel,
} from './draftConversation';

function createStorage(): StorageLike & { getItem(key: string): string | null } {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

describe('draftConversation', () => {
  it('uses dedicated draft storage keys', () => {
    expect(buildDraftConversationComposerStorageKey()).toBe('pa:reload:conversation:draft:composer');
    expect(buildDraftConversationCwdStorageKey()).toBe('pa:reload:conversation:draft:cwd');
    expect(buildDraftConversationAttachmentsStorageKey()).toBe('pa:reload:conversation:draft:attachments');
    expect(buildDraftConversationModelStorageKey()).toBe('pa:reload:conversation:draft:model');
    expect(buildDraftConversationThinkingLevelStorageKey()).toBe('pa:reload:conversation:draft:thinking-level');
    expect(buildDraftConversationServiceTierStorageKey()).toBe('pa:reload:conversation:draft:service-tier');
  });

  it('persists and reads the draft composer text', () => {
    const storage = createStorage();

    persistDraftConversationComposer('Keep this unsent note', storage);

    expect(readDraftConversationComposer(storage)).toBe('Keep this unsent note');
    expect(storage.getItem(buildDraftConversationComposerStorageKey())).toBe(JSON.stringify('Keep this unsent note'));
  });

  it('clears the stored draft composer text', () => {
    const storage = createStorage();

    persistDraftConversationComposer('Temporary draft', storage);
    clearDraftConversationComposer(storage);

    expect(readDraftConversationComposer(storage)).toBe('');
    expect(storage.getItem(buildDraftConversationComposerStorageKey())).toBeNull();
  });

  it('persists and reads the draft cwd', () => {
    const storage = createStorage();

    persistDraftConversationCwd('~/workingdir/personal-agent', storage);

    expect(readDraftConversationCwd(storage)).toBe('~/workingdir/personal-agent');
    expect(storage.getItem(buildDraftConversationCwdStorageKey())).toBe(JSON.stringify('~/workingdir/personal-agent'));
  });

  it('clears the stored draft cwd', () => {
    const storage = createStorage();

    persistDraftConversationCwd('~/workingdir/personal-agent', storage);
    clearDraftConversationCwd(storage);

    expect(readDraftConversationCwd(storage)).toBe('');
    expect(storage.getItem(buildDraftConversationCwdStorageKey())).toBeNull();
  });

  it('persists and reads the draft model', () => {
    const storage = createStorage();

    persistDraftConversationModel('gpt-5.4', storage);

    expect(readDraftConversationModel(storage)).toBe('gpt-5.4');
    expect(storage.getItem(buildDraftConversationModelStorageKey())).toBe(JSON.stringify('gpt-5.4'));
  });

  it('clears the stored draft model', () => {
    const storage = createStorage();

    persistDraftConversationModel('gpt-5.4', storage);
    clearDraftConversationModel(storage);

    expect(readDraftConversationModel(storage)).toBe('');
    expect(storage.getItem(buildDraftConversationModelStorageKey())).toBeNull();
  });

  it('persists and reads the draft thinking level', () => {
    const storage = createStorage();

    persistDraftConversationThinkingLevel('high', storage);

    expect(readDraftConversationThinkingLevel(storage)).toBe('high');
    expect(storage.getItem(buildDraftConversationThinkingLevelStorageKey())).toBe(JSON.stringify('high'));
  });

  it('clears the stored draft thinking level', () => {
    const storage = createStorage();

    persistDraftConversationThinkingLevel('high', storage);
    clearDraftConversationThinkingLevel(storage);

    expect(readDraftConversationThinkingLevel(storage)).toBe('');
    expect(storage.getItem(buildDraftConversationThinkingLevelStorageKey())).toBeNull();
  });

  it('persists and reads the draft service tier', () => {
    const storage = createStorage();

    persistDraftConversationServiceTier('priority', storage);

    expect(readDraftConversationServiceTier(storage)).toBe('priority');
    expect(storage.getItem(buildDraftConversationServiceTierStorageKey())).toBe(JSON.stringify('priority'));
  });

  it('clears the stored draft service tier', () => {
    const storage = createStorage();

    persistDraftConversationServiceTier('priority', storage);
    clearDraftConversationServiceTier(storage);

    expect(readDraftConversationServiceTier(storage)).toBe('');
    expect(storage.getItem(buildDraftConversationServiceTierStorageKey())).toBeNull();
  });

  it('persists and reads draft attachments', () => {
    const storage = createStorage();

    persistDraftConversationAttachments({
      images: [{ mimeType: 'image/png', data: 'abc', name: 'diagram.png' }],
      drawings: [{
        localId: 'drawing-1',
        title: 'Wireframe',
        sourceData: 'source-data',
        sourceMimeType: 'application/json',
        sourceName: 'wireframe.excalidraw',
        previewData: 'preview-data',
        previewMimeType: 'image/png',
        previewName: 'wireframe.png',
        previewUrl: 'data:image/png;base64,preview-data',
        scene: { elements: [], appState: {}, files: {} },
        dirty: true,
      }],
    }, storage);

    expect(readDraftConversationAttachments(storage)).toEqual({
      images: [{ mimeType: 'image/png', data: 'abc', name: 'diagram.png' }],
      drawings: [{
        localId: 'drawing-1',
        title: 'Wireframe',
        sourceData: 'source-data',
        sourceMimeType: 'application/json',
        sourceName: 'wireframe.excalidraw',
        previewData: 'preview-data',
        previewMimeType: 'image/png',
        previewName: 'wireframe.png',
        previewUrl: 'data:image/png;base64,preview-data',
        scene: { elements: [], appState: {}, files: {} },
        dirty: true,
      }],
    });
    expect(hasDraftConversationAttachments(storage)).toBe(true);
  });

  it('clears stored draft attachments', () => {
    const storage = createStorage();

    persistDraftConversationAttachments({
      images: [{ mimeType: 'image/png', data: 'abc' }],
      drawings: [],
    }, storage);
    clearDraftConversationAttachments(storage);

    expect(readDraftConversationAttachments(storage)).toEqual({ images: [], drawings: [] });
    expect(hasDraftConversationAttachments(storage)).toBe(false);
    expect(storage.getItem(buildDraftConversationAttachmentsStorageKey())).toBeNull();
  });

});
