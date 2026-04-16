import { useCallback } from 'react';
import type { MentionItem } from '../conversation/conversationMentions';
import { useApi, type UseApiResult } from './useApi';

export function invalidateNodeMentionItemsCache(): void {
}

export function useNodeMentionItems(): UseApiResult<MentionItem[]> {
  const fetcher = useCallback(async () => [] as MentionItem[], []);
  return useApi(fetcher, 'node-mentions');
}
