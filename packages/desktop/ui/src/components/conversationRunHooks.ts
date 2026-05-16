import { useMemo } from 'react';

import type { ExecutionListResult } from '../shared/types';

export function useConversationExecutionList(conversationId: string | null | undefined, executions: ExecutionListResult | null) {
  return useMemo(() => {
    if (!conversationId) return [];
    return (executions?.executions ?? []).filter(
      (execution) =>
        execution.conversationId === conversationId &&
        execution.visibility === 'primary' &&
        (execution.kind === 'background-command' || execution.kind === 'subagent'),
    );
  }, [conversationId, executions]);
}
