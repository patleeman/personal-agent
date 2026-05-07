import { estimateTokens } from '@earendil-works/pi-coding-agent';

import { invalidateAppTopics, publishAppEvent } from '../shared/appEvents.js';
import { persistTraceContext } from '../traces/tracePersistence.js';
import type { WebLiveConversationRunState } from './conversationRuns.js';
import { syncLiveSessionDurableRun } from './liveSessionDurableRun.js';
import type { LiveContextUsage, SseEvent } from './liveSessionEvents.js';
import { broadcastLiveSessionPresenceState } from './liveSessionPresenceFacade.js';
import { computeLiveSessionRunning } from './liveSessionReadApi.js';
import {
  broadcastLiveSessionAutoModeState,
  broadcastLiveSessionContextUsage,
  broadcastLiveSessionParallelState,
  broadcastLiveSessionQueueState,
  clearLiveSessionContextUsageTimer,
  scheduleLiveSessionContextUsage,
} from './liveSessionStateBroadcasts.js';
import { type LiveEntry, type LiveListener } from './liveSessionTypes.js';

/** Send an SSE event to every listener subscribed to this live session. */
export function broadcast(entry: LiveEntry, event: SseEvent, options?: { exclude?: LiveListener }): void {
  for (const listener of entry.listeners) {
    if (listener === options?.exclude) {
      continue;
    }
    listener.send(event);
  }
}

export function broadcastSnapshot(
  entry: LiveEntry,
  callbacks: {
    buildLiveSessionSnapshot: (entry: LiveEntry, tailBlocks?: number) => Record<string, unknown>;
    ensureHiddenTurnState: (entry: LiveEntry) => void;
  },
): void {
  callbacks.ensureHiddenTurnState(entry);
  for (const listener of entry.listeners) {
    listener.send({
      type: 'snapshot',
      ...callbacks.buildLiveSessionSnapshot(entry, listener.tailBlocks),
    });
  }
}

export function publishRunningChange(entry: LiveEntry): void {
  const next = computeLiveSessionRunning(entry);
  if (next === entry.running) return;
  entry.running = next;
  publishAppEvent({ type: 'session_meta_changed', sessionId: entry.sessionId, running: next });
  invalidateAppTopics('sessions');
}

export function broadcastTitle(
  entry: LiveEntry,
  callbacks: {
    resolveEntryTitle: (entry: LiveEntry) => string;
    publishSessionMetaChanged: (sessionId: string) => void;
  },
): void {
  const title = callbacks.resolveEntryTitle(entry);
  if (!title) {
    return;
  }

  entry.title = title;
  broadcast(entry, { type: 'title_update', title });
  publishAppEvent({ type: 'live_title', sessionId: entry.sessionId, title });
  callbacks.publishSessionMetaChanged(entry.sessionId);
}

export function applySessionTitle(
  entry: LiveEntry,
  title: string,
  callbacks: {
    resolveEntryTitle: (entry: LiveEntry) => string;
    publishSessionMetaChanged: (sessionId: string) => void;
  },
): void {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return;
  }

  entry.session.setSessionName(normalizedTitle);
  entry.title = normalizedTitle;
  broadcastTitle(entry, callbacks);
}

export async function syncDurableConversationRun(
  entry: LiveEntry,
  state: WebLiveConversationRunState,
  input: { force?: boolean; lastError?: string } = {},
): Promise<void> {
  await syncLiveSessionDurableRun(entry, state, input);
}

export function broadcastContextUsage(
  entry: LiveEntry,
  callbacks: {
    readLiveSessionContextUsageForEntry: (entry: LiveEntry) => LiveContextUsage | null;
  },
  force = false,
): void {
  const usage = callbacks.readLiveSessionContextUsageForEntry(entry);
  if (usage) {
    const userSeg = usage.segments?.find((s) => s.key === 'user');
    const assistantSeg = usage.segments?.find((s) => s.key === 'assistant');
    const toolSeg = usage.segments?.find((s) => s.key === 'tool');
    const summarySeg = usage.segments?.find((s) => s.key === 'summary');
    const systemPromptText = entry.session.systemPrompt ?? '';
    const systemPromptTokens =
      systemPromptText.length > 0 ? estimateTokens({ role: 'user', content: [{ type: 'text', text: systemPromptText }] }) : 0;
    persistTraceContext({
      sessionId: entry.sessionId,
      modelId: usage.modelId ?? entry.session.model?.id,
      totalTokens: usage.tokens ?? 0,
      contextWindow: usage.contextWindow ?? 0,
      pct: usage.percent != null ? Math.round(usage.percent * 100) / 100 : 0,
      segSystem: systemPromptTokens,
      segUser: userSeg?.tokens ?? 0,
      segAssistant: assistantSeg?.tokens ?? 0,
      segTool: toolSeg?.tokens ?? 0,
      segSummary: summarySeg?.tokens ?? 0,
      systemPromptTokens,
    });
  }
  broadcastLiveSessionContextUsage(entry, (event) => broadcast(entry, event), force);
}

export function broadcastQueueState(entry: LiveEntry, force = false): void {
  broadcastLiveSessionQueueState(entry, (event) => broadcast(entry, event), force);
}

export function broadcastParallelState(entry: LiveEntry, force = false): void {
  broadcastLiveSessionParallelState(entry, (event) => broadcast(entry, event), force);
}

export function broadcastAutoModeState(entry: LiveEntry, force = false): void {
  broadcastLiveSessionAutoModeState(entry, (event) => broadcast(entry, event), force);
}

export function scheduleContextUsage(entry: LiveEntry, delayMs = 400): void {
  scheduleLiveSessionContextUsage(entry, (event) => broadcast(entry, event), delayMs);
}

export function clearContextUsageTimer(entry: LiveEntry): void {
  clearLiveSessionContextUsageTimer(entry);
}

export function broadcastPresenceState(entry: LiveEntry, options?: { exclude?: LiveListener }): void {
  broadcastLiveSessionPresenceState(entry, { broadcast }, options);
}
