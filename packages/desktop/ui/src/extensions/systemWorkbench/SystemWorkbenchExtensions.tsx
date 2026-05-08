import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAppData } from '../../app/contexts';
import { api } from '../../client/api';
import { ConversationDiffRailContent } from '../../components/ConversationCheckpointWorkbench';
import { ConversationRunsRailContent } from '../../components/ConversationRunsWorkbench';
import { ErrorState } from '../../components/ui';
import type { ConversationCommitCheckpointSummary } from '../../shared/types';

interface ExtensionSurfaceProps {
  context: {
    conversationId?: string | null;
    cwd?: string | null;
  };
}

export function ConversationRunsPanel({ context }: ExtensionSurfaceProps) {
  const { sessions, tasks, runs, setRuns } = useAppData();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const lookups = useMemo(() => ({ sessions, tasks }), [sessions, tasks]);

  useEffect(() => {
    if (runs) return;
    let cancelled = false;
    api.runs().then((result) => {
      if (!cancelled) setRuns(result);
    });
    return () => {
      cancelled = true;
    };
  }, [runs, setRuns]);

  return (
    <ConversationRunsRailContent
      conversationId={context.conversationId ?? null}
      runs={runs}
      activeRunId={activeRunId}
      lookups={lookups}
      onOpenRun={setActiveRunId}
    />
  );
}

export function ConversationDiffsPanel({ context }: ExtensionSurfaceProps) {
  const conversationId = context.conversationId ?? null;
  const [checkpoints, setCheckpoints] = useState<ConversationCommitCheckpointSummary[]>([]);
  const [activeCheckpointId, setActiveCheckpointId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setCheckpoints([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .conversationCheckpoints(conversationId)
      .then((result) => {
        if (cancelled) return;
        setCheckpoints(result.checkpoints);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const handleOpenCheckpoint = useCallback((checkpointId: string) => {
    setActiveCheckpointId(checkpointId);
  }, []);

  if (!conversationId) return <ErrorState message="Open a conversation to inspect diffs." className="px-3 py-4" />;

  return (
    <ConversationDiffRailContent
      checkpoints={checkpoints}
      activeCheckpointId={activeCheckpointId}
      loading={loading}
      error={error}
      onOpenCheckpoint={handleOpenCheckpoint}
      onScrollToFile={() => {}}
      workspaceCwd={context.cwd ?? null}
    />
  );
}
