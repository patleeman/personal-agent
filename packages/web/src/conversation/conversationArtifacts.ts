import type { ConversationArtifactToolDetails, MessageBlock } from '../shared/types';

const CONVERSATION_ARTIFACT_QUERY_PARAM = 'artifact';
const MAX_ARTIFACT_REVISION = 1_000_000;

interface ConversationArtifactPresentation {
  action: 'save' | 'get' | 'list' | 'delete';
  artifactId: string;
  title: string;
  kind: 'html' | 'mermaid' | 'latex';
  revision?: number;
  updatedAt?: string;
  openRequested: boolean;
}

function isArtifactKind(value: unknown): value is ConversationArtifactPresentation['kind'] {
  return value === 'html' || value === 'mermaid' || value === 'latex';
}

function isArtifactAction(value: unknown): value is ConversationArtifactPresentation['action'] {
  return value === 'save' || value === 'get' || value === 'list' || value === 'delete';
}

function normalizeToolDetails(value: unknown): ConversationArtifactToolDetails | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ConversationArtifactToolDetails>;
  if (!isArtifactAction(candidate.action)) {
    return null;
  }

  return candidate as ConversationArtifactToolDetails;
}

export function getConversationArtifactIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(CONVERSATION_ARTIFACT_QUERY_PARAM)?.trim();
  return value ? value : null;
}

export function setConversationArtifactIdInSearch(search: string, artifactId: string | null): string {
  const params = new URLSearchParams(search);
  if (artifactId?.trim()) {
    params.set(CONVERSATION_ARTIFACT_QUERY_PARAM, artifactId.trim());
  } else {
    params.delete(CONVERSATION_ARTIFACT_QUERY_PARAM);
  }

  const next = params.toString();
  return next.length > 0 ? `?${next}` : '';
}

export function readArtifactPresentation(block: Extract<MessageBlock, { type: 'tool_use' }>): ConversationArtifactPresentation | null {
  if (block.tool !== 'artifact') {
    return null;
  }

  const details = normalizeToolDetails(block.details);
  const input = block.input as {
    action?: unknown;
    artifactId?: unknown;
    title?: unknown;
    kind?: unknown;
    open?: unknown;
  };

  const action = details?.action ?? (isArtifactAction(input.action) ? input.action : undefined);
  const artifactId = typeof details?.artifactId === 'string' && details.artifactId.trim().length > 0
    ? details.artifactId.trim()
    : typeof input.artifactId === 'string' && input.artifactId.trim().length > 0
      ? input.artifactId.trim()
      : null;
  const title = typeof details?.title === 'string' && details.title.trim().length > 0
    ? details.title.trim()
    : typeof input.title === 'string' && input.title.trim().length > 0
      ? input.title.trim()
      : artifactId;
  const kind = isArtifactKind(details?.kind)
    ? details.kind
    : isArtifactKind(input.kind)
      ? input.kind
      : null;

  if (!action || !artifactId || !title || !kind || (action !== 'save' && action !== 'get')) {
    return null;
  }

  return {
    action,
    artifactId,
    title,
    kind,
    revision: typeof details?.revision === 'number'
      && Number.isSafeInteger(details.revision)
      && details.revision > 0
      && details.revision <= MAX_ARTIFACT_REVISION
      ? details.revision
      : undefined,
    updatedAt: typeof details?.updatedAt === 'string' ? details.updatedAt : undefined,
    openRequested: typeof details?.openRequested === 'boolean'
      ? details.openRequested
      : input.open === true,
  };
}
