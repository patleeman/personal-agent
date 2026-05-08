import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAppData } from '../../app/contexts';
import { ConversationRunsRailContent, ConversationRunWorkbenchPane } from '../../components/ConversationRunsWorkbench';
import { getConversationRunIdFromSearch, setConversationRunIdInSearch } from '../../conversation/conversationRuns';
import type { ExtensionSurfaceProps } from '../types';

export function ConversationRunsPanel({ context }: ExtensionSurfaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { runs, sessions, tasks } = useAppData();
  const lookups = useMemo(() => ({ sessions, tasks }), [sessions, tasks]);
  const activeRunId = getConversationRunIdFromSearch(searchParams.toString());
  const handleOpenRun = useCallback(
    (runId: string) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('file');
        next.delete('artifact');
        next.delete('checkpoint');
        return new URLSearchParams(setConversationRunIdInSearch(next.toString(), runId));
      });
    },
    [setSearchParams],
  );

  return (
    <ConversationRunsRailContent
      conversationId={context.conversationId ?? null}
      runs={runs}
      activeRunId={activeRunId}
      lookups={lookups}
      onOpenRun={handleOpenRun}
    />
  );
}

export function ConversationRunDetailPanel({ context }: ExtensionSurfaceProps) {
  const { sessions, tasks } = useAppData();
  const runId = getConversationRunIdFromSearch(context.search);
  return <ConversationRunWorkbenchPane conversationId={context.conversationId ?? null} runId={runId} lookups={{ sessions, tasks }} />;
}
