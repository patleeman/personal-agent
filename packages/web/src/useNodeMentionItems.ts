import { useCallback, useEffect } from 'react';
import { api } from './api';
import { buildMentionItems, type MentionItem } from './conversationMentions';
import { useApi, type UseApiResult } from './hooks';
import { MEMORIES_CHANGED_EVENT } from './memoryDocEvents';
import { PROJECTS_CHANGED_EVENT } from './projectEvents';

const NODE_MENTION_CACHE_TTL_MS = 15_000;

let cachedNodeMentionItems: MentionItem[] | null = null;
let cachedNodeMentionItemsFetchedAt = 0;
let pendingNodeMentionItems: Promise<MentionItem[]> | null = null;

function filterNodeMentionItems(items: MentionItem[]): MentionItem[] {
  return items.filter((item) => item.kind === 'project' || item.kind === 'note' || item.kind === 'skill');
}

async function fetchNodeMentionItems(): Promise<MentionItem[]> {
  const now = Date.now();
  if (cachedNodeMentionItems && (now - cachedNodeMentionItemsFetchedAt) < NODE_MENTION_CACHE_TTL_MS) {
    return cachedNodeMentionItems;
  }

  if (pendingNodeMentionItems) {
    return pendingNodeMentionItems;
  }

  pendingNodeMentionItems = Promise.all([
    api.projects(),
    api.memory(),
  ]).then(([projects, memory]) => {
    const items = filterNodeMentionItems(buildMentionItems({
      projects,
      tasks: [],
      memoryDocs: memory.memoryDocs,
      skills: memory.skills,
      profiles: [],
    }));
    cachedNodeMentionItems = items;
    cachedNodeMentionItemsFetchedAt = Date.now();
    return items;
  }).finally(() => {
    pendingNodeMentionItems = null;
  });

  return pendingNodeMentionItems;
}

export function invalidateNodeMentionItemsCache(): void {
  cachedNodeMentionItems = null;
  cachedNodeMentionItemsFetchedAt = 0;
  pendingNodeMentionItems = null;
}

export function useNodeMentionItems(): UseApiResult<MentionItem[]> {
  const fetcher = useCallback(() => fetchNodeMentionItems(), []);
  const result = useApi(fetcher, 'node-mentions');
  const { refetch } = result;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleChanged = () => {
      invalidateNodeMentionItemsCache();
      void refetch({ resetLoading: false });
    };

    window.addEventListener(MEMORIES_CHANGED_EVENT, handleChanged);
    window.addEventListener(PROJECTS_CHANGED_EVENT, handleChanged);
    return () => {
      window.removeEventListener(MEMORIES_CHANGED_EVENT, handleChanged);
      window.removeEventListener(PROJECTS_CHANGED_EVENT, handleChanged);
    };
  }, [refetch]);

  return result;
}
