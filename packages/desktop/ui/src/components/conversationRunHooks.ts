import { useMemo } from 'react';

import { listConnectedConversationBackgroundRuns, type RunPresentationLookups } from '../automation/runPresentation';
import type { DurableRunListResult } from '../shared/types';

export function useConversationRunList(
  conversationId: string | null | undefined,
  runs: DurableRunListResult | null,
  lookups: RunPresentationLookups,
) {
  return useMemo(() => {
    if (!conversationId) return [];
    return listConnectedConversationBackgroundRuns({ conversationId, runs, lookups });
  }, [conversationId, lookups, runs]);
}
