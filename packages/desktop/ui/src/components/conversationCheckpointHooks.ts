import { useEffect, useState } from 'react';

import { useAppEvents } from '../app/contexts';
import { api } from '../client/api';
import type { ConversationCommitCheckpointSummary, UncommittedDiffResult } from '../shared/types';
import { addNotification } from './notifications/notificationStore';

export const UNCOMMITTED_SENTINEL = '__uncommitted__';

export function useUncommittedDiff(cwd: string | null | undefined) {
  const { versions } = useAppEvents();
  const [result, setResult] = useState<UncommittedDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .workspaceUncommittedDiff(cwd)
      .then((data) => {
        if (!cancelled) {
          setResult(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult(null);
          const msg = err instanceof Error ? err.message : 'Failed to load uncommitted changes.';
          setError(msg);
          addNotification({ type: 'error', message: msg, details: err instanceof Error ? err.stack : undefined, source: 'core' });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, versions.workspace]);

  return { result, loading, error };
}

export function useConversationCheckpointSummaries(conversationId: string | null | undefined) {
  const { versions } = useAppEvents();
  const [checkpoints, setCheckpoints] = useState<ConversationCommitCheckpointSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setCheckpoints([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .conversationCheckpoints(conversationId)
      .then((result) => {
        if (!cancelled) {
          setCheckpoints([...result.checkpoints].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCheckpoints([]);
          const msg = err instanceof Error ? err.message : 'Failed to load diffs.';
          setError(msg);
          addNotification({ type: 'error', message: msg, details: err instanceof Error ? err.stack : undefined, source: 'core' });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, versions.checkpoints]);

  return { checkpoints, loading, error };
}
