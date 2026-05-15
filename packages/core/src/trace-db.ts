import { randomUUID } from 'node:crypto';

import { resolveObservabilityDbPath } from './observability-db.js';
import { closeTraceTelemetryLogs, writeTraceTelemetryLogEvent } from './trace-telemetry-log.js';

export interface TraceDbMaintenanceResult {
  dbPath: string;
  maxRowsPerTable: number;
  deletedRows: Record<string, number>;
  vacuumed: boolean;
}

export function closeTraceDbs(): void {
  closeTraceTelemetryLogs();
}

export function maintainTraceDb(stateRoot?: string): TraceDbMaintenanceResult {
  return { dbPath: resolveObservabilityDbPath(stateRoot), maxRowsPerTable: 0, deletedRows: {}, vacuumed: false };
}

function id(): string {
  return randomUUID();
}

function ts(): string {
  return new Date().toISOString();
}

function tokenCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringifyToolInput(value: unknown): string | null {
  if (value == null) return null;
  try {
    const json = JSON.stringify(value);
    return json.length > 4000 ? `${json.slice(0, 4000)}…` : json;
  } catch {
    return null;
  }
}

function readBashCommand(toolName: string, toolInput: unknown, explicit?: string): string | null {
  if (explicit) return explicit;
  if (toolName !== 'bash' || !toolInput || typeof toolInput !== 'object') return null;
  const command = (toolInput as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : null;
}

function bashCommandLabel(command: string | null): string | null {
  if (!command) return null;
  const first = command.trim().split(/\s+/)[0];
  return first || null;
}

export function writeTraceStats(params: {
  sessionId: string;
  runId?: string;
  modelId?: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCachedInput?: number;
  tokensCachedWrite?: number;
  cost: number;
  turnCount?: number;
  stepCount?: number;
  durationMs?: number;
  profile?: string;
}): void {
  const eventTs = ts();
  writeTraceTelemetryLogEvent({
    schemaVersion: 1,
    id: id(),
    ts: eventTs,
    type: 'stats',
    sessionId: params.sessionId,
    runId: params.runId ?? null,
    profile: params.profile ?? '',
    payload: {
      modelId: params.modelId ?? null,
      tokensInput: tokenCount(params.tokensInput),
      tokensOutput: tokenCount(params.tokensOutput),
      tokensCachedInput: tokenCount(params.tokensCachedInput),
      tokensCachedWrite: tokenCount(params.tokensCachedWrite),
      cost: finiteNumber(params.cost),
      turnCount: tokenCount(params.turnCount),
      stepCount: tokenCount(params.stepCount),
      durationMs: tokenCount(params.durationMs),
    },
  });
}

export function writeTraceToolCall(params: {
  sessionId: string;
  runId?: string;
  toolName: string;
  toolInput?: unknown;
  bashCommand?: string;
  durationMs?: number;
  status: 'ok' | 'error';
  errorMessage?: string;
  conversationTitle?: string;
  profile?: string;
}): void {
  const command = readBashCommand(params.toolName, params.toolInput, params.bashCommand);
  writeTraceTelemetryLogEvent({
    schemaVersion: 1,
    id: id(),
    ts: ts(),
    type: 'tool_call',
    sessionId: params.sessionId,
    runId: params.runId ?? null,
    profile: params.profile ?? '',
    payload: {
      toolName: params.toolName,
      toolInputJson: stringifyToolInput(params.toolInput),
      bashCommand: command,
      bashCommandLabel: bashCommandLabel(command),
      durationMs: typeof params.durationMs === 'number' && Number.isFinite(params.durationMs) ? params.durationMs : null,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
      conversationTitle: params.conversationTitle ?? null,
    },
  });
}

export function writeTraceContext(params: {
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
  profile?: string;
}): void {
  writeTraceTelemetryLogEvent({
    schemaVersion: 1,
    id: id(),
    ts: ts(),
    type: 'context',
    sessionId: params.sessionId,
    runId: null,
    profile: params.profile ?? '',
    payload: {
      modelId: params.modelId ?? null,
      totalTokens: tokenCount(params.totalTokens),
      contextWindow: tokenCount(params.contextWindow),
      pct: finiteNumber(params.pct),
      segSystem: tokenCount(params.segSystem),
      segUser: tokenCount(params.segUser),
      segAssistant: tokenCount(params.segAssistant),
      segTool: tokenCount(params.segTool),
      segSummary: tokenCount(params.segSummary),
      systemPromptTokens: tokenCount(params.systemPromptTokens),
    },
  });
}

export function writeTraceCompaction(params: {
  sessionId: string;
  reason: 'overflow' | 'threshold' | 'manual';
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  profile?: string;
}): void {
  writeTraceTelemetryLogEvent({
    schemaVersion: 1,
    id: id(),
    ts: ts(),
    type: 'compaction',
    sessionId: params.sessionId,
    runId: null,
    profile: params.profile ?? '',
    payload: {
      reason: params.reason,
      tokensBefore: tokenCount(params.tokensBefore),
      tokensAfter: tokenCount(params.tokensAfter),
      tokensSaved: tokenCount(params.tokensSaved),
    },
  });
}

export function writeTraceAutoMode(params: { sessionId: string; enabled: boolean; stopReason?: string | null; profile?: string }): void {
  writeTraceTelemetryLogEvent({
    schemaVersion: 1,
    id: id(),
    ts: ts(),
    type: 'auto_mode',
    sessionId: params.sessionId,
    runId: null,
    profile: params.profile ?? '',
    payload: { enabled: params.enabled ? 1 : 0, stopReason: params.stopReason ?? null },
  });
}

export function writeTraceSuggestedContext(params: { sessionId: string; pointerIds: string[]; profile?: string }): void {
  writeTraceTelemetryLogEvent({
    schemaVersion: 1,
    id: id(),
    ts: ts(),
    type: 'suggested_context',
    sessionId: params.sessionId,
    runId: null,
    profile: params.profile ?? '',
    payload: { pointerIds: params.pointerIds.join(','), pointerCount: params.pointerIds.length },
  });
}

export function writeTraceContextPointerInspect(params: {
  sessionId: string;
  inspectedConversationId: string;
  wasSuggested: boolean;
  profile?: string;
}): void {
  writeTraceTelemetryLogEvent({
    schemaVersion: 1,
    id: id(),
    ts: ts(),
    type: 'context_pointer_inspect',
    sessionId: params.sessionId,
    runId: null,
    profile: params.profile ?? '',
    payload: { inspectedConversationId: params.inspectedConversationId, wasSuggested: params.wasSuggested ? 1 : 0 },
  });
}
