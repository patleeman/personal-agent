/**
 * Arc-style tab model:
 *   - openIds  (localStorage) = sessions promoted to visible tabs
 *   - shelf    = all other sessions, shown collapsed
 *
 * Clicking a shelf item calls openSession() → adds to openIds → tab appears.
 * × on an open tab calls closeSession() → removed from openIds → back to shelf.
 */
import { useCallback, useContext, useState } from 'react';
import { api } from '../api';
import type { SessionMeta } from '../types';
import { LiveTitlesContext, useAppData, useSseConnection } from '../contexts';

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

async function fetchSessionsSnapshot(): Promise<SessionMeta[]> {
  const [jsonl, live] = await Promise.all([api.sessions(), api.liveSessions()]);
  const jsonlIds = new Set(jsonl.map((session) => session.id));
  const syntheticLive: SessionMeta[] = live
    .filter((entry) => !jsonlIds.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      file: entry.sessionFile,
      timestamp: new Date().toISOString(),
      cwd: entry.cwd,
      cwdSlug: entry.cwd.replace(/\//g, '-'),
      model: '',
      title: '(new conversation)',
      messageCount: 0,
    }));

  return [...syntheticLive, ...jsonl];
}

export function useConversations() {
  const [openIds, setOpenIds] = useState<Set<string>>(loadOpen);
  const { titles: liveTitles } = useContext(LiveTitlesContext);
  const { sessions, setSessions } = useAppData();
  const { status: sseStatus } = useSseConnection();

  const refetch = useCallback(async () => {
    const next = await fetchSessionsSnapshot();
    setSessions(next);
    return next;
  }, [setSessions]);

  const openSession = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveOpen(next);
      return next;
    });
  }, []);

  const closeSession = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      saveOpen(next);
      return next;
    });
  }, []);

  const withTitles = (sessions ?? []).map((session) =>
    liveTitles.has(session.id) ? { ...session, title: liveTitles.get(session.id)! } : session,
  );
  const tabs = withTitles.filter((session) => openIds.has(session.id));
  const shelf = withTitles.filter((session) => !openIds.has(session.id));
  const loading = sessions === null && (sseStatus === 'connecting' || sseStatus === 'reconnecting');

  return { tabs, shelf, openSession, closeSession, loading, refetch };
}
