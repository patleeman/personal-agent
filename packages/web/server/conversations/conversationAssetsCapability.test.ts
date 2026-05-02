import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  deleteConversationArtifactMock,
  deleteConversationAttachmentMock,
  getConversationArtifactMock,
  getConversationAttachmentMock,
  listConversationArtifactsMock,
  listConversationAttachmentsMock,
  listConversationCommitCheckpointsMock,
  readConversationAttachmentDownloadMock,
  saveConversationAttachmentMock,
  addConversationCommitCheckpointCommentMock,
  resolveConversationCheckpointRecordMock,
  readSessionBlocksMock,
  invalidateAppTopicsMock,
} = vi.hoisted(() => ({
  deleteConversationArtifactMock: vi.fn(),
  deleteConversationAttachmentMock: vi.fn(),
  getConversationArtifactMock: vi.fn(),
  getConversationAttachmentMock: vi.fn(),
  listConversationArtifactsMock: vi.fn(),
  listConversationAttachmentsMock: vi.fn(),
  listConversationCommitCheckpointsMock: vi.fn(),
  readConversationAttachmentDownloadMock: vi.fn(),
  saveConversationAttachmentMock: vi.fn(),
  addConversationCommitCheckpointCommentMock: vi.fn(),
  resolveConversationCheckpointRecordMock: vi.fn(),
  readSessionBlocksMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  deleteConversationArtifact: deleteConversationArtifactMock,
  deleteConversationAttachment: deleteConversationAttachmentMock,
  getConversationArtifact: getConversationArtifactMock,
  getConversationAttachment: getConversationAttachmentMock,
  listConversationArtifacts: listConversationArtifactsMock,
  listConversationAttachments: listConversationAttachmentsMock,
  listConversationCommitCheckpoints: listConversationCommitCheckpointsMock,
  readConversationAttachmentDownload: readConversationAttachmentDownloadMock,
  saveConversationAttachment: saveConversationAttachmentMock,
  addConversationCommitCheckpointComment: addConversationCommitCheckpointCommentMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

vi.mock('./checkpointReview.js', () => ({
  readConversationCheckpointReviewContext: vi.fn(),
  resolveConversationCheckpointRecord: resolveConversationCheckpointRecordMock,
}));

vi.mock('./sessions.js', () => ({
  readSessionBlocks: readSessionBlocksMock,
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
  readConversationCommitCheckpointsCapability,
  updateConversationAttachmentCapability,
  createConversationCommitCheckpointCommentCapability,
} from './conversationAssetsCapability.js';

beforeEach(() => {
  deleteConversationArtifactMock.mockReset();
  deleteConversationAttachmentMock.mockReset();
  getConversationArtifactMock.mockReset();
  getConversationAttachmentMock.mockReset();
  listConversationArtifactsMock.mockReset();
  listConversationAttachmentsMock.mockReset();
  listConversationCommitCheckpointsMock.mockReset();
  readConversationAttachmentDownloadMock.mockReset();
  saveConversationAttachmentMock.mockReset();
  addConversationCommitCheckpointCommentMock.mockReset();
  resolveConversationCheckpointRecordMock.mockReset();
  readSessionBlocksMock.mockReset();
  invalidateAppTopicsMock.mockReset();

  listConversationArtifactsMock.mockReturnValue([{ id: 'artifact-1', title: 'Artifact 1' }]);
  listConversationAttachmentsMock.mockReturnValue([{ id: 'attachment-1', kind: 'excalidraw' }]);
  listConversationCommitCheckpointsMock.mockReturnValue([]);
  readSessionBlocksMock.mockReturnValue(null);
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
  addConversationCommitCheckpointCommentMock.mockReturnValue({ id: 'checkpoint-1', subject: 'feat: checkpoint', commentCount: 1, comments: [{ id: 'comment-1', body: 'Ship it' }] });
  resolveConversationCheckpointRecordMock.mockReturnValue({ id: 'checkpoint-1', subject: 'feat: checkpoint', comments: [], files: [], commentCount: 0, sourceKind: 'checkpoint', commentable: true });
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

  it('creates checkpoint comments with invalidation', () => {
    expect(createConversationCommitCheckpointCommentCapability('assistant', {
      conversationId: 'session-1',
      checkpointId: 'checkpoint-1',
      body: 'Ship it',
    })).toEqual({
      conversationId: 'session-1',
      checkpoint: { id: 'checkpoint-1', subject: 'feat: checkpoint', commentCount: 1, comments: [{ id: 'comment-1', body: 'Ship it' }] },
    });

    expect(addConversationCommitCheckpointCommentMock).toHaveBeenCalledWith({
      profile: 'assistant',
      conversationId: 'session-1',
      checkpointId: 'checkpoint-1',
      body: 'Ship it',
      authorName: 'You',
      authorProfile: 'assistant',
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('checkpoints');

    expect(() => createConversationCommitCheckpointCommentCapability('assistant', {
      conversationId: 'session-1',
      checkpointId: 'checkpoint-1',
      body: '   ',
    })).toThrowError(new ConversationAssetCapabilityInputError('body required'));

    addConversationCommitCheckpointCommentMock.mockReturnValueOnce(null);
    expect(() => createConversationCommitCheckpointCommentCapability('assistant', {
      conversationId: 'session-1',
      checkpointId: 'missing',
      body: 'Nope',
    })).toThrowError(new ConversationAssetCapabilityNotFoundError('Commit checkpoint not found'));
  });

  it('merges saved checkpoints with git commits mentioned in the transcript', () => {
    const savedCheckpoint = {
      id: 'saved-checkpoint',
      conversationId: 'session-1',
      title: 'Saved checkpoint',
      cwd: '/tmp/repo',
      commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      shortSha: 'aaaaaaa',
      subject: 'Saved checkpoint',
      authorName: 'Test User',
      committedAt: '2026-04-30T10:00:00.000Z',
      createdAt: '2026-04-30T10:00:00.000Z',
      updatedAt: '2026-04-30T10:00:00.000Z',
      fileCount: 1,
      linesAdded: 1,
      linesDeleted: 0,
      commentCount: 0,
    };
    const transcriptCheckpoint = {
      id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      conversationId: 'session-1',
      title: 'Transcript commit',
      cwd: '/tmp/repo',
      commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      shortSha: 'bbbbbbb',
      subject: 'Transcript commit',
      authorName: 'Test User',
      committedAt: '2026-04-30T11:00:00.000Z',
      createdAt: '2026-04-30T11:00:00.000Z',
      updatedAt: '2026-04-30T11:00:00.000Z',
      fileCount: 2,
      linesAdded: 5,
      linesDeleted: 1,
      commentCount: 0,
      files: [],
      comments: [],
      sourceKind: 'git',
      commentable: false,
    };

    listConversationCommitCheckpointsMock.mockReturnValue([savedCheckpoint]);
    readSessionBlocksMock.mockReturnValue({
      blocks: [
        { type: 'text', ts: '2026-04-30T12:00:00.000Z', text: 'Fixed in bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.' },
        { type: 'tool_use', ts: '2026-04-30T12:01:00.000Z', tool: 'bash', input: {}, output: 'already saved aaaaaaa' },
      ],
    });
    resolveConversationCheckpointRecordMock.mockImplementation((_input: { checkpointId: string }) => (
      _input.checkpointId.startsWith('b') ? transcriptCheckpoint : savedCheckpoint
    ));

    expect(readConversationCommitCheckpointsCapability('assistant', ' session-1 ')).toEqual({
      conversationId: 'session-1',
      checkpoints: [transcriptCheckpoint, savedCheckpoint],
    });

    expect(resolveConversationCheckpointRecordMock).toHaveBeenCalledWith({
      profile: 'assistant',
      conversationId: 'session-1',
      checkpointId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
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

    expect(() => readConversationAttachmentDownloadCapability('assistant', {
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
      asset: 'source',
      revision: Number.MAX_SAFE_INTEGER + 1,
    })).toThrowError(new ConversationAssetCapabilityInputError('revision must be a positive integer when provided.'));

    expect(() => readConversationAttachmentDownloadCapability('assistant', {
      conversationId: 'session-1',
      attachmentId: 'attachment-1',
      asset: 'source',
      revision: Number.MAX_SAFE_INTEGER,
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
