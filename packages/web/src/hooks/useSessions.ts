import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAppEvents } from '../contexts';
import type { SessionDetail, SessionMeta } from '../types';

export function useSessions() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sessions')
      .then((response) => response.json())
      .then((data: SessionMeta[]) => {
        setSessions(data);
        setLoading(false);
      })
      .catch((nextError) => {
        setError(String(nextError));
        setLoading(false);
      });
  }, []);

  return { sessions, loading, error };
}

export function useSessionDetail(sessionId: string | undefined, options?: { tailBlocks?: number }) {
  const { versions } = useAppEvents();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail((current) => current?.meta.id === sessionId ? current : null);

    api.sessionDetail(sessionId, options)
      .then((data) => {
        if (cancelled) {
          return;
        }

        setDetail(data);
        setLoading(false);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [options?.tailBlocks, sessionId, versions.sessions]);

  return { detail, loading, error };
}
