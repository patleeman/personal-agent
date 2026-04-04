import { useCallback } from 'react';
import type { MentionItem } from './conversationMentions';
import { useApi, type UseApiResult } from './hooks';

export function invalidateNodeMentionItemsCache(): void {
}

export function useNodeMentionItems(): UseApiResult<MentionItem[]> {
  const fetcher = useCallback(async () => [] as MentionItem[], []);
  return useApi(fetcher, 'node-mentions');
}
