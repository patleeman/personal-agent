import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SessionDetail, SessionMeta } from '../types';

// ── Session list ──────────────────────────────────────────────────────────────

export function useSessions() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sessions')
      .then(r => r.json())
      .then((data: SessionMeta[]) => { setSessions(data); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  return { sessions, loading, error };
}

// ── Session detail ────────────────────────────────────────────────────────────

export function useSessionDetail(sessionId: string | undefined, options?: { tailBlocks?: number }) {
  const [detail, setDetail]   = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

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
  }, [options?.tailBlocks, sessionId]);

  return { detail, loading, error };
}
