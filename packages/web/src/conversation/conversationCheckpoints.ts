import type { ConversationCheckpointToolDetails, MessageBlock } from '../shared/types';

const CONVERSATION_CHECKPOINT_QUERY_PARAM = 'checkpoint';
const CONVERSATION_CHECKPOINT_FILE_QUERY_PARAM = 'checkpointFile';

interface ConversationCheckpointPresentation {
  action: 'save' | 'get';
  checkpointId: string;
  commitSha: string;
  shortSha: string;
  title: string;
  subject: string;
  fileCount?: number;
  linesAdded?: number;
  linesDeleted?: number;
  updatedAt?: string;
  openRequested: boolean;
}

function isCheckpointAction(value: unknown): value is ConversationCheckpointPresentation['action'] {
  return value === 'save' || value === 'get';
}

function normalizeToolDetails(value: unknown): ConversationCheckpointToolDetails | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ConversationCheckpointToolDetails>;
  if (!(candidate.action === 'save' || candidate.action === 'get' || candidate.action === 'list')) {
    return null;
  }

  return candidate as ConversationCheckpointToolDetails;
}

export function getConversationCheckpointIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(CONVERSATION_CHECKPOINT_QUERY_PARAM)?.trim();
  return value ? value : null;
}

export function getConversationCheckpointFileFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(CONVERSATION_CHECKPOINT_FILE_QUERY_PARAM)?.trim();
  return value ? value : null;
}

export function setConversationCheckpointIdInSearch(search: string, checkpointId: string | null): string {
  const params = new URLSearchParams(search);
  if (checkpointId?.trim()) {
    params.set(CONVERSATION_CHECKPOINT_QUERY_PARAM, checkpointId.trim());
  } else {
    params.delete(CONVERSATION_CHECKPOINT_QUERY_PARAM);
    params.delete(CONVERSATION_CHECKPOINT_FILE_QUERY_PARAM);
  }

  const next = params.toString();
  return next.length > 0 ? `?${next}` : '';
}

export function setConversationCheckpointFileInSearch(search: string, filePath: string | null): string {
  const params = new URLSearchParams(search);
  if (filePath?.trim()) {
    params.set(CONVERSATION_CHECKPOINT_FILE_QUERY_PARAM, filePath.trim());
  } else {
    params.delete(CONVERSATION_CHECKPOINT_FILE_QUERY_PARAM);
  }

  const next = params.toString();
  return next.length > 0 ? `?${next}` : '';
}

export function readCheckpointPresentation(block: Extract<MessageBlock, { type: 'tool_use' }>): ConversationCheckpointPresentation | null {
  if (block.tool !== 'checkpoint') {
    return null;
  }

  const details = normalizeToolDetails(block.details);
  const input = block.input as {
    action?: unknown;
    checkpointId?: unknown;
    open?: unknown;
  };

  const action = details?.action ?? (isCheckpointAction(input.action) ? input.action : undefined);
  const checkpointId = typeof details?.checkpointId === 'string' && details.checkpointId.trim().length > 0
    ? details.checkpointId.trim()
    : typeof input.checkpointId === 'string' && input.checkpointId.trim().length > 0
      ? input.checkpointId.trim()
      : null;
  const commitSha = typeof details?.commitSha === 'string' && details.commitSha.trim().length > 0
    ? details.commitSha.trim()
    : checkpointId;
  const shortSha = typeof details?.shortSha === 'string' && details.shortSha.trim().length > 0
    ? details.shortSha.trim()
    : commitSha?.slice(0, 7) ?? null;
  const title = typeof details?.title === 'string' && details.title.trim().length > 0
    ? details.title.trim()
    : typeof details?.subject === 'string' && details.subject.trim().length > 0
      ? details.subject.trim()
      : shortSha;
  const subject = typeof details?.subject === 'string' && details.subject.trim().length > 0
    ? details.subject.trim()
    : title;

  if (!action || !checkpointId || !commitSha || !shortSha || !title || !subject) {
    return null;
  }

  return {
    action,
    checkpointId,
    commitSha,
    shortSha,
    title,
    subject,
    fileCount: typeof details?.fileCount === 'number' ? details.fileCount : undefined,
    linesAdded: typeof details?.linesAdded === 'number' ? details.linesAdded : undefined,
    linesDeleted: typeof details?.linesDeleted === 'number' ? details.linesDeleted : undefined,
    updatedAt: typeof details?.updatedAt === 'string' ? details.updatedAt : undefined,
    openRequested: typeof details?.openRequested === 'boolean'
      ? details.openRequested
      : input.open === true,
  };
}
