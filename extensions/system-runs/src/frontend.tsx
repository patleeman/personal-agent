export { ActivityShelf } from './ActivityShelf.js';

import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { useAppData } from '@personal-agent/extensions/data';
import {
  ConversationBackgroundWorkRailContent,
  ConversationBackgroundWorkWorkbenchPane,
  getConversationRunIdFromSearch,
  setConversationRunIdInSearch,
} from '@personal-agent/extensions/workbench';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export function ConversationBackgroundWorkPanel({ context }: ExtensionSurfaceProps) {
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
    <ConversationBackgroundWorkRailContent
      conversationId={context.conversationId ?? null}
      runs={runs}
      activeRunId={activeRunId}
      lookups={lookups}
      onOpenRun={handleOpenRun}
    />
  );
}

export function ConversationBackgroundWorkDetailPanel({ context }: ExtensionSurfaceProps) {
  const { sessions, tasks } = useAppData();
  const runId = getConversationRunIdFromSearch(context.search);
  return (
    <ConversationBackgroundWorkWorkbenchPane conversationId={context.conversationId ?? null} runId={runId} lookups={{ sessions, tasks }} />
  );
}

export const ConversationRunsPanel = ConversationBackgroundWorkPanel;
export const ConversationRunDetailPanel = ConversationBackgroundWorkDetailPanel;
