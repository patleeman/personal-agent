import type { ConversationContextDocRef, LiveSessionContext } from '../shared/types';
import { parseSlashInput } from '../commands/slashMenu';
import type { MentionItem } from './conversationMentions';

const COMPOSER_SHELF_TEXT_MAX_CHARS = 640;
const COMPOSER_SHELF_TEXT_MAX_LINES = 8;

export function resolveConversationAutocompleteCatalogDemand(input: string): {
  needsMemoryData: boolean;
  needsVaultFiles: boolean;
} {
  const slashInput = parseSlashInput(input);
  const showModelPicker = slashInput?.command === '/model' && input.startsWith('/model ');
  const hasMentionQuery = /(^|.*\s)(@[\w./-]*)$/.test(input);

  return {
    needsMemoryData: hasMentionQuery || Boolean(slashInput && !showModelPicker),
    needsVaultFiles: hasMentionQuery,
  };
}

export function isAttachableMentionItem(item: MentionItem): item is MentionItem & { path: string } {
  return (item.kind === 'note' || item.kind === 'file')
    && typeof item.path === 'string'
    && item.path.trim().length > 0;
}

export function mentionItemToConversationContextDoc(item: MentionItem & { path: string }): ConversationContextDocRef {
  return {
    path: item.path,
    title: item.title?.trim() || item.label,
    kind: item.kind === 'note' ? 'doc' : 'file',
    ...(item.id ? { mentionId: item.id } : {}),
    ...(item.summary?.trim() ? { summary: item.summary.trim() } : {}),
  };
}

export function dedupeConversationContextDocs(docs: ConversationContextDocRef[]): ConversationContextDocRef[] {
  const next: ConversationContextDocRef[] = [];
  const seenPaths = new Set<string>();
  for (const doc of docs) {
    const path = doc.path.trim();
    if (!path || seenPaths.has(path)) {
      continue;
    }

    seenPaths.add(path);
    next.push({
      ...doc,
      path,
      title: doc.title.trim() || path,
    });
  }

  return next;
}

export function truncateConversationShelfText(
  text: string,
  options: { maxChars?: number; maxLines?: number } = {},
): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const maxChars = Math.max(1, options.maxChars ?? COMPOSER_SHELF_TEXT_MAX_CHARS);
  const maxLines = Math.max(1, options.maxLines ?? COMPOSER_SHELF_TEXT_MAX_LINES);
  const lines = normalized.split('\n');
  const truncatedByLines = lines.length > maxLines;
  const lineLimited = truncatedByLines ? lines.slice(0, maxLines).join('\n') : normalized;
  const truncatedByChars = lineLimited.length > maxChars;
  const charLimited = truncatedByChars ? `${lineLimited.slice(0, maxChars).trimEnd()}…` : lineLimited;

  if (!truncatedByLines) {
    return charLimited;
  }

  return charLimited.endsWith('…') ? charLimited : `${charLimited.trimEnd()}…`;
}

export function formatQueuedPromptShelfText(text: string, imageCount: number): string {
  if (text.trim().length > 0) {
    return text;
  }

  if (imageCount > 0) {
    return '(image only)';
  }

  return '(empty queued prompt)';
}

export function formatQueuedPromptImageSummary(imageCount: number): string | null {
  if (imageCount <= 0) {
    return null;
  }

  return `${imageCount} image${imageCount === 1 ? '' : 's'} attached`;
}

export function formatParallelJobStatusLabel(status: 'running' | 'ready' | 'failed' | 'importing'): string {
  switch (status) {
    case 'running':
      return 'running';
    case 'ready':
      return 'queued';
    case 'failed':
      return 'failed';
    case 'importing':
      return 'appending';
  }
}

export function formatParallelJobContextSummary(input: {
  imageCount: number;
  attachmentRefs: string[];
}): string | null {
  const parts: string[] = [];
  if (input.imageCount > 0) {
    parts.push(`${input.imageCount} image${input.imageCount === 1 ? '' : 's'}`);
  }
  if (input.attachmentRefs.length > 0) {
    parts.push(`${input.attachmentRefs.length} attachment${input.attachmentRefs.length === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function formatComposerActionLabel(label: 'Steer' | 'Follow up' | 'Parallel'): string {
  return label === 'Follow up' ? 'followup' : label.toLowerCase();
}

export function resolveConversationGitSummaryPresentation(git: LiveSessionContext['git']):
  | { kind: 'none' }
  | { kind: 'summary'; text: string }
  | { kind: 'diff'; added: string; deleted: string } {
  if (!git) {
    return { kind: 'none' };
  }

  if (git.linesAdded === 0 && git.linesDeleted === 0) {
    return {
      kind: 'summary',
      text: git.changeCount > 0 ? `${git.changeCount} files` : 'clean',
    };
  }

  return {
    kind: 'diff',
    added: `+${git.linesAdded.toLocaleString()}`,
    deleted: `-${git.linesDeleted.toLocaleString()}`,
  };
}
