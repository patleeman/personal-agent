import type { AgentSession, AgentSessionEvent } from '@mariozechner/pi-coding-agent';

import { logWarn } from '../shared/logging.js';
import { persistTraceCompaction, persistTraceToolCall } from '../traces/tracePersistence.js';
import { CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE } from './conversationAutoMode.js';
import type { WebLiveConversationRunState } from './conversationRuns.js';
import { type SseEvent, toSse } from './liveSessionEvents.js';
import {
  activateNextHiddenTurn,
  clearActiveHiddenTurnAfterTerminalEvent,
  shouldSuppressLiveEventForHiddenTurn,
} from './liveSessionHiddenTurns.js';
import { readConversationAutoModeState } from './liveSessionStateBroadcasts.js';
import { buildFallbackTitleFromContent, isPlaceholderConversationTitle } from './liveSessionTitle.js';
import { resolveCompactionSummaryTitle } from './liveSessionTranscript.js';
import { getAssistantErrorDisplayMessage } from './sessions.js';

const AUTO_MODE_CONTROLLER_RETRY_MAX = 2;

const toolStartTimes = new WeakMap<AgentSession, Map<string, number>>();

function getToolStartTimes(session: AgentSession): Map<string, number> {
  let map = toolStartTimes.get(session);
  if (!map) {
    map = new Map();
    toolStartTimes.set(session, map);
  }
  return map;
}

export interface LiveSessionEventHost {
  sessionId: string;
  session: AgentSession;
  title: string;
  currentTurnError?: string | null;
  activeHiddenTurnCustomType?: string | null;
  pendingAutoModeContinuation?: boolean;
  autoModeControllerRetryCount?: number;
  pendingAutoCompactionReason?: 'overflow' | 'threshold' | null;
  lastCompactionSummaryTitle?: string | null;
  isCompacting?: boolean;
  traceRunId?: string | null;
  traceRunStartedAtMs?: number | null;
  traceRunTurnCount?: number;
  traceRunStepCount?: number;
}

export interface LiveSessionEventCallbacks<TEntry extends LiveSessionEventHost> {
  requestConversationAutoModeContinuationTurn: (sessionId: string) => Promise<boolean>;
  requestConversationAutoModeTurn: (sessionId: string) => Promise<boolean>;
  syncDurableConversationRun: (entry: TEntry, state: WebLiveConversationRunState) => Promise<void>;
  notifyLifecycleHandlers: (entry: TEntry, trigger: 'turn_end' | 'auto_compaction_end') => void;
  applyPendingConversationWorkingDirectoryChange: (entry: TEntry) => Promise<void>;
  scheduleContextUsage: (entry: TEntry) => void;
  publishSessionMetaChanged: (sessionId: string) => void;
  broadcastQueueState: (entry: TEntry, force?: boolean) => void;
  broadcastTitle: (entry: TEntry) => void;
  broadcastStats: (
    entry: TEntry,
    tokens: { input: number; output: number; total: number; cacheRead?: number; cacheWrite?: number },
    cost: number,
    traceRun: { runId?: string; turnCount: number; stepCount: number; durationMs: number },
  ) => void;
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
    entry.traceRunTurnCount = (entry.traceRunTurnCount ?? 0) + 1;

    if (activeHiddenTurnCustomType === CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE) {
      const shouldContinueAutoMode = entry.pendingAutoModeContinuation === true;
      entry.pendingAutoModeContinuation = false;
      if (shouldContinueAutoMode) {
        entry.autoModeControllerRetryCount = 0;
        queueMicrotask(() => {
          void Promise.resolve(callbacks.requestConversationAutoModeContinuationTurn(entry.sessionId)).catch((error) => {
            logWarn('conversation auto mode continuation request failed', {
              sessionId: entry.sessionId,
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
          });
        });
      } else {
        // Agent did not call conversation_auto_control, or called "stop".
        // If auto mode is still enabled (tool was ignored, not "stop"), retry.
        const state = readConversationAutoModeState(entry);
        if (state.enabled) {
          const retryCount = (entry.autoModeControllerRetryCount ?? 0) + 1;
          entry.autoModeControllerRetryCount = retryCount;
          if (retryCount <= AUTO_MODE_CONTROLLER_RETRY_MAX) {
            logWarn('auto mode controller tool was not invoked, retrying', {
              sessionId: entry.sessionId,
              retryCount,
              maxRetries: AUTO_MODE_CONTROLLER_RETRY_MAX,
            });
            queueMicrotask(() => {
              void Promise.resolve(callbacks.requestConversationAutoModeTurn(entry.sessionId)).catch((error) => {
                logWarn('conversation auto mode controller retry failed', {
                  sessionId: entry.sessionId,
                  retryCount,
                  message: error instanceof Error ? error.message : String(error),
                });
              });
            });
          } else {
            logWarn('auto mode controller tool not invoked after max retries, stopping auto mode', {
              sessionId: entry.sessionId,
              retryCount: retryCount - 1,
            });
          }
        }
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

  if (event.type === 'tool_execution_start') {
    getToolStartTimes(entry.session).set(event.toolCallId, Date.now());
  }

  if (event.type === 'tool_execution_end') {
    entry.traceRunStepCount = (entry.traceRunStepCount ?? 0) + 1;

    const startTime = getToolStartTimes(entry.session).get(event.toolCallId);
    const durationMs = startTime != null ? Date.now() - startTime : undefined;
    getToolStartTimes(entry.session).delete(event.toolCallId);

    persistTraceToolCall({
      sessionId: entry.sessionId,
      toolName: event.toolName,
      durationMs,
      status: event.isError ? 'error' : 'ok',
      errorMessage: event.isError ? String(event.result) : undefined,
      conversationTitle: entry.title,
    });
  }

  if (event.type === 'agent_start') {
    entry.traceRunId = `${entry.sessionId}:${Date.now().toString(36)}`;
    entry.traceRunStartedAtMs = Date.now();
    entry.traceRunTurnCount = 0;
    entry.traceRunStepCount = 0;
    entry.currentTurnError = null;
    callbacks.publishSessionMetaChanged(entry.sessionId);
    void callbacks.syncDurableConversationRun(entry, 'running');
  }

  if (event.type === 'agent_end') {
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
      callbacks.broadcastStats(entry, stats.tokens, stats.cost, {
        runId: entry.traceRunId ?? undefined,
        turnCount: entry.traceRunTurnCount ?? 0,
        stepCount: entry.traceRunStepCount ?? 0,
        durationMs: entry.traceRunStartedAtMs ? Date.now() - entry.traceRunStartedAtMs : 0,
      });
    } catch {
      /* ignore */
    }
    entry.traceRunId = null;
    entry.traceRunStartedAtMs = null;
    entry.traceRunTurnCount = 0;
    entry.traceRunStepCount = 0;
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

    if (!event.aborted && event.result) {
      persistTraceCompaction({
        sessionId: entry.sessionId,
        reason: event.reason,
        tokensBefore: event.result.tokensBefore ?? 0,
        tokensSaved: event.result.tokensBefore ?? 0,
      });

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
