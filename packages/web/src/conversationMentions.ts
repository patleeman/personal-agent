import type { MemoryDocItem, MemorySkillItem, ScheduledTaskSummary } from './types';

export type MentionKind = 'task' | 'note' | 'skill' | 'profile';

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
    skill: 2,
    profile: 3,
  };

  return kindOrder[left.kind] - kindOrder[right.kind]
    || left.id.localeCompare(right.id);
}

function extractMentionIds(text: string): string[] {
  const matches = text.match(/@[a-zA-Z0-9][a-zA-Z0-9-_]*/g) ?? [];
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    if (seen.has(match)) {
      continue;
    }

    seen.add(match);
    ids.push(match);
  }

  return ids;
}

export function buildMentionItems(input: {
  tasks: ScheduledTaskSummary[];
  memoryDocs: MemoryDocItem[];
  skills?: MemorySkillItem[];
  profiles: string[];
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
    ...(input.skills ?? []).map((skill) => ({
      id: `@${skill.name}`,
      label: skill.name,
      kind: 'skill' as const,
      title: skill.name,
      summary: skill.description,
    })),
    ...input.profiles.map((profile) => ({
      id: `@${profile}`,
      label: profile,
      kind: 'profile' as const,
      title: `${profile} profile`,
      summary: `${profile} profile instructions`,
    })),
  ];

  return items.sort(compareMentionItems);
}

export function filterMentionItems(items: MentionItem[], query: string): MentionItem[] {
  const normalizedQuery = query.replace(/^@/, '').trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) => {
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
}

export function resolveMentionItems(text: string, items: MentionItem[]): MentionItem[] {
  const mentionIds = extractMentionIds(text);

  return mentionIds.flatMap((id) => items.filter((item) => item.id === id));
}
