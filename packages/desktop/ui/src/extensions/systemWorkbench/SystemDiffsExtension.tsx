import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  ConversationCheckpointWorkbenchPane,
  ConversationDiffRailContent,
  useConversationCheckpointSummaries,
} from '../../components/ConversationCheckpointWorkbench';
import { getConversationCheckpointIdFromSearch, setConversationCheckpointIdInSearch } from '../../conversation/conversationCheckpoints';
import type { ExtensionSurfaceProps } from '../types';

export function ConversationDiffsPanel({ context }: ExtensionSurfaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { checkpoints, loading, error } = useConversationCheckpointSummaries(context.conversationId ?? null);
  const activeCheckpointId = getConversationCheckpointIdFromSearch(searchParams.toString());
  const handleOpenCheckpoint = useCallback(
    (checkpointId: string) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('file');
        next.delete('artifact');
        next.delete('run');
        return new URLSearchParams(setConversationCheckpointIdInSearch(next.toString(), checkpointId));
      });
    },
    [setSearchParams],
  );

  return (
    <ConversationDiffRailContent
      checkpoints={checkpoints}
      activeCheckpointId={activeCheckpointId}
      loading={loading}
      error={error}
      onOpenCheckpoint={handleOpenCheckpoint}
      workspaceCwd={context.cwd ?? null}
    />
  );
}

export function ConversationDiffDetailPanel({ context }: ExtensionSurfaceProps) {
  const checkpointId = getConversationCheckpointIdFromSearch(context.search);
  return (
    <ConversationCheckpointWorkbenchPane
      conversationId={context.conversationId ?? null}
      checkpointId={checkpointId}
      onMissingCheckpoint={() => undefined}
      workspaceCwd={context.cwd ?? null}
    />
  );
}
