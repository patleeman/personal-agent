/**
 * Arc-style tab model:
 *   - openIds  (localStorage) = sessions promoted to visible tabs
 *   - shelf    = all other sessions, shown collapsed
 *
 * Clicking a shelf item calls openSession() → adds to openIds → tab appears.
 * × on an open tab calls closeSession() → removed from openIds → back to shelf.
 */
import { useCallback, useEffect, useState } from 'react';
import { MOCK_CONVERSATIONS } from '../data/mockConversations';
import type { SessionMeta } from '../types';

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

  useEffect(() => {
    setLoading(true);
    fetch('/api/sessions')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<SessionMeta[]>; })
      .then(data  => { setSessions(data);             setLoading(false); })
      .catch(() => { setSessions(FALLBACK_SESSIONS); setUsingFallback(true); setLoading(false); });
  }, []);

  const openSession = useCallback((id: string) => {
    setOpenIds(prev => { const next = new Set(prev); next.add(id);    saveOpen(next); return next; });
  }, []);

  const closeSession = useCallback((id: string) => {
    setOpenIds(prev => { const next = new Set(prev); next.delete(id); saveOpen(next); return next; });
  }, []);

  // Sessions promoted to tabs (preserve insertion order from sessions list)
  const tabs  = sessions.filter(s =>  openIds.has(s.id));
  // Everything else goes into the shelf
  const shelf = sessions.filter(s => !openIds.has(s.id));

  return { tabs, shelf, openSession, closeSession, loading, usingFallback };
}
