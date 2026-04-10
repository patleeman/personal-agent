import {
  deleteConversationArtifact,
  deleteConversationAttachment,
  getConversationArtifact,
  getConversationAttachment,
  listConversationArtifacts,
  listConversationAttachments,
  readConversationAttachmentDownload,
  saveConversationAttachment,
} from '@personal-agent/core';
import { invalidateAppTopics } from '../shared/appEvents.js';

export class ConversationAssetCapabilityInputError extends Error {}
export class ConversationAssetCapabilityNotFoundError extends Error {}

interface ConversationArtifactMutationInput {
  conversationId: string;
  artifactId: string;
}

interface ConversationAttachmentMutationInput {
  conversationId: string;
  attachmentId: string;
}

interface ConversationAttachmentSaveInput {
  conversationId: string;
  attachmentId?: string;
  kind?: 'excalidraw';
  title?: string;
  sourceData?: string;
  sourceName?: string;
  sourceMimeType?: string;
  previewData?: string;
  previewName?: string;
  previewMimeType?: string;
  note?: string;
}

interface ConversationAttachmentDownloadInput extends ConversationAttachmentMutationInput {
  asset: string;
  revision?: number;
}

function normalizeRequiredId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ConversationAssetCapabilityInputError(`${field} required`);
  }

  return normalized;
}

function buildArtifactListResult(profile: string, conversationId: string) {
  return {
    conversationId,
    artifacts: listConversationArtifacts({ profile, conversationId }),
  };
}

function buildAttachmentListResult(profile: string, conversationId: string) {
  return {
    conversationId,
    attachments: listConversationAttachments({ profile, conversationId }),
  };
}

function normalizeAttachmentSaveInput(input: ConversationAttachmentSaveInput) {
  if (!input.sourceData || !input.previewData) {
    throw new ConversationAssetCapabilityInputError('sourceData and previewData are required.');
  }

  return {
    kind: input.kind ?? 'excalidraw',
    title: input.title,
    sourceData: input.sourceData,
    sourceName: input.sourceName,
    sourceMimeType: input.sourceMimeType,
    previewData: input.previewData,
    previewName: input.previewName,
    previewMimeType: input.previewMimeType,
    note: input.note,
  };
}

function normalizeAttachmentDownloadInput(input: ConversationAttachmentDownloadInput): {
  conversationId: string;
  attachmentId: string;
  asset: 'source' | 'preview';
  revision?: number;
} {
  const conversationId = normalizeRequiredId(input.conversationId, 'conversationId');
  const attachmentId = normalizeRequiredId(input.attachmentId, 'attachmentId');
  const asset: 'source' | 'preview' | null = input.asset === 'source' || input.asset === 'preview'
    ? input.asset
    : null;
  if (!asset) {
    throw new ConversationAssetCapabilityInputError('asset must be "source" or "preview"');
  }

  if (input.revision !== undefined && (!Number.isInteger(input.revision) || input.revision <= 0)) {
    throw new ConversationAssetCapabilityInputError('revision must be a positive integer when provided.');
  }

  return {
    conversationId,
    attachmentId,
    asset,
    ...(input.revision ? { revision: input.revision } : {}),
  };
}

export function readConversationArtifactsCapability(profile: string, conversationIdInput: string) {
  const conversationId = normalizeRequiredId(conversationIdInput, 'conversationId');
  return buildArtifactListResult(profile, conversationId);
}

export function readConversationArtifactCapability(
  profile: string,
  input: ConversationArtifactMutationInput,
) {
  const conversationId = normalizeRequiredId(input.conversationId, 'conversationId');
  const artifactId = normalizeRequiredId(input.artifactId, 'artifactId');
  const artifact = getConversationArtifact({ profile, conversationId, artifactId });
  if (!artifact) {
    throw new ConversationAssetCapabilityNotFoundError('Artifact not found');
  }

  return {
    conversationId,
    artifact,
  };
}

export function deleteConversationArtifactCapability(
  profile: string,
  input: ConversationArtifactMutationInput,
) {
  const conversationId = normalizeRequiredId(input.conversationId, 'conversationId');
  const artifactId = normalizeRequiredId(input.artifactId, 'artifactId');
  const deleted = deleteConversationArtifact({ profile, conversationId, artifactId });

  invalidateAppTopics('artifacts');

  return {
    conversationId,
    deleted,
    artifactId,
    artifacts: buildArtifactListResult(profile, conversationId).artifacts,
  };
}

export function readConversationAttachmentsCapability(profile: string, conversationIdInput: string) {
  const conversationId = normalizeRequiredId(conversationIdInput, 'conversationId');
  return buildAttachmentListResult(profile, conversationId);
}

export function readConversationAttachmentCapability(
  profile: string,
  input: ConversationAttachmentMutationInput,
) {
  const conversationId = normalizeRequiredId(input.conversationId, 'conversationId');
  const attachmentId = normalizeRequiredId(input.attachmentId, 'attachmentId');
  const attachment = getConversationAttachment({ profile, conversationId, attachmentId });
  if (!attachment) {
    throw new ConversationAssetCapabilityNotFoundError('Attachment not found');
  }

  return {
    conversationId,
    attachment,
  };
}

export function createConversationAttachmentCapability(
  profile: string,
  input: ConversationAttachmentSaveInput,
) {
  const conversationId = normalizeRequiredId(input.conversationId, 'conversationId');
  const attachment = saveConversationAttachment({
    profile,
    conversationId,
    ...normalizeAttachmentSaveInput(input),
  });

  invalidateAppTopics('attachments');

  return {
    conversationId,
    attachment,
    attachments: buildAttachmentListResult(profile, conversationId).attachments,
  };
}

export function updateConversationAttachmentCapability(
  profile: string,
  input: ConversationAttachmentSaveInput & { attachmentId: string },
) {
  const conversationId = normalizeRequiredId(input.conversationId, 'conversationId');
  const attachmentId = normalizeRequiredId(input.attachmentId, 'attachmentId');
  const existing = getConversationAttachment({ profile, conversationId, attachmentId });
  if (!existing) {
    throw new ConversationAssetCapabilityNotFoundError('Attachment not found');
  }

  const attachment = saveConversationAttachment({
    profile,
    conversationId,
    attachmentId,
    ...normalizeAttachmentSaveInput(input),
  });

  invalidateAppTopics('attachments');

  return {
    conversationId,
    attachment,
    attachments: buildAttachmentListResult(profile, conversationId).attachments,
  };
}

export function deleteConversationAttachmentCapability(
  profile: string,
  input: ConversationAttachmentMutationInput,
) {
  const conversationId = normalizeRequiredId(input.conversationId, 'conversationId');
  const attachmentId = normalizeRequiredId(input.attachmentId, 'attachmentId');
  const deleted = deleteConversationAttachment({ profile, conversationId, attachmentId });

  invalidateAppTopics('attachments');

  return {
    conversationId,
    deleted,
    attachmentId,
    attachments: buildAttachmentListResult(profile, conversationId).attachments,
  };
}

export function readConversationAttachmentDownloadCapability(
  profile: string,
  input: ConversationAttachmentDownloadInput,
) {
  try {
    return readConversationAttachmentDownload({
      profile,
      ...normalizeAttachmentDownloadInput(input),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('not found')) {
      throw new ConversationAssetCapabilityNotFoundError(message);
    }

    throw error;
  }
}
