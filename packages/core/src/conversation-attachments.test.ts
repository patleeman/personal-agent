import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteConversationAttachment,
  getConversationAttachment,
  listConversationAttachments,
  readConversationAttachmentDownload,
  resolveConversationAttachmentDir,
  resolveConversationAttachmentPromptFiles,
  resolveConversationAttachmentRevisionDir,
  resolveConversationAttachmentsDir,
  resolveProfileConversationAttachmentsDir,
  saveConversationAttachment,
  validateConversationAttachmentId,
} from './conversation-attachments.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-conversation-attachments-'));
  tempDirs.push(dir);
  return dir;
}

function toBase64(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

describe('conversation attachment paths', () => {
  it('resolves profile/conversation/attachment directories', () => {
    const stateRoot = createTempStateRoot();

    expect(resolveProfileConversationAttachmentsDir({ stateRoot, profile: 'assistant' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-attachments', 'assistant'));

    expect(resolveConversationAttachmentsDir({ stateRoot, profile: 'assistant', conversationId: 'conv-123' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-attachments', 'assistant', 'conv-123'));

    expect(resolveConversationAttachmentDir({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      attachmentId: 'diagram',
    })).toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-attachments', 'assistant', 'conv-123', 'diagram'));

    expect(resolveConversationAttachmentRevisionDir({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      attachmentId: 'diagram',
      revision: 2,
    })).toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-attachments', 'assistant', 'conv-123', 'diagram', 'revisions', '2'));
  });

  it('rejects invalid attachment ids', () => {
    expect(() => validateConversationAttachmentId('bad/id')).toThrow('Invalid attachment id');
  });

  it('rejects malformed attachment asset base64', () => {
    const stateRoot = createTempStateRoot();

    expect(() => saveConversationAttachment({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-bad-base64',
      title: 'Bad asset',
      sourceData: 'not-valid-base64!',
      previewData: toBase64('preview'),
    })).toThrow('Attachment source data must be valid base64.');
  });
});

describe('conversation attachment storage', () => {
  it('creates and updates revisioned attachments', () => {
    const stateRoot = createTempStateRoot();

    const first = saveConversationAttachment({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      title: 'API sequence',
      sourceData: toBase64('{"type":"excalidraw"}'),
      sourceName: 'api-sequence.excalidraw',
      previewData: toBase64('png-v1'),
      previewName: 'api-sequence.png',
      createdAt: '2026-03-14T10:00:00.000Z',
      updatedAt: '2026-03-14T10:00:00.000Z',
    });

    expect(first.id).toBe('api-sequence');
    expect(first.currentRevision).toBe(1);
    expect(first.revisions).toHaveLength(1);

    const second = saveConversationAttachment({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      attachmentId: first.id,
      title: 'API sequence v2',
      sourceData: toBase64('{"type":"excalidraw","version":2}'),
      sourceName: 'api-sequence-v2.excalidraw',
      previewData: toBase64('png-v2'),
      previewName: 'api-sequence-v2.png',
      note: 'Adjusted sync flow',
      updatedAt: '2026-03-14T10:05:00.000Z',
    });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe('API sequence v2');
    expect(second.currentRevision).toBe(2);
    expect(second.revisions).toHaveLength(2);
    expect(second.revisions[1]).toMatchObject({
      revision: 2,
      sourceName: 'api-sequence-v2.excalidraw',
      previewName: 'api-sequence-v2.png',
      note: 'Adjusted sync flow',
    });

    const listed = listConversationAttachments({ stateRoot, profile: 'assistant', conversationId: 'conv-123' });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(first.id);
    expect(listed[0]?.currentRevision).toBe(2);

    const loaded = getConversationAttachment({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      attachmentId: first.id,
    });

    expect(loaded).not.toBeNull();
    expect(loaded?.revisions.map((revision) => revision.revision)).toEqual([1, 2]);
  });

  it('reads source/preview downloads and resolves prompt files', () => {
    const stateRoot = createTempStateRoot();

    const saved = saveConversationAttachment({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-abc',
      title: 'System architecture',
      sourceData: toBase64('{"type":"excalidraw","elements":[]}'),
      sourceName: 'system-architecture.excalidraw',
      previewData: toBase64('preview-image'),
      previewName: 'system-architecture.png',
    });

    const sourceDownload = readConversationAttachmentDownload({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-abc',
      attachmentId: saved.id,
      asset: 'source',
    });

    expect(sourceDownload.fileName).toBe('system-architecture.excalidraw');
    expect(sourceDownload.mimeType).toBe('application/vnd.excalidraw+json');
    expect(readFileSync(sourceDownload.filePath).toString('utf-8')).toBe('{"type":"excalidraw","elements":[]}');

    const previewDownload = readConversationAttachmentDownload({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-abc',
      attachmentId: saved.id,
      asset: 'preview',
    });

    expect(previewDownload.fileName).toBe('system-architecture.png');
    expect(previewDownload.mimeType).toBe('image/png');

    const promptFiles = resolveConversationAttachmentPromptFiles({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-abc',
      refs: [{ attachmentId: saved.id }],
    });

    expect(promptFiles).toHaveLength(1);
    expect(promptFiles[0]).toMatchObject({
      attachmentId: saved.id,
      revision: saved.currentRevision,
      sourceName: 'system-architecture.excalidraw',
      previewName: 'system-architecture.png',
    });
    expect(existsSync(promptFiles[0]!.sourcePath)).toBe(true);
    expect(existsSync(promptFiles[0]!.previewPath)).toBe(true);
  });

  it('deletes attachments recursively', () => {
    const stateRoot = createTempStateRoot();

    const saved = saveConversationAttachment({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-delete',
      title: 'Delete me',
      sourceData: toBase64('{"type":"excalidraw"}'),
      previewData: toBase64('preview'),
    });

    const attachmentDir = resolveConversationAttachmentDir({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-delete',
      attachmentId: saved.id,
    });
    expect(existsSync(attachmentDir)).toBe(true);

    expect(deleteConversationAttachment({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-delete',
      attachmentId: saved.id,
    })).toBe(true);

    expect(getConversationAttachment({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-delete',
      attachmentId: saved.id,
    })).toBeNull();
    expect(existsSync(attachmentDir)).toBe(false);
  });
});
