import { useEffect, useState } from 'react';

import { useAppEvents } from '../app/contexts';
import { api } from '../client/api';
import type { ConversationArtifactSummary } from '../shared/types';
import { addNotification } from './notifications/notificationStore';

export function useConversationArtifactSummaries(conversationId: string | null | undefined) {
  const { versions } = useAppEvents();
  const [artifacts, setArtifacts] = useState<ConversationArtifactSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setArtifacts([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .conversationArtifacts(conversationId)
      .then((result) => {
        if (!cancelled) {
          setArtifacts(result.artifacts);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setArtifacts([]);
          const msg = err instanceof Error ? err.message : 'Failed to load artifacts.';
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
  }, [conversationId, versions.artifacts]);

  return { artifacts, loading, error };
}
