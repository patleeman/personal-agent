import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  deleteConversationArtifactMock,
  deleteConversationAttachmentMock,
  getConversationArtifactMock,
  getConversationAttachmentMock,
  listConversationArtifactsMock,
  listConversationAttachmentsMock,
  readConversationAttachmentDownloadMock,
  saveConversationAttachmentMock,
  invalidateAppTopicsMock,
} = vi.hoisted(() => ({
  deleteConversationArtifactMock: vi.fn(),
  deleteConversationAttachmentMock: vi.fn(),
  getConversationArtifactMock: vi.fn(),
  getConversationAttachmentMock: vi.fn(),
  listConversationArtifactsMock: vi.fn(),
  listConversationAttachmentsMock: vi.fn(),
  readConversationAttachmentDownloadMock: vi.fn(),
  saveConversationAttachmentMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  deleteConversationArtifact: deleteConversationArtifactMock,
  deleteConversationAttachment: deleteConversationAttachmentMock,
  getConversationArtifact: getConversationArtifactMock,
  getConversationAttachment: getConversationAttachmentMock,
  listConversationArtifacts: listConversationArtifactsMock,
  listConversationAttachments: listConversationAttachmentsMock,
  readConversationAttachmentDownload: readConversationAttachmentDownloadMock,
  saveConversationAttachment: saveConversationAttachmentMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

import {
  ConversationAssetCapabilityInputError,
  ConversationAssetCapabilityNotFoundError,
  createConversationAttachmentCapability,
  deleteConversationArtifactCapability,
  deleteConversationAttachmentCapability,
  readConversationArtifactCapability,
  readConversationArtifactsCapability,
  readConversationAttachmentCapability,
  readConversationAttachmentDownloadCapability,
  readConversationAttachmentsCapability,
  updateConversationAttachmentCapability,
} from './conversationAssetsCapability.js';

beforeEach(() => {
  deleteConversationArtifactMock.mockReset();
  deleteConversationAttachmentMock.mockReset();
  getConversationArtifactMock.mockReset();
  getConversationAttachmentMock.mockReset();
  listConversationArtifactsMock.mockReset();
  listConversationAttachmentsMock.mockReset();
  readConversationAttachmentDownloadMock.mockReset();
  saveConversationAttachmentMock.mockReset();
  invalidateAppTopicsMock.mockReset();

  listConversationArtifactsMock.mockReturnValue([{ id: 'artifact-1', title: 'Artifact 1' }]);
  listConversationAttachmentsMock.mockReturnValue([{ id: 'attachment-1', kind: 'excalidraw' }]);
  getConversationArtifactMock.mockReturnValue({ id: 'artifact-1', title: 'Artifact 1' });
  getConversationAttachmentMock.mockReturnValue({ id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } });
  readConversationAttachmentDownloadMock.mockReturnValue({
    attachment: { id: 'attachment-1', kind: 'excalidraw' },
    revision: { revision: 2 },
    filePath: '/tmp/attachment-preview.png',
    fileName: 'preview.png',
    mimeType: 'image/png',
  });
  saveConversationAttachmentMock.mockReturnValue({ id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } });
  deleteConversationArtifactMock.mockReturnValue(true);
  deleteConversationAttachmentMock.mockReturnValue(true);
});

describe('conversationAssetsCapability', () => {
  it('reads and deletes conversation artifacts with invalidation', () => {
    expect(readConversationArtifactsCapability('assistant', ' session-1 ')).toEqual({
      conversationId: 'session-1',
      artifacts: [{ id: 'artifact-1', title: 'Artifact 1' }],
    });

    expect(readConversationArtifactCapability('assistant', {
      conversationId: 'session-1',
      artifactId: ' artifact-1 ',
    })).toEqual({
      conversationId: 'session-1',
      artifact: { id: 'artifact-1', title: 'Artifact 1' },
    });

    expect(deleteConversationArtifactCapability('assistant', {
      conversationId: 'session-1',
      artifactId: 'artifact-1',
    })).toEqual({
      conversationId: 'session-1',
      deleted: true,
      artifactId: 'artifact-1',
      artifacts: [{ id: 'artifact-1', title: 'Artifact 1' }],
    });

    expect(deleteConversationArtifactMock).toHaveBeenCalledWith({
      profile: 'assistant',
      conversationId: 'session-1',
      artifactId: 'artifact-1',
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('artifacts');
  });

  it('raises not-found errors for missing artifacts and attachments', () => {
    getConversationArtifactMock.mockReturnValueOnce(null);
    expect(() => readConversationArtifactCapability('assistant', {
      conversationId: 'session-1',
      artifactId: 'missing',
    })).toThrowError(new ConversationAssetCapabilityNotFoundError('Artifact not found'));

    getConversationAttachmentMock.mockReturnValueOnce(null);
    expect(() => readConversationAttachmentCapability('assistant', {
      conversationId: 'session-1',
      attachmentId: 'missing',
    })).toThrowError(new ConversationAssetCapabilityNotFoundError('Attachment not found'));
  });

  it('reads and creates conversation attachments with invalidation', () => {
    expect(readConversationAttachmentsCapability('assistant', ' session-1 ')).toEqual({
      conversationId: 'session-1',
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });

    expect(readConversationAttachmentCapability('assistant', {
      conversationId: 'session-1',
      attachmentId: ' attachment-1 ',
    })).toEqual({
      conversationId: 'session-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
    });

    expect(createConversationAttachmentCapability('assistant', {
      conversationId: 'session-1',
      title: 'Diagram',
      sourceData: 'source-data',
      previewData: 'preview-data',
      note: 'Pinned',
    })).toEqual({
      conversationId: 'session-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });

    expect(saveConversationAttachmentMock).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'assistant',
      conversationId: 'session-1',
      kind: 'excalidraw',
      title: 'Diagram',
      sourceData: 'source-data',
      previewData: 'preview-data',
      note: 'Pinned',
    }));
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('attachments');
  });

  it('updates and deletes conversation attachments with invalidation', () => {
    expect(updateConversationAttachmentCapability('assistant', {
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
      title: 'Updated diagram',
      sourceData: 'source-data',
      previewData: 'preview-data',
    })).toEqual({
      conversationId: 'session-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });

    expect(deleteConversationAttachmentCapability('assistant', {
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
    })).toEqual({
      conversationId: 'session-1',
      deleted: true,
      attachmentId: 'attachment-1',
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });

    expect(saveConversationAttachmentMock).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'assistant',
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
      title: 'Updated diagram',
    }));
    expect(deleteConversationAttachmentMock).toHaveBeenCalledWith({
      profile: 'assistant',
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('attachments');
  });

  it('reads attachment downloads and validates download input', () => {
    expect(readConversationAttachmentDownloadCapability('assistant', {
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
      asset: 'preview',
      revision: 2,
    })).toEqual({
      attachment: { id: 'attachment-1', kind: 'excalidraw' },
      revision: { revision: 2 },
      filePath: '/tmp/attachment-preview.png',
      fileName: 'preview.png',
      mimeType: 'image/png',
    });

    expect(readConversationAttachmentDownloadMock).toHaveBeenCalledWith({
      profile: 'assistant',
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
      asset: 'preview',
      revision: 2,
    });

    expect(() => readConversationAttachmentDownloadCapability('assistant', {
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
      asset: 'source',
      revision: 0,
    })).toThrowError(new ConversationAssetCapabilityInputError('revision must be a positive integer when provided.'));

    readConversationAttachmentDownloadMock.mockImplementationOnce(() => {
      throw new Error('Attachment file not found: preview revision 2');
    });
    expect(() => readConversationAttachmentDownloadCapability('assistant', {
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
      asset: 'preview',
    })).toThrowError(new ConversationAssetCapabilityNotFoundError('Attachment file not found: preview revision 2'));
  });

  it('validates attachment payload requirements', () => {
    expect(() => createConversationAttachmentCapability('assistant', {
      conversationId: 'session-1',
      previewData: 'preview-only',
    })).toThrowError(new ConversationAssetCapabilityInputError('sourceData and previewData are required.'));

    expect(() => updateConversationAttachmentCapability('assistant', {
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
      sourceData: 'source-only',
    })).toThrowError(new ConversationAssetCapabilityInputError('sourceData and previewData are required.'));
  });
});
