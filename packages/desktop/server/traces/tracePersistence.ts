/**
 * Trace Persistence Hooks
 *
 * Wires trace-db writes into live session events.
 * Each hook is synchronous and fire-and-forget — never blocks the session loop.
 */

import {
  writeTraceAutoMode,
  writeTraceCompaction,
  writeTraceContext,
  writeTraceQueue,
  writeTraceStats,
  writeTraceToolCall,
} from '@personal-agent/core';

// ── Stats hook ────────────────────────────────────────────────────────────────

export function persistTraceStats(params: {
  sessionId: string;
  runId?: string;
  modelId?: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCachedInput?: number;
  cost: number;
  turnCount?: number;
  stepCount?: number;
  durationMs?: number;
}): void {
  writeTraceStats({
    sessionId: params.sessionId,
    runId: params.runId,
    modelId: params.modelId,
    tokensInput: params.tokensInput,
    tokensOutput: params.tokensOutput,
    tokensCachedInput: params.tokensCachedInput,
    cost: params.cost,
    turnCount: params.turnCount,
    stepCount: params.stepCount,
    durationMs: params.durationMs,
  });
}

// ── Context usage hook ────────────────────────────────────────────────────────

export function persistTraceContext(params: {
  sessionId: string;
  modelId?: string;
  totalTokens: number;
  contextWindow: number;
  pct: number;
  segSystem?: number;
  segUser?: number;
  segAssistant?: number;
  segTool?: number;
  segSummary?: number;
  systemPromptTokens?: number;
}): void {
  writeTraceContext(params);
}

// ── Tool call hook ────────────────────────────────────────────────────────────

export function persistTraceToolCall(params: {
  sessionId: string;
  runId?: string;
  toolName: string;
  durationMs?: number;
  status: 'ok' | 'error';
  errorMessage?: string;
  conversationTitle?: string;
}): void {
  writeTraceToolCall(params);
}

// ── Compaction hook ───────────────────────────────────────────────────────────

export function persistTraceCompaction(params: {
  sessionId: string;
  reason: 'overflow' | 'threshold' | 'manual';
  tokensBefore?: number;
  tokensAfter?: number;
  tokensSaved?: number;
}): void {
  writeTraceCompaction({
    sessionId: params.sessionId,
    reason: params.reason,
    tokensBefore: params.tokensBefore ?? 0,
    tokensAfter: params.tokensAfter ?? 0,
    tokensSaved: params.tokensSaved ?? 0,
  });
}

// ── Queue hook ────────────────────────────────────────────────────────────────

export function persistTraceQueue(params: {
  sessionId: string;
  action: 'enqueue' | 'dequeue' | 'timeout' | 'complete';
  itemType?: string;
  waitSeconds?: number;
}): void {
  writeTraceQueue(params);
}

export function persistTraceAutoMode(params: { sessionId: string; enabled: boolean; stopReason?: string | null }): void {
  writeTraceAutoMode(params);
}
