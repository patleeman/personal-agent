import type { MemoryDocItem, ScheduledTaskSummary, VaultFileSummary } from './types';

export const MAX_MENTION_MENU_ITEMS = 12;

export type MentionKind = 'task' | 'note' | 'skill' | 'profile' | 'file';

export interface MentionItem {
  id: string;
  label: string;
  kind: MentionKind;
  title?: string;
  summary?: string;
}

function compareMentionItems(left: MentionItem, right: MentionItem): number {
  const kindOrder: Record<MentionKind, number> = {
    task: 0,
    note: 1,
    file: 2,
    skill: 3,
    profile: 4,
  };

  return kindOrder[left.kind] - kindOrder[right.kind]
    || left.id.localeCompare(right.id);
}

const MENTION_REGEX = /@[A-Za-z0-9_][A-Za-z0-9_./-]*/g;
const TRAILING_MENTION_PUNCTUATION_REGEX = /[),.;:!?\]}>]+$/;

function normalizeMentionId(rawValue: string): string {
  return rawValue.replace(TRAILING_MENTION_PUNCTUATION_REGEX, '');
}

function extractMentionIds(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null = null;

  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const start = match.index;
    const previous = start > 0 ? text[start - 1] : '';
    if (start > 0 && /[\w./+-]/.test(previous)) {
      continue;
    }

    const id = `@${normalizeMentionId(match[0].slice(1))}`;
    if (id === '@' || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export function buildMentionItems(input: {
  tasks: ScheduledTaskSummary[];
  memoryDocs: MemoryDocItem[];
  vaultFiles: VaultFileSummary[];
}): MentionItem[] {
  const items: MentionItem[] = [
    ...input.tasks.map((task) => ({
      id: `@${task.id}`,
      label: task.id,
      kind: 'task' as const,
      title: task.id,
      summary: task.prompt,
    })),
    ...input.memoryDocs.map((doc) => ({
      id: `@${doc.id}`,
      label: doc.id,
      kind: 'note' as const,
      title: doc.title,
      summary: doc.summary,
    })),
    ...input.vaultFiles.map((file) => ({
      id: `@${file.id}`,
      label: file.id,
      kind: 'file' as const,
      title: file.name,
      summary: file.path,
    })),
  ];

  return items.sort(compareMentionItems);
}

export function filterMentionItems(
  items: MentionItem[],
  query: string,
  options: { limit?: number } = {},
): MentionItem[] {
  const normalizedQuery = query.replace(/^@/, '').trim().toLowerCase();
  const filtered = !normalizedQuery
    ? items
    : items.filter((item) => {
      const haystacks = [
        item.id,
        item.label,
        item.title,
        item.summary,
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase());

      return haystacks.some((value) => value.includes(normalizedQuery));
    });

  const limit = options.limit;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) {
    return filtered.slice(0, limit);
  }

  return filtered;
}

export function resolveMentionItems(text: string, items: MentionItem[]): MentionItem[] {
  const mentionIds = extractMentionIds(text);

  return mentionIds.flatMap((id) => items.filter((item) => item.id === id));
}
