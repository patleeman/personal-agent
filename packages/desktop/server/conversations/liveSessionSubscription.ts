import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { readQueueState } from './liveSessionQueue.js';
import { readParallelState, type ParallelPromptJob } from './liveSessionParallelJobs.js';
import {
  buildLiveSessionPresenceState,
  registerLiveSessionSurface,
  removeLiveSessionSurface,
  type LiveSessionPresenceHost,
  type LiveSessionSurfaceType,
} from './liveSessionPresence.js';
import {
  ensureHiddenTurnState,
  shouldExposeHiddenTurnInTranscript,
  type LiveSessionHiddenTurnState,
} from './liveSessionHiddenTurns.js';
import { buildLiveSessionSnapshot } from './liveSessionStateSnapshot.js';
import { readLiveSessionContextUsage } from './liveSessionStateBroadcasts.js';
import type { SseEvent } from './liveSessionEvents.js';

export interface LiveSessionSubscriptionListener {
  send: (event: SseEvent) => void;
  tailBlocks?: number;
}

export interface LiveSessionSubscriptionHost extends LiveSessionPresenceHost, LiveSessionHiddenTurnState {
  session: AgentSession;
  listeners: Set<LiveSessionSubscriptionListener>;
  title: string;
  parallelJobs?: ParallelPromptJob[];
}

export function subscribeLiveSession<TEntry extends LiveSessionSubscriptionHost>(
  entry: TEntry,
  listener: (event: SseEvent) => void,
  options: {
    tailBlocks?: number;
    surface?: {
      surfaceId: string;
      surfaceType: LiveSessionSurfaceType;
    };
  } | undefined,
  callbacks: {
    resolveTitle: (entry: TEntry) => string;
    broadcastPresenceState: (entry: TEntry, options?: { exclude?: LiveSessionSubscriptionListener }) => void;
  },
): () => void {
  const subscription: LiveSessionSubscriptionListener = {
    send: listener,
    tailBlocks: options?.tailBlocks,
  };
  entry.listeners.add(subscription);

  const presenceChanged = options?.surface
    ? registerLiveSessionSurface(entry, options.surface)
    : false;

  replayLiveSessionState(entry, subscription, options, callbacks.resolveTitle);

  if (presenceChanged) {
    callbacks.broadcastPresenceState(entry, { exclude: subscription });
  }

  return () => {
    entry.listeners.delete(subscription);
    if (options?.surface && removeLiveSessionSurface(entry, options.surface.surfaceId)) {
      callbacks.broadcastPresenceState(entry);
    }
  };
}

function replayLiveSessionState<TEntry extends LiveSessionSubscriptionHost>(
  entry: TEntry,
  subscription: LiveSessionSubscriptionListener,
  options: { tailBlocks?: number; surface?: { surfaceId: string; surfaceType: LiveSessionSurfaceType } } | undefined,
  resolveTitle: (entry: TEntry) => string,
): void {
  ensureHiddenTurnState(entry);
  subscription.send({ type: 'snapshot', ...buildLiveSessionSnapshot(entry, options?.tailBlocks) });
  const title = resolveTitle(entry);
  if (title) {
    subscription.send({ type: 'title_update', title });
  }
  subscription.send({ type: 'context_usage', usage: readLiveSessionContextUsage(entry.session) });
  subscription.send({ type: 'queue_state', ...readQueueState(entry.session) });
  subscription.send({ type: 'parallel_state', jobs: readParallelState(entry.parallelJobs) });
  if (options?.surface || (entry.presenceBySurfaceId?.size ?? 0) > 0) {
    subscription.send({ type: 'presence_state', state: buildLiveSessionPresenceState(entry) });
  }
  if (entry.session.isStreaming
    && (!entry.activeHiddenTurnCustomType || shouldExposeHiddenTurnInTranscript(entry.activeHiddenTurnCustomType))) {
    subscription.send({ type: 'agent_start' });
  }
}
