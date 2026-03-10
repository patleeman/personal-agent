import { useEffect, useState } from 'react';
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

export function useSessionDetail(sessionId: string | undefined) {
  const [detail, setDetail]   = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setDetail(null);
    fetch(`/api/sessions/${sessionId}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((data: SessionDetail) => { setDetail(data); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [sessionId]);

  return { detail, loading, error };
}
