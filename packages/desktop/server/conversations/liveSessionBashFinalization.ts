import type { AgentSession } from '@mariozechner/pi-coding-agent';

import type { SseEvent } from './liveSessionEvents.js';
import { buildFallbackTitleFromContent, isPlaceholderConversationTitle } from './liveSessionTitle.js';

export interface LiveSessionBashFinalizationHost {
  sessionId: string;
  session: AgentSession;
  title: string;
}

export function finalizeLiveSessionBashExecution<TEntry extends LiveSessionBashFinalizationHost>(
  entry: TEntry,
  normalizedCommand: string,
  callbacks: {
    broadcastTitle: (entry: TEntry) => void;
    broadcast: (entry: TEntry, event: SseEvent) => void;
    clearContextUsageTimer: (entry: TEntry) => void;
    broadcastContextUsage: (entry: TEntry, force?: boolean) => void;
    broadcastSnapshot: (entry: TEntry) => void;
    publishSessionMetaChanged: (sessionId: string) => void;
  },
): void {
  if (entry.session.isStreaming) {
    return;
  }

  if (!entry.session.sessionName?.trim() && isPlaceholderConversationTitle(entry.title)) {
    const fallbackTitle = buildFallbackTitleFromContent([{ type: 'text', text: normalizedCommand }]);
    if (fallbackTitle) {
      entry.title = fallbackTitle;
      callbacks.broadcastTitle(entry);
    }
  }

  try {
    const stats = entry.session.getSessionStats();
    callbacks.broadcast(entry, { type: 'stats_update', tokens: stats.tokens, cost: stats.cost });
  } catch {
    // ignore stats errors for bash-only updates
  }

  callbacks.clearContextUsageTimer(entry);
  callbacks.broadcastContextUsage(entry, true);
  callbacks.broadcastSnapshot(entry);
  callbacks.publishSessionMetaChanged(entry.sessionId);
}
