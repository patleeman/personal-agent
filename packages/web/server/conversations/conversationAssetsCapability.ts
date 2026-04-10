import {
  deleteConversationArtifact,
  deleteConversationAttachment,
  getConversationArtifact,
  getConversationAttachment,
  listConversationArtifacts,
  listConversationAttachments,
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
