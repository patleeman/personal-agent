import { describe, expect, it } from 'vitest';

import type { StorageLike } from '../local/reloadState';
import {
  clearConversationAttachments,
  clearDraftConversationAttachments,
  clearDraftConversationComposer,
  clearDraftConversationCwd,
  clearDraftConversationModel,
  clearDraftConversationModelPreferences,
  clearDraftConversationServiceTier,
  clearDraftConversationThinkingLevel,
  hasConversationAttachments,
  hasDraftConversationAttachments,
  persistConversationAttachments,
  persistDraftConversationAttachments,
  persistDraftConversationComposer,
  persistDraftConversationCwd,
  persistDraftConversationModel,
  persistDraftConversationServiceTier,
  persistDraftConversationThinkingLevel,
  readConversationAttachments,
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
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY = 'pa:reload:conversation:draft:composer';
const DRAFT_CONVERSATION_CWD_STORAGE_KEY = 'pa:reload:conversation:draft:cwd';
const DRAFT_CONVERSATION_ATTACHMENTS_STORAGE_KEY = 'pa:reload:conversation:draft:attachments';
const DRAFT_CONVERSATION_MODEL_STORAGE_KEY = 'pa:reload:conversation:draft:model';
const DRAFT_CONVERSATION_THINKING_LEVEL_STORAGE_KEY = 'pa:reload:conversation:draft:thinking-level';
const DRAFT_CONVERSATION_SERVICE_TIER_STORAGE_KEY = 'pa:reload:conversation:draft:service-tier';

describe('draftConversation', () => {
  it('uses dedicated draft storage keys', () => {
    const storage = createStorage();

    persistDraftConversationComposer('composer', storage);
    persistDraftConversationCwd('/tmp/project', storage);
    persistDraftConversationAttachments(
      {
        images: [],
        drawings: [
          {
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
          },
        ],
      },
      storage,
    );
    persistDraftConversationModel('gpt-5.4', storage);
    persistDraftConversationThinkingLevel('high', storage);
    persistDraftConversationServiceTier('priority', storage);

    expect(storage.getItem(DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY)).toBe(JSON.stringify('composer'));
    expect(storage.getItem(DRAFT_CONVERSATION_CWD_STORAGE_KEY)).toBe(JSON.stringify('/tmp/project'));
    expect(storage.getItem(DRAFT_CONVERSATION_ATTACHMENTS_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(DRAFT_CONVERSATION_MODEL_STORAGE_KEY)).toBe(JSON.stringify('gpt-5.4'));
    expect(storage.getItem(DRAFT_CONVERSATION_THINKING_LEVEL_STORAGE_KEY)).toBe(JSON.stringify('high'));
    expect(storage.getItem(DRAFT_CONVERSATION_SERVICE_TIER_STORAGE_KEY)).toBe(JSON.stringify('priority'));
  });

  it('persists and reads the draft composer text', () => {
    const storage = createStorage();

    persistDraftConversationComposer('Keep this unsent note', storage);

    expect(readDraftConversationComposer(storage)).toBe('Keep this unsent note');
    expect(storage.getItem(DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY)).toBe(JSON.stringify('Keep this unsent note'));
  });

  it('clears the stored draft composer text', () => {
    const storage = createStorage();

    persistDraftConversationComposer('Temporary draft', storage);
    clearDraftConversationComposer(storage);

    expect(readDraftConversationComposer(storage)).toBe('');
    expect(storage.getItem(DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY)).toBeNull();
  });

  it('persists and reads the draft cwd', () => {
    const storage = createStorage();

    persistDraftConversationCwd('~/workingdir/personal-agent', storage);

    expect(readDraftConversationCwd(storage)).toBe('~/workingdir/personal-agent');
    expect(storage.getItem(DRAFT_CONVERSATION_CWD_STORAGE_KEY)).toBe(JSON.stringify('~/workingdir/personal-agent'));
  });

  it('clears the stored draft cwd', () => {
    const storage = createStorage();

    persistDraftConversationCwd('~/workingdir/personal-agent', storage);
    clearDraftConversationCwd(storage);

    expect(readDraftConversationCwd(storage)).toBe('');
    expect(storage.getItem(DRAFT_CONVERSATION_CWD_STORAGE_KEY)).toBeNull();
  });

  it('persists and reads the draft model', () => {
    const storage = createStorage();

    persistDraftConversationModel('gpt-5.4', storage);

    expect(readDraftConversationModel(storage)).toBe('gpt-5.4');
    expect(storage.getItem(DRAFT_CONVERSATION_MODEL_STORAGE_KEY)).toBe(JSON.stringify('gpt-5.4'));
  });

  it('clears the stored draft model', () => {
    const storage = createStorage();

    persistDraftConversationModel('gpt-5.4', storage);
    clearDraftConversationModel(storage);

    expect(readDraftConversationModel(storage)).toBe('');
    expect(storage.getItem(DRAFT_CONVERSATION_MODEL_STORAGE_KEY)).toBeNull();
  });

  it('persists and reads the draft thinking level', () => {
    const storage = createStorage();

    persistDraftConversationThinkingLevel('high', storage);

    expect(readDraftConversationThinkingLevel(storage)).toBe('high');
    expect(storage.getItem(DRAFT_CONVERSATION_THINKING_LEVEL_STORAGE_KEY)).toBe(JSON.stringify('high'));
  });

  it('clears the stored draft thinking level', () => {
    const storage = createStorage();

    persistDraftConversationThinkingLevel('high', storage);
    clearDraftConversationThinkingLevel(storage);

    expect(readDraftConversationThinkingLevel(storage)).toBe('');
    expect(storage.getItem(DRAFT_CONVERSATION_THINKING_LEVEL_STORAGE_KEY)).toBeNull();
  });

  it('persists and reads the draft service tier', () => {
    const storage = createStorage();

    persistDraftConversationServiceTier('priority', storage);

    expect(readDraftConversationServiceTier(storage)).toBe('priority');
    expect(storage.getItem(DRAFT_CONVERSATION_SERVICE_TIER_STORAGE_KEY)).toBe(JSON.stringify('priority'));
  });

  it('clears the stored draft service tier', () => {
    const storage = createStorage();

    persistDraftConversationServiceTier('priority', storage);
    clearDraftConversationServiceTier(storage);

    expect(readDraftConversationServiceTier(storage)).toBe('');
    expect(storage.getItem(DRAFT_CONVERSATION_SERVICE_TIER_STORAGE_KEY)).toBeNull();
  });

  it('clears draft model preferences together', () => {
    const storage = createStorage();

    persistDraftConversationModel('gpt-5.4', storage);
    persistDraftConversationThinkingLevel('high', storage);
    persistDraftConversationServiceTier('priority', storage);
    clearDraftConversationModelPreferences(storage);

    expect(readDraftConversationModel(storage)).toBe('');
    expect(readDraftConversationThinkingLevel(storage)).toBe('');
    expect(readDraftConversationServiceTier(storage)).toBe('');
    expect(storage.getItem(DRAFT_CONVERSATION_MODEL_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(DRAFT_CONVERSATION_THINKING_LEVEL_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(DRAFT_CONVERSATION_SERVICE_TIER_STORAGE_KEY)).toBeNull();
  });

  it('persists and reads draft attachments', () => {
    const storage = createStorage();

    persistDraftConversationAttachments(
      {
        images: [{ mimeType: 'image/png', data: 'abc', name: 'diagram.png' }],
        drawings: [
          {
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
            revision: Number.MAX_SAFE_INTEGER + 1,
            dirty: true,
          },
        ],
      },
      storage,
    );

    expect(readDraftConversationAttachments(storage)).toEqual({
      images: [{ mimeType: 'image/png', data: 'abc', name: 'diagram.png' }],
      drawings: [
        {
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
        },
      ],
    });
    expect(hasDraftConversationAttachments(storage)).toBe(true);
  });

  it('drops malformed draft image attachments when restoring storage', () => {
    const storage = createStorage();

    persistDraftConversationAttachments(
      {
        images: [
          { mimeType: 'image/png', data: 'abc', name: 'diagram.png', previewUrl: 'data:text/html;base64,PHNjcmlwdA==' },
          { mimeType: 'image/png', data: 'aGVsbG8=', name: 'plain-data-url.png', previewUrl: 'data:image/png,aGVsbG8=' },
          { mimeType: 'image/png', data: 'b2s=', name: 'malformed-preview.png', previewUrl: 'data:image/png;base64,not-valid-base64!' },
          { mimeType: 'text/plain', data: 'aGVsbG8=', name: 'note.txt' },
          { mimeType: 'image/png', data: 'not-valid-base64!', name: 'bad.png' },
          { mimeType: 'image/png', data: '   ', name: 'blank.png' },
        ],
        drawings: [],
      },
      storage,
    );

    expect(readDraftConversationAttachments(storage)).toEqual({
      images: [
        { mimeType: 'image/png', data: 'abc', name: 'diagram.png' },
        { mimeType: 'image/png', data: 'aGVsbG8=', name: 'plain-data-url.png' },
        { mimeType: 'image/png', data: 'b2s=', name: 'malformed-preview.png' },
      ],
      drawings: [],
    });
  });

  it('persists attachments per conversation thread', () => {
    const storage = createStorage();

    persistConversationAttachments(
      'session-123',
      {
        images: [{ mimeType: 'image/png', data: 'abc', name: 'diagram.png' }],
        drawings: [],
      },
      storage,
    );
    persistConversationAttachments(
      'session-456',
      {
        images: [{ mimeType: 'image/png', data: 'xyz', name: 'other.png' }],
        drawings: [],
      },
      storage,
    );

    expect(storage.getItem('pa:reload:conversation:session-123:attachments')).toBe(
      JSON.stringify({
        images: [{ mimeType: 'image/png', data: 'abc', name: 'diagram.png' }],
        drawings: [],
      }),
    );
    expect(readConversationAttachments('session-123', storage)).toEqual({
      images: [{ mimeType: 'image/png', data: 'abc', name: 'diagram.png' }],
      drawings: [],
    });
    expect(readConversationAttachments('session-456', storage)).toEqual({
      images: [{ mimeType: 'image/png', data: 'xyz', name: 'other.png' }],
      drawings: [],
    });
    expect(hasConversationAttachments('session-123', storage)).toBe(true);
    expect(hasConversationAttachments('session-456', storage)).toBe(true);
  });

  it('clears stored draft attachments', () => {
    const storage = createStorage();

    persistDraftConversationAttachments(
      {
        images: [{ mimeType: 'image/png', data: 'abc' }],
        drawings: [],
      },
      storage,
    );
    clearDraftConversationAttachments(storage);

    expect(readDraftConversationAttachments(storage)).toEqual({ images: [], drawings: [] });
    expect(hasDraftConversationAttachments(storage)).toBe(false);
    expect(storage.getItem(DRAFT_CONVERSATION_ATTACHMENTS_STORAGE_KEY)).toBeNull();
  });

  it('clears stored conversation attachments without touching other threads', () => {
    const storage = createStorage();

    persistConversationAttachments(
      'session-123',
      {
        images: [{ mimeType: 'image/png', data: 'abc' }],
        drawings: [],
      },
      storage,
    );
    persistConversationAttachments(
      'session-456',
      {
        images: [{ mimeType: 'image/png', data: 'xyz' }],
        drawings: [],
      },
      storage,
    );
    clearConversationAttachments('session-123', storage);

    expect(readConversationAttachments('session-123', storage)).toEqual({ images: [], drawings: [] });
    expect(hasConversationAttachments('session-123', storage)).toBe(false);
    expect(readConversationAttachments('session-456', storage)).toEqual({
      images: [{ mimeType: 'image/png', data: 'xyz' }],
      drawings: [],
    });
    expect(storage.getItem('pa:reload:conversation:session-123:attachments')).toBeNull();
  });
});
