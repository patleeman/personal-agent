import type { MessageBlock } from '../shared/types';

const CONVERSATION_RUN_QUERY_PARAM = 'run';

interface ConversationRunMention {
  runId: string;
  firstMessageIndex: number;
  lastMessageIndex: number;
  firstSeenAt: string;
  lastSeenAt: string;
  mentionCount: number;
}

function sanitizeIdSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'conversation';
}

export function createConversationLiveRunId(conversationId: string): string {
  return `conversation-live-${sanitizeIdSegment(conversationId)}`;
}

export function getConversationRunIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(CONVERSATION_RUN_QUERY_PARAM)?.trim();
  return value ? value : null;
}

export function setConversationRunIdInSearch(search: string, runId: string | null): string {
  const params = new URLSearchParams(search);
  if (runId?.trim()) {
    params.set(CONVERSATION_RUN_QUERY_PARAM, runId.trim());
  } else {
    params.delete(CONVERSATION_RUN_QUERY_PARAM);
  }

  const next = params.toString();
  return next.length > 0 ? `?${next}` : '';
}

function looksLikeDurableRunId(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith('conversation-live-') || normalized.startsWith('conversation-deferred-resume-')) {
    return normalized.length > 'conversation-live-'.length;
  }

  if (!normalized.startsWith('run-') && !normalized.startsWith('task-')) {
    return false;
  }

  const segments = normalized.split('-');
  if (segments.length < 3) {
    return false;
  }

  const tail = segments.at(-1) ?? '';
  return /\d{4}/.test(normalized) || /^[a-f0-9]{6,}$/i.test(tail) || segments.length >= 5;
}

function addRunId(target: string[], seen: Set<string>, value: string | undefined): void {
  const normalized = value?.trim();
  if (!normalized || !looksLikeDurableRunId(normalized) || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  target.push(normalized);
}

function extractDurableRunIdsFromText(text: string): string[] {
  if (!text.trim()) {
    return [];
  }

  const next: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /pa\s+runs\s+(?:show|logs|cancel)\s+([A-Za-z0-9_-]+)/g,
    /^\s*Run\s+([A-Za-z0-9_-]+)\s*$/gm,
    /^\s*Inspect\s+pa\s+runs\s+show\s+([A-Za-z0-9_-]+)\s*$/gm,
    /"runId"\s*:\s*"([A-Za-z0-9_-]+)"/g,
    /\brunId\b\s*[:=]\s*"?([A-Za-z0-9_-]+)/g,
    /\b((?:conversation-live|conversation-deferred-resume)-[A-Za-z0-9_-]+)\b/g,
    /\b((?:run|task)-[A-Za-z0-9_-]+)\b/g,
  ] as const;

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      addRunId(next, seen, match[1]);
    }
  }

  return next;
}

function stringifyRecord(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

export function extractDurableRunIdsFromBlock(block: MessageBlock): string[] {
  switch (block.type) {
    case 'user':
    case 'text':
    case 'summary':
    case 'thinking':
      return extractDurableRunIdsFromText(block.text);
    case 'error':
      return extractDurableRunIdsFromText(block.message);
    case 'subagent': {
      const parts = [block.name, block.prompt, block.summary].filter((value): value is string => typeof value === 'string');
      return extractDurableRunIdsFromText(parts.join('\n'));
    }
    case 'image':
      return [];
    case 'tool_use': {
      const parts: string[] = [stringifyRecord(block.input)];
      if (block.output) {
        parts.push(block.output);
      }
      if (block.details && typeof block.details === 'object' && !Array.isArray(block.details)) {
        parts.push(stringifyRecord(block.details as Record<string, unknown>));
      }
      return extractDurableRunIdsFromText(parts.join('\n'));
    }
    default:
      return [];
  }
}

export function collectConversationRunMentions(messages: MessageBlock[]): ConversationRunMention[] {
  const mentions = new Map<string, ConversationRunMention>();

  for (const [index, message] of messages.entries()) {
    const runIds = extractDurableRunIdsFromBlock(message);
    for (const runId of runIds) {
      const current = mentions.get(runId);
      if (!current) {
        mentions.set(runId, {
          runId,
          firstMessageIndex: index,
          lastMessageIndex: index,
          firstSeenAt: message.ts,
          lastSeenAt: message.ts,
          mentionCount: 1,
        });
        continue;
      }

      current.lastMessageIndex = index;
      current.lastSeenAt = message.ts;
      current.mentionCount += 1;
    }
  }

  return [...mentions.values()].sort((left, right) => {
    if (left.lastMessageIndex !== right.lastMessageIndex) {
      return right.lastMessageIndex - left.lastMessageIndex;
    }

    if (left.mentionCount !== right.mentionCount) {
      return right.mentionCount - left.mentionCount;
    }

    return left.runId.localeCompare(right.runId);
  });
}
