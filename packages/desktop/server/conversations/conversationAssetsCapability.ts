import {
  addConversationCommitCheckpointComment,
  deleteConversationArtifact,
  deleteConversationAttachment,
  getConversationArtifact,
  getConversationAttachment,
  listConversationArtifacts,
  listConversationAttachments,
  listConversationCommitCheckpoints,
  readConversationAttachmentDownload,
  saveConversationAttachment,
  type ConversationCommitCheckpointSummary,
} from '@personal-agent/core';
import { invalidateAppTopics } from '../shared/appEvents.js';
import {
  readConversationCheckpointReviewContext,
  resolveConversationCheckpointRecord,
} from './checkpointReview.js';
import { readSessionBlocks, type DisplayBlock } from './sessions.js';

export class ConversationAssetCapabilityInputError extends Error {}
export class ConversationAssetCapabilityNotFoundError extends Error {}

const MAX_ATTACHMENT_REVISION = 1_000_000;

interface ConversationArtifactMutationInput {
  conversationId: string;
  artifactId: string;
}

interface ConversationAttachmentMutationInput {
  conversationId: string;
  attachmentId: string;
}

interface ConversationCheckpointMutationInput {
  conversationId: string;
  checkpointId: string;
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

interface ConversationCheckpointCommentCreateInput extends ConversationCheckpointMutationInput {
  body?: string;
  filePath?: string;
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

function buildCheckpointListResult(profile: string, conversationId: string) {
  const savedCheckpoints = listConversationCommitCheckpoints({ profile, conversationId });

  return {
    conversationId,
    checkpoints: mergeTranscriptCommitCheckpoints(profile, conversationId, savedCheckpoints),
  };
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value ?? '');
  }
}

function extractDisplayBlockText(block: DisplayBlock): string {
  switch (block.type) {
    case 'user':
    case 'text':
    case 'thinking':
      return block.text;
    case 'context':
      return `${block.customType ?? ''}\n${block.text}`;
    case 'summary':
      return `${block.kind}\n${block.title}\n${block.detail ?? ''}\n${block.text}`;
    case 'tool_use':
      return `${block.tool}\n${stringifyUnknown(block.input)}\n${block.output}`;
    case 'image':
      return `${block.alt}\n${block.caption ?? ''}`;
    case 'error':
      return `${block.tool ?? ''}\n${block.message}`;
    default:
      return '';
  }
}

function extractCommitHashCandidates(blocks: DisplayBlock[]): string[] {
  const commitHashes = new Set<string>();
  const commitHashPattern = /\b[a-f0-9]{7,64}\b/gi;

  for (const block of blocks) {
    const text = extractDisplayBlockText(block);
    let match: RegExpExecArray | null = null;
    while ((match = commitHashPattern.exec(text)) !== null) {
      const hash = match[0]?.toLowerCase();
      if (hash && /[a-f]/i.test(hash)) {
        commitHashes.add(hash);
      }
    }
  }

  return Array.from(commitHashes);
}

function mergeTranscriptCommitCheckpoints(
  profile: string,
  conversationId: string,
  savedCheckpoints: ConversationCommitCheckpointSummary[],
): ConversationCommitCheckpointSummary[] {
  const checkpointsByCommit = new Map<string, ConversationCommitCheckpointSummary>();
  for (const checkpoint of savedCheckpoints) {
    checkpointsByCommit.set(checkpoint.commitSha.toLowerCase(), checkpoint);
  }

  const detail = readSessionBlocks(conversationId);
  if (!detail) {
    return savedCheckpoints;
  }

  for (const candidate of extractCommitHashCandidates(detail.blocks)) {
    const checkpoint = resolveConversationCheckpointRecord({ profile, conversationId, checkpointId: candidate });
    if (!checkpoint) {
      continue;
    }

    const key = checkpoint.commitSha.toLowerCase();
    if (!checkpointsByCommit.has(key)) {
      checkpointsByCommit.set(key, checkpoint);
    }
  }

  return Array.from(checkpointsByCommit.values())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

  if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision <= 0 || input.revision > MAX_ATTACHMENT_REVISION)) {
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

export function readConversationCommitCheckpointsCapability(profile: string, conversationIdInput: string) {
  const conversationId = normalizeRequiredId(conversationIdInput, 'conversationId');
  return buildCheckpointListResult(profile, conversationId);
}

export function readConversationCommitCheckpointCapability(
  profile: string,
  input: ConversationCheckpointMutationInput,
) {
  const conversationId = normalizeRequiredId(input.conversationId, 'conversationId');
  const checkpointId = normalizeRequiredId(input.checkpointId, 'checkpointId');
  const checkpoint = resolveConversationCheckpointRecord({ profile, conversationId, checkpointId });
  if (!checkpoint) {
    throw new ConversationAssetCapabilityNotFoundError('Commit checkpoint not found');
  }

  return {
    conversationId,
    checkpoint,
  };
}

export function createConversationCommitCheckpointCommentCapability(
  profile: string,
  input: ConversationCheckpointCommentCreateInput,
) {
  const conversationId = normalizeRequiredId(input.conversationId, 'conversationId');
  const checkpointId = normalizeRequiredId(input.checkpointId, 'checkpointId');
  const body = normalizeRequiredId(input.body ?? '', 'body');
  const checkpoint = addConversationCommitCheckpointComment({
    profile,
    conversationId,
    checkpointId,
    body,
    authorName: 'You',
    authorProfile: profile,
    ...(typeof input.filePath === 'string' && input.filePath.trim().length > 0 ? { filePath: input.filePath.trim() } : {}),
  });
  if (!checkpoint) {
    throw new ConversationAssetCapabilityNotFoundError('Commit checkpoint not found');
  }

  invalidateAppTopics('checkpoints');

  return {
    conversationId,
    checkpoint,
  };
}

export async function readConversationCheckpointReviewContextCapability(
  profile: string,
  input: ConversationCheckpointMutationInput,
) {
  const conversationId = normalizeRequiredId(input.conversationId, 'conversationId');
  const checkpointId = normalizeRequiredId(input.checkpointId, 'checkpointId');
  const reviewContext = await readConversationCheckpointReviewContext({
    profile,
    conversationId,
    checkpointId,
  });
  if (!reviewContext) {
    throw new ConversationAssetCapabilityNotFoundError('Commit checkpoint not found');
  }

  return reviewContext;
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
