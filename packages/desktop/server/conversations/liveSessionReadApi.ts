import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { normalizeModelContextWindow } from '../models/modelContextWindows.js';
import type { LiveContextUsage } from './liveSessionEvents.js';
import { resolveLiveSessionFile } from './liveSessionPersistence.js';
import { hasQueuedOrActiveStaleTurn, type LiveSessionStaleTurnState } from './liveSessionStaleTurns.js';
import { readLiveSessionContextUsage } from './liveSessionStateBroadcasts.js';

export interface LiveSessionReadHost extends LiveSessionStaleTurnState {
  cwd: string;
  session: AgentSession;
  title: string;
  lastDurableRunState?: string;
  isCompacting?: boolean;
}

/** Single canonical function that determines whether a live session is running.
 *  All consumers must use this — no re-derivation in other modules.
 *
 *  A session is running when:
 *   - The agent is actively streaming (agent runtime), OR
 *   - A manual/auto compaction is in progress, OR
 *   - The durable run state is 'running' or 'recovering'
 *
 *  The lastDurableRunState guard handles the race where agent_end fires before
 *  session.isStreaming is cleared by the Pi runtime. When lastDurableRunState
 *  is 'waiting' and there's no queued stale turn state, the session is truly idle. */
export function computeLiveSessionRunning(entry: LiveSessionReadHost): boolean {
  if (entry.isCompacting) {
    return true;
  }
  if (entry.lastDurableRunState === 'waiting') {
    return false;
  }
  return Boolean(entry.session.isStreaming || entry.lastDurableRunState === 'running' || entry.lastDurableRunState === 'recovering');
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
    running: computeLiveSessionRunning(entry),
    isStreaming:
      // lastDurableRunState is the authoritative state — it transitions to 'waiting'
      // synchronously in syncLiveSessionDurableRun before session.isStreaming is
      // cleared by the agent runtime. Without this guard the conversation appears
      // permanently 'running' because agent_end listeners (handleLiveSessionEvent)
      // fire before the agent's finishRun() sets isStreaming = false.
      entry.isCompacting
        ? true
        : entry.lastDurableRunState === 'waiting'
          ? false
          : entry.session.isStreaming || entry.lastDurableRunState === 'running' || entry.lastDurableRunState === 'recovering',
    hasStaleTurnState: hasQueuedOrActiveStaleTurn(entry),
    ...(entry.lastDurableRunState ? { lastDurableRunState: entry.lastDurableRunState } : {}),
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
  try {
    return entry.session.getSessionStats();
  } catch {
    return null;
  }
}

export function getLiveSessionContextUsage(entry: LiveSessionReadHost | undefined): LiveContextUsage | null {
  if (!entry) return null;
  return readLiveSessionContextUsage(entry.session);
}

export function formatAvailableModels(
  models: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    provider?: string;
    api?: unknown;
    input?: Array<'text' | 'image'>;
    reasoning?: boolean;
  }>,
) {
  return models.map((model) => {
    const contextWindow = normalizeModelContextWindow(model.id, model.contextWindow, 128_000);
    return {
      id: model.id,
      name: model.name ?? model.id,
      context: contextWindow,
      contextWindow,
      provider: model.provider ?? '',
      api: model.api,
      input: model.input,
      reasoning: model.reasoning,
    };
  });
}
