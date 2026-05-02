import type { AgentSession } from '@mariozechner/pi-coding-agent';
import type { WebLiveConversationRunState } from './conversationRuns.js';

export interface LiveSessionDestroyHost {
  sessionId: string;
  session: AgentSession;
}

export function destroyLiveSession<TEntry extends LiveSessionDestroyHost>(
  sessionId: string,
  input: {
    registry: Map<string, TEntry>;
    pendingConversationWorkingDirectoryChanges: Map<string, unknown>;
    clearContextUsageTimer: (entry: TEntry) => void;
    syncDurableConversationRun: (entry: TEntry, state: WebLiveConversationRunState, input: { force?: boolean; lastError?: string }) => Promise<void>;
    publishSessionMetaChanged: (sessionId: string) => void;
  },
): void {
  input.pendingConversationWorkingDirectoryChanges.delete(sessionId);
  const entry = input.registry.get(sessionId);
  if (!entry) return;
  input.clearContextUsageTimer(entry);
  void input.syncDurableConversationRun(entry, entry.session.isStreaming ? 'interrupted' : 'waiting', {
    force: true,
    ...(entry.session.isStreaming ? { lastError: 'Live session disposed while a response was active.' } : {}),
  });
  entry.session.dispose();
  input.registry.delete(sessionId);
  input.publishSessionMetaChanged(sessionId);
}
