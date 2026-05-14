import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import { persistAppTelemetryEvent } from '../traces/appTelemetry.js';
import { persistTraceCompaction, persistTraceToolCall } from '../traces/tracePersistence.js';
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

const toolStartTimes = new WeakMap<AgentSession, Map<string, number>>();
const toolStartInputs = new WeakMap<AgentSession, Map<string, unknown>>();

function getToolStartTimes(session: AgentSession): Map<string, number> {
  let map = toolStartTimes.get(session);
  if (!map) {
    map = new Map();
    toolStartTimes.set(session, map);
  }
  return map;
}

function getToolStartInputs(session: AgentSession): Map<string, unknown> {
  let map = toolStartInputs.get(session);
  if (!map) {
    map = new Map();
    toolStartInputs.set(session, map);
  }
  return map;
}

function readToolEventArgs(event: AgentSessionEvent): unknown {
  return 'args' in event ? event.args : undefined;
}

function stringifyToolError(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === 'string') return result;
  if (result instanceof Error) return result.stack ?? result.message;
  if (typeof result !== 'object') return String(result);

  const record = result as Record<string, unknown>;
  if (typeof record.errorMessage === 'string') return record.errorMessage;
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((item) =>
        typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).text === 'string'
          ? (item as Record<string, string>).text
          : '',
      )
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) return text;
  }

  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function readToolInputMetadata(toolName: string, toolInput: unknown): Record<string, unknown> | undefined {
  if (typeof toolInput !== 'object' || toolInput === null || Array.isArray(toolInput)) return undefined;
  const input = toolInput as Record<string, unknown>;
  const path = typeof input.path === 'string' ? input.path : typeof input.filePath === 'string' ? input.filePath : undefined;
  const command = typeof input.command === 'string' ? input.command : undefined;
  const mcpServer = typeof input.server === 'string' ? input.server : undefined;
  const mcpTool = typeof input.tool === 'string' ? input.tool : undefined;
  const url = typeof input.url === 'string' ? input.url : undefined;
  const metadata: Record<string, unknown> = { inputKeys: Object.keys(input).sort() };
  if (path) {
    const parts = path.split('/').filter(Boolean);
    const file = parts.at(-1) ?? path;
    metadata.pathExt = file.includes('.') ? file.split('.').at(-1) : '';
    metadata.pathDepth = parts.length;
  }
  if (command) metadata.commandLength = command.length;
  if (mcpServer) metadata.mcpServer = mcpServer;
  if (mcpTool) metadata.mcpTool = mcpTool;
  if (url) {
    try {
      metadata.domain = new URL(url).hostname;
    } catch {
      metadata.domain = 'invalid-url';
    }
  }
  if (toolName === 'write' || toolName === 'edit') {
    const content = typeof input.content === 'string' ? input.content : typeof input.input === 'string' ? input.input : undefined;
    if (content) metadata.contentLength = content.length;
  }
  return metadata;
}

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
  traceRunId?: string | null;
  traceRunStartedAtMs?: number | null;
  traceRunTurnCount?: number;
  traceRunStepCount?: number;
  traceRunFirstAssistantAtMs?: number | null;
  traceRunFirstToolAtMs?: number | null;
  tracePersistedTokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
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
  syncRunningState: (sessionId: string) => void;
  broadcast: (entry: TEntry, event: SseEvent) => void;
  tryImportReadyParallelJobs: (entry: TEntry) => Promise<void>;
}

function readHiddenCustomMessageType(event: AgentSessionEvent): string | null {
  if (event.type !== 'message_start') {
    return null;
  }
  const message = event.message as unknown;
  if (!message || typeof message !== 'object') {
    return null;
  }
  const record = message as Record<string, unknown>;
  return record.role === 'custom' && record.display === false && typeof record.customType === 'string' ? record.customType : null;
}

export function handleLiveSessionEvent<TEntry extends LiveSessionEventHost>(
  entry: TEntry,
  event: AgentSessionEvent,
  callbacks: LiveSessionEventCallbacks<TEntry>,
): void {
  const hiddenCustomMessageType = readHiddenCustomMessageType(event);
  if (hiddenCustomMessageType) {
    throw new Error(`Custom transcript message "${hiddenCustomMessageType}" must be visible.`);
  }

  const activeHiddenTurnCustomType = activateNextHiddenTurn(entry, event);
  if (activeHiddenTurnCustomType) {
    entry.activeHiddenTurnCustomType = activeHiddenTurnCustomType;
  }
  const suppressLiveEvent = shouldSuppressLiveEventForHiddenTurn(entry, event);

  if (event.type === 'turn_end') {
    entry.traceRunTurnCount = (entry.traceRunTurnCount ?? 0) + 1;
    persistAppTelemetryEvent({
      source: 'agent',
      category: 'conversation_loop',
      name: 'turn_end',
      sessionId: entry.sessionId,
      runId: entry.traceRunId ?? undefined,
      count: entry.traceRunTurnCount,
      metadata: { hiddenTurnCustomType: activeHiddenTurnCustomType },
    });

    if (activeHiddenTurnCustomType === 'conversation_automation_post_turn_review') {
      entry.pendingAutoModeContinuation = false;
    }

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
    getToolStartInputs(entry.session).set(event.toolCallId, readToolEventArgs(event));
    if (!entry.traceRunFirstToolAtMs) {
      const now = Date.now();
      entry.traceRunFirstToolAtMs = now;
      persistAppTelemetryEvent({
        source: 'agent',
        category: 'conversation_latency',
        name: 'first_tool',
        sessionId: entry.sessionId,
        runId: entry.traceRunId ?? undefined,
        durationMs: entry.traceRunStartedAtMs ? now - entry.traceRunStartedAtMs : undefined,
        metadata: { toolName: event.toolName },
      });
    }
  }

  if (event.type === 'tool_execution_end') {
    entry.traceRunStepCount = (entry.traceRunStepCount ?? 0) + 1;

    const startTime = getToolStartTimes(entry.session).get(event.toolCallId);
    const durationMs = startTime != null ? Date.now() - startTime : undefined;
    getToolStartTimes(entry.session).delete(event.toolCallId);
    const toolInput = getToolStartInputs(entry.session).get(event.toolCallId);
    getToolStartInputs(entry.session).delete(event.toolCallId);

    const errorMessage = event.isError ? stringifyToolError(event.result) : undefined;

    persistTraceToolCall({
      sessionId: entry.sessionId,
      runId: entry.traceRunId ?? undefined,
      toolName: event.toolName,
      toolInput,
      durationMs,
      status: event.isError ? 'error' : 'ok',
      errorMessage,
      conversationTitle: entry.title,
    });
    persistAppTelemetryEvent({
      source: 'agent',
      category: 'tool_execution',
      name: event.toolName,
      sessionId: entry.sessionId,
      runId: entry.traceRunId ?? undefined,
      durationMs,
      count: entry.traceRunStepCount ?? 0,
      status: event.isError ? 500 : 200,
      metadata: {
        isError: event.isError,
        errorMessage: errorMessage?.slice(0, 500),
        ...readToolInputMetadata(event.toolName, toolInput),
      },
    });
  }

  if (event.type === 'agent_start') {
    entry.traceRunId = `${entry.sessionId}:${Date.now().toString(36)}`;
    entry.traceRunStartedAtMs = Date.now();
    entry.traceRunTurnCount = 0;
    entry.traceRunStepCount = 0;
    entry.traceRunFirstAssistantAtMs = null;
    entry.traceRunFirstToolAtMs = null;
    entry.currentTurnError = null;
    persistAppTelemetryEvent({
      source: 'agent',
      category: 'conversation_loop',
      name: 'agent_start',
      sessionId: entry.sessionId,
      runId: entry.traceRunId,
      metadata: { title: entry.title },
    });
    void callbacks.syncDurableConversationRun(entry, 'running');
  }

  if (event.type === 'agent_end') {
    persistAppTelemetryEvent({
      source: 'agent',
      category: 'conversation_loop',
      name: 'agent_end',
      sessionId: entry.sessionId,
      runId: entry.traceRunId ?? undefined,
      durationMs: entry.traceRunStartedAtMs ? Date.now() - entry.traceRunStartedAtMs : undefined,
      count: entry.traceRunStepCount ?? 0,
      metadata: { turnCount: entry.traceRunTurnCount ?? 0, currentTurnError: entry.currentTurnError },
    });
    void callbacks.syncDurableConversationRun(entry, 'waiting');
  }

  if (event.type === 'message_end' && event.message.role === 'assistant') {
    const errorMessage = getAssistantErrorDisplayMessage(event.message);
    if (errorMessage) {
      entry.currentTurnError = errorMessage;
      persistAppTelemetryEvent({
        source: 'agent',
        category: 'conversation_outcome',
        name: 'assistant_error',
        sessionId: entry.sessionId,
        runId: entry.traceRunId ?? undefined,
        metadata: { message: errorMessage },
      });
    }
  }

  if (event.type === 'message_start' && event.message.role === 'assistant' && !entry.traceRunFirstAssistantAtMs) {
    const now = Date.now();
    entry.traceRunFirstAssistantAtMs = now;
    persistAppTelemetryEvent({
      source: 'agent',
      category: 'conversation_latency',
      name: 'first_assistant_message',
      sessionId: entry.sessionId,
      runId: entry.traceRunId ?? undefined,
      durationMs: entry.traceRunStartedAtMs ? now - entry.traceRunStartedAtMs : undefined,
    });
  }

  if (event.type === 'queue_update') {
    callbacks.broadcastQueueState(entry, true);
  }

  if (event.type === 'session_info_changed') {
    if (event.name) entry.title = event.name;
    callbacks.broadcastTitle(entry);
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
      // getSessionStats() returns cumulative session totals — compute per-run deltas
      const prev = entry.tracePersistedTokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
      const deltaTokens = {
        input: stats.tokens.input - prev.input,
        output: stats.tokens.output - prev.output,
        cacheRead: stats.tokens.cacheRead - prev.cacheRead,
        cacheWrite: stats.tokens.cacheWrite - prev.cacheWrite,
        total:
          stats.tokens.input -
          prev.input +
          (stats.tokens.output - prev.output) +
          (stats.tokens.cacheRead - prev.cacheRead) +
          (stats.tokens.cacheWrite - prev.cacheWrite),
      };
      const deltaCost = stats.cost - prev.cost;
      entry.tracePersistedTokens = {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        cost: stats.cost,
      };
      callbacks.broadcastStats(entry, deltaTokens, deltaCost, {
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
    entry.traceRunFirstAssistantAtMs = null;
    entry.traceRunFirstToolAtMs = null;
    callbacks.clearContextUsageTimer(entry);
    callbacks.broadcastContextUsage(entry, true);
  }

  if (event.type === 'turn_end') {
    callbacks.clearContextUsageTimer(entry);
    callbacks.broadcastContextUsage(entry, true);
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

  const hiddenTurnCleared = clearActiveHiddenTurnAfterTerminalEvent(entry, event);
  if (hiddenTurnCleared) {
    callbacks.publishSessionMetaChanged(entry.sessionId);
  }

  // After every event that could affect running state, sync and broadcast.
  // No-op if running hasn't actually changed.
  callbacks.syncRunningState(entry.sessionId);

  if (event.type === 'turn_end' || event.type === 'agent_end') {
    void callbacks.tryImportReadyParallelJobs(entry);
  }
}
