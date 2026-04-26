import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { normalizeModelContextWindow } from '../models/modelContextWindows.js';
import { resolveLiveSessionFile } from './liveSessionPersistence.js';
import { hasQueuedOrActiveHiddenTurn, type LiveSessionHiddenTurnState } from './liveSessionHiddenTurns.js';
import { readLiveSessionContextUsage } from './liveSessionStateBroadcasts.js';
import type { LiveContextUsage } from './liveSessionEvents.js';

export interface LiveSessionReadHost extends LiveSessionHiddenTurnState {
  cwd: string;
  session: AgentSession;
  title: string;
}

export function listLiveSessions<TEntry extends LiveSessionReadHost>(
  entries: Iterable<[string, TEntry]>,
  resolveTitle: (entry: TEntry) => string,
) {
  return Array.from(entries).map(([id, entry]) => ({
    id,
    cwd: entry.cwd,
    sessionFile: resolveLiveSessionFile(entry.session) ?? '',
    title: resolveTitle(entry),
    isStreaming: entry.session.isStreaming && !entry.activeHiddenTurnCustomType,
    hasPendingHiddenTurn: hasQueuedOrActiveHiddenTurn(entry),
  }));
}

export function getLiveSessionForkEntries(entry: LiveSessionReadHost | undefined): unknown[] | null {
  if (!entry) {
    return null;
  }
  return entry.session.getUserMessagesForForking();
}

export function getLiveSessionStats(entry: LiveSessionReadHost | undefined) {
  if (!entry) return null;
  try { return entry.session.getSessionStats(); } catch { return null; }
}

export function getLiveSessionContextUsage(entry: LiveSessionReadHost | undefined): LiveContextUsage | null {
  if (!entry) return null;
  return readLiveSessionContextUsage(entry.session);
}

export function formatAvailableModels(models: Array<{
  id: string;
  name?: string;
  contextWindow?: number;
  provider?: string;
  api?: unknown;
}>) {
  return models.map((model) => {
    const contextWindow = normalizeModelContextWindow(model.id, model.contextWindow, 128_000);
    return {
      id: model.id,
      name: model.name ?? model.id,
      context: contextWindow,
      contextWindow,
      provider: model.provider ?? '',
      api: model.api,
    };
  });
}
