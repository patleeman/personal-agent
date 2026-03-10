import { useState, useCallback } from 'react';

export interface Conversation {
  id: string;
  title: string;
  subtitle?: string;
  updatedAt: string;
  workstreamId?: string;
  pinned: boolean;
  archived: boolean;
  running?: boolean;
}

const STORAGE_KEY = 'pa:conversations';

const SEED: Conversation[] = [
  {
    id: 'live-research',
    title: 'LLM tool use research',
    subtitle: 'Searching arxiv, semantic scholar…',
    updatedAt: new Date().toISOString(),
    running: true,
    pinned: false,
    archived: false,
  },
  {
    id: 'web-ui-iteration',
    title: 'web UI iteration',
    subtitle: 'Arc sidebar, chat interface, context rail',
    updatedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
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
    id: 'screenshot-review',
    title: 'UI screenshot review',
    subtitle: 'Light/dark mode issues flagged',
    updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    workstreamId: 'web-ui',
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
    id: 'rewind-fork-demo',
    title: 'pipeline debug + fork',
    subtitle: 'GitLab CI TS errors, forked at msg 7',
    updatedAt: new Date(Date.now() - 8 * 3600_000).toISOString(),
    pinned: false,
    archived: false,
  },
  {
    id: 'daily-standup-0310',
    title: 'daily standup review',
    updatedAt: new Date(Date.now() - 24 * 3600_000).toISOString(),
    pinned: false,
    archived: true,
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
