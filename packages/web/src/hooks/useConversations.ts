/**
 * Arc-style tab model:
 *   - openIds  (localStorage) = sessions promoted to visible tabs
 *   - shelf    = all other sessions, shown collapsed
 *
 * Clicking a shelf item calls openSession() → adds to openIds → tab appears.
 * × on an open tab calls closeSession() → removed from openIds → back to shelf.
 */
import { useCallback, useContext, useEffect, useState } from 'react';
import { MOCK_CONVERSATIONS } from '../data/mockConversations';
import type { SessionMeta } from '../types';
import { LiveTitlesContext } from '../contexts';

const OPEN_KEY = 'pa:open-session-ids';

function loadOpen(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveOpen(ids: Set<string>) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...ids])); } catch { /* ignore */ }
}

// Fallback when API is unreachable
const FALLBACK_SESSIONS: SessionMeta[] = Object.values(MOCK_CONVERSATIONS).map((conv, i) => ({
  id:           conv.id,
  file:         '',
  timestamp:    new Date(Date.now() - i * 3_600_000).toISOString(),
  cwd:          '/Users/patrickc.lee/personal/personal-agent',
  cwdSlug:      '--Users-patrickc.lee-personal-personal-agent--',
  model:        conv.model ?? 'claude-sonnet-4-6',
  title:        conv.title,
  messageCount: conv.messages.length,
}));

export function useConversations() {
  const [sessions,    setSessions]    = useState<SessionMeta[]>([]);
  const [openIds,     setOpenIds]     = useState<Set<string>>(loadOpen);
  const [loading,     setLoading]     = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);
  const { titles: liveTitles } = useContext(LiveTitlesContext);

  const fetchSessions = useCallback(() => {
    setLoading(true);
    // Fetch JSONL sessions + live sessions in parallel
    return Promise.all([
      fetch('/api/sessions').then(r => r.ok ? r.json() as Promise<SessionMeta[]> : []),
      fetch('/api/live-sessions').then(r => r.ok ? r.json() as Promise<{ id: string; cwd: string; sessionFile: string; isStreaming: boolean }[]> : []),
    ])
      .then(([jsonl, live]) => {
        const jsonlIds = new Set((jsonl as SessionMeta[]).map((s: SessionMeta) => s.id));
        // Inject live sessions that don't have a JSONL entry yet
        const syntheticLive: SessionMeta[] = (live as { id: string; cwd: string; sessionFile: string; isStreaming: boolean }[])
          .filter(l => !jsonlIds.has(l.id))
          .map(l => ({
            id:           l.id,
            file:         l.sessionFile,
            timestamp:    new Date().toISOString(),
            cwd:          l.cwd,
            cwdSlug:      l.cwd.replace(/\//g, '-'),
            model:        '',
            title:        '(new conversation)',
            messageCount: 0,
          }));
        const merged = [...syntheticLive, ...(jsonl as SessionMeta[])];
        setSessions(merged);
        setUsingFallback(false);
        setLoading(false);
      })
      .catch(() => { setSessions(FALLBACK_SESSIONS); setUsingFallback(true); setLoading(false); });
  }, []);

  // Poll every 10s (was previously only fetching once)
  useEffect(() => {
    void fetchSessions();
    const timer = setInterval(() => void fetchSessions(), 10_000);
    return () => clearInterval(timer);
  }, [fetchSessions]);

  const openSession = useCallback((id: string) => {
    setOpenIds(prev => { const next = new Set(prev); next.add(id);    saveOpen(next); return next; });
  }, []);

  const closeSession = useCallback((id: string) => {
    setOpenIds(prev => { const next = new Set(prev); next.delete(id); saveOpen(next); return next; });
  }, []);

  // Apply live title overrides (from streaming sessions not yet flushed to JSONL)
  const withTitles = sessions.map(s =>
    liveTitles.has(s.id) ? { ...s, title: liveTitles.get(s.id)! } : s
  );
  const tabs  = withTitles.filter(s =>  openIds.has(s.id));
  const shelf = withTitles.filter(s => !openIds.has(s.id));

  return { tabs, shelf, openSession, closeSession, loading, usingFallback, refetch: fetchSessions };
}
