import type { AgentSession, AgentSessionEvent } from '@mariozechner/pi-coding-agent';

import { logWarn } from '../shared/logging.js';
import { CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE } from './conversationAutoMode.js';
import type { WebLiveConversationRunState } from './conversationRuns.js';
import { type SseEvent, toSse } from './liveSessionEvents.js';
import {
  activateNextHiddenTurn,
  clearActiveHiddenTurnAfterTerminalEvent,
  shouldSuppressLiveEventForHiddenTurn,
} from './liveSessionHiddenTurns.js';
import { buildFallbackTitleFromContent, isPlaceholderConversationTitle } from './liveSessionTitle.js';
import { resolveCompactionSummaryTitle } from './liveSessionTranscript.js';
import { getAssistantErrorDisplayMessage } from './sessions.js';

export interface LiveSessionEventHost {
  sessionId: string;
  session: AgentSession;
  title: string;
  currentTurnError?: string | null;
  activeHiddenTurnCustomType?: string | null;
  pendingAutoModeContinuation?: boolean;
  pendingAutoCompactionReason?: 'overflow' | 'threshold' | null;
  lastCompactionSummaryTitle?: string | null;
  isCompacting?: boolean;
}

export interface LiveSessionEventCallbacks<TEntry extends LiveSessionEventHost> {
  maybeAutoTitleConversation: (entry: TEntry) => void;
  requestConversationAutoModeContinuationTurn: (sessionId: string) => Promise<boolean>;
  syncDurableConversationRun: (entry: TEntry, state: WebLiveConversationRunState) => Promise<void>;
  notifyLifecycleHandlers: (entry: TEntry, trigger: 'turn_end' | 'auto_compaction_end') => void;
  applyPendingConversationWorkingDirectoryChange: (entry: TEntry) => Promise<void>;
  scheduleContextUsage: (entry: TEntry) => void;
  publishSessionMetaChanged: (sessionId: string) => void;
  broadcastQueueState: (entry: TEntry, force?: boolean) => void;
  broadcastTitle: (entry: TEntry) => void;
  broadcastStats: (entry: TEntry, tokens: { input: number; output: number; total: number }, cost: number) => void;
  clearContextUsageTimer: (entry: TEntry) => void;
  broadcastContextUsage: (entry: TEntry, force?: boolean) => void;
  broadcastSnapshot: (entry: TEntry) => void;
  broadcast: (entry: TEntry, event: SseEvent) => void;
  tryImportReadyParallelJobs: (entry: TEntry) => Promise<void>;
}

export function handleLiveSessionEvent<TEntry extends LiveSessionEventHost>(
  entry: TEntry,
  event: AgentSessionEvent,
  callbacks: LiveSessionEventCallbacks<TEntry>,
): void {
  const activeHiddenTurnCustomType = activateNextHiddenTurn(entry, event);
  const suppressLiveEvent = shouldSuppressLiveEventForHiddenTurn(entry, event);

  if (event.type === 'turn_end') {
    if (!activeHiddenTurnCustomType) {
      callbacks.maybeAutoTitleConversation(entry);
    }
    if (activeHiddenTurnCustomType === CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE) {
      const shouldContinueAutoMode = entry.pendingAutoModeContinuation === true;
      entry.pendingAutoModeContinuation = false;
      if (shouldContinueAutoMode) {
        queueMicrotask(() => {
          void Promise.resolve(callbacks.requestConversationAutoModeContinuationTurn(entry.sessionId)).catch((error) => {
            logWarn('conversation auto mode continuation request failed', {
              sessionId: entry.sessionId,
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
          });
        });
      }
    }
    void callbacks.syncDurableConversationRun(entry, 'waiting');
    callbacks.notifyLifecycleHandlers(entry, 'turn_end');
    void callbacks.applyPendingConversationWorkingDirectoryChange(entry);
  }

  if (
    event.type === 'agent_start' ||
    event.type === 'message_update' ||
    event.type === 'tool_execution_start' ||
    event.type === 'tool_execution_update' ||
    event.type === 'tool_execution_end'
  ) {
    callbacks.scheduleContextUsage(entry);
  }

  if (event.type === 'agent_start') {
    entry.currentTurnError = null;
    callbacks.publishSessionMetaChanged(entry.sessionId);
    void callbacks.syncDurableConversationRun(entry, 'running');
  }

  if (event.type === 'agent_end') {
    if (!entry.activeHiddenTurnCustomType) {
      callbacks.maybeAutoTitleConversation(entry);
    }
    void callbacks.syncDurableConversationRun(entry, 'waiting');
  }

  if (event.type === 'message_end' && event.message.role === 'assistant') {
    const errorMessage = getAssistantErrorDisplayMessage(event.message);
    if (errorMessage) {
      entry.currentTurnError = errorMessage;
    }
  }

  if (event.type === 'queue_update') {
    callbacks.broadcastQueueState(entry, true);
  }

  if (event.type === 'message_start' && event.message.role === 'user') {
    if (!entry.session.sessionName?.trim() && isPlaceholderConversationTitle(entry.title)) {
      const fallbackTitle = buildFallbackTitleFromContent(event.message.content);
      if (fallbackTitle) {
        entry.title = fallbackTitle;
        callbacks.broadcastTitle(entry);
      }
    }
    callbacks.broadcastQueueState(entry);
  }

  if (event.type === 'agent_end') {
    try {
      const stats = entry.session.getSessionStats();
      callbacks.broadcastStats(entry, stats.tokens, stats.cost);
    } catch {
      /* ignore */
    }
    callbacks.clearContextUsageTimer(entry);
    callbacks.broadcastContextUsage(entry, true);
  }

  if (event.type === 'turn_end') {
    callbacks.clearContextUsageTimer(entry);
    callbacks.broadcastContextUsage(entry, true);
    callbacks.publishSessionMetaChanged(entry.sessionId);
  }

  if (event.type === 'compaction_start') {
    entry.isCompacting = true;
    entry.pendingAutoCompactionReason = event.reason === 'manual' ? null : event.reason;
  }

  if (event.type === 'compaction_end') {
    entry.isCompacting = false;
    const compactionReason = event.reason === 'manual' ? null : event.reason;
    entry.pendingAutoCompactionReason = null;

    if (compactionReason && !event.aborted && event.result) {
      entry.lastCompactionSummaryTitle = resolveCompactionSummaryTitle({
        mode: 'auto',
        reason: compactionReason,
        willRetry: event.willRetry,
      });
      callbacks.broadcastSnapshot(entry);
      callbacks.clearContextUsageTimer(entry);
      callbacks.broadcastContextUsage(entry, true);
      callbacks.publishSessionMetaChanged(entry.sessionId);
      callbacks.notifyLifecycleHandlers(entry, 'auto_compaction_end');
    }
  }

  const sse = toSse(event);
  if (sse && !suppressLiveEvent) {
    callbacks.broadcast(entry, sse);
  }

  clearActiveHiddenTurnAfterTerminalEvent(entry, event);

  if (event.type === 'turn_end' || event.type === 'agent_end') {
    void callbacks.tryImportReadyParallelJobs(entry);
  }
}
