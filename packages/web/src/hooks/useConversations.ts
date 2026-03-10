import { useState, useCallback } from 'react';

export interface Conversation {
  id: string;
  title: string;
  subtitle?: string;
  updatedAt: string;
  workstreamId?: string;
  pinned: boolean;
  archived: boolean;
}

const STORAGE_KEY = 'pa:conversations';

const SEED: Conversation[] = [
  {
    id: 'web-ui-iteration',
    title: 'web UI iteration',
    subtitle: 'Redesigning sidebar with Arc-style tabs',
    updatedAt: new Date().toISOString(),
    workstreamId: 'web-ui',
    pinned: false,
    archived: false,
  },
  {
    id: 'artifact-model-planning',
    title: 'artifact model planning',
    subtitle: 'Define workstream + artifact schema',
    updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    workstreamId: 'artifact-model',
    pinned: false,
    archived: false,
  },
  {
    id: 'daemon-task-wiring',
    title: 'daemon task → activity',
    subtitle: 'Wire task success/failure to durable activity',
    updatedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    pinned: false,
    archived: false,
  },
  {
    id: 'daily-standup-0310',
    title: 'daily standup review',
    updatedAt: new Date(Date.now() - 24 * 3600_000).toISOString(),
    pinned: false,
    archived: false,
  },
];

function load(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Conversation[];
  } catch { /* ignore */ }
  const seed = SEED;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(seed)); } catch { /* ignore */ }
  return seed;
}

function save(convs: Conversation[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(convs)); } catch { /* ignore */ }
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(load);

  const update = useCallback((next: Conversation[]) => {
    setConversations(next);
    save(next);
  }, []);

  const archiveConversation = useCallback((id: string) => {
    update(conversations.map(c => c.id === id ? { ...c, archived: true } : c));
  }, [conversations, update]);

  const restoreConversation = useCallback((id: string) => {
    update(conversations.map(c => c.id === id ? { ...c, archived: false } : c));
  }, [conversations, update]);

  const newConversation = useCallback((): Conversation => {
    const id = `conv-${Date.now()}`;
    const conv: Conversation = {
      id,
      title: 'new conversation',
      updatedAt: new Date().toISOString(),
      pinned: false,
      archived: false,
    };
    update([conv, ...conversations]);
    return conv;
  }, [conversations, update]);

  const open = conversations.filter(c => !c.archived);
  const archived = conversations.filter(c => c.archived);

  return { open, archived, archiveConversation, restoreConversation, newConversation };
}
