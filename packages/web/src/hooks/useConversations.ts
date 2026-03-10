/**
 * Unified conversation list — real Pi sessions from the API,
 * with archived state kept in localStorage.
 *
 * Falls back to mock data if the API is unreachable.
 */
import { useCallback, useEffect, useState } from 'react';
import { MOCK_CONVERSATIONS } from '../data/mockConversations';
import type { SessionMeta } from '../types';

const ARCHIVED_KEY = 'pa:archived-session-ids';

function loadArchived(): Set<string> {
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveArchived(ids: Set<string>) {
  try { localStorage.setItem(ARCHIVED_KEY, JSON.stringify([...ids])); } catch { /* ignore */ }
}

// Fallback when API is unreachable — convert mocks to SessionMeta shape
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
  const [archivedIds, setArchivedIds] = useState<Set<string>>(loadArchived);
  const [loading,     setLoading]     = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sessions')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<SessionMeta[]>; })
      .then(data  => { setSessions(data);             setLoading(false); })
      .catch(() => { setSessions(FALLBACK_SESSIONS); setUsingFallback(true); setLoading(false); });
  }, []);

  const archiveConversation = useCallback((id: string) => {
    setArchivedIds(prev => { const next = new Set(prev); next.add(id);    saveArchived(next); return next; });
  }, []);

  const restoreConversation = useCallback((id: string) => {
    setArchivedIds(prev => { const next = new Set(prev); next.delete(id); saveArchived(next); return next; });
  }, []);

  const open     = sessions.filter(s => !archivedIds.has(s.id));
  const archived = sessions.filter(s =>  archivedIds.has(s.id));

  return { open, archived, archiveConversation, restoreConversation, loading, usingFallback };
}
