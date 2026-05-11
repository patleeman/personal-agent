/**
 * Trace Database
 *
 * SQLite-backed telemetry storage for the Traces monitoring page.
 * Stores turn-level stats, tool calls, context snapshots, compaction events,
 * and queue operations in a dedicated trace.db per profile.
 *
 * All writes are fire-and-forget — they never block the session loop.
 */
export declare function closeTraceDbs(): void;
export type BashCommandShape = 'single' | 'pipeline' | 'chain' | 'redirect' | 'multiline' | 'shell' | 'unknown';
export declare function writeTraceStats(params: {
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
}): void;
export declare function writeTraceToolCall(params: {
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
}): void;
export declare function writeTraceContext(params: {
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
}): void;
export declare function writeTraceCompaction(params: {
  sessionId: string;
  reason: 'overflow' | 'threshold' | 'manual';
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  profile?: string;
}): void;
export declare function writeTraceAutoMode(params: {
  sessionId: string;
  enabled: boolean;
  stopReason?: string | null;
  profile?: string;
}): void;
export declare function writeTraceSuggestedContext(params: { sessionId: string; pointerIds: string[]; profile?: string }): void;
export declare function writeTraceContextPointerInspect(params: {
  sessionId: string;
  inspectedConversationId: string;
  wasSuggested: boolean;
  profile?: string;
}): void;
export interface TraceSummary {
  activeSessions: number;
  runsToday: number;
  totalCost: number;
  tokensTotal: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  tokensCachedWrite: number;
  cacheHitRate: number;
  toolErrors: number;
  toolCalls: number;
}
export declare function querySummary(since: string): TraceSummary;
export interface ModelUsageRow {
  modelId: string;
  tokens: number;
  cost: number;
  calls: number;
}
export declare function queryModelUsage(since: string): ModelUsageRow[];
export interface CostByConversationRow {
  conversationTitle: string;
  modelId: string;
  tokens: number;
  cost: number;
}
export declare function queryCostByConversation(since: string): CostByConversationRow[];
export interface ToolHealthRow {
  toolName: string;
  calls: number;
  errors: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  bashBreakdown?: BashBreakdownRow[];
  bashComplexity?: BashComplexitySummary;
}
export interface BashBreakdownRow {
  command: string;
  calls: number;
  errors: number;
  errorRate: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
}
export interface BashComplexitySummary {
  avgScore: number;
  maxScore: number;
  avgCommandCount: number;
  maxCommandCount: number;
  avgCharCount: number;
  maxCharCount: number;
  pipelineCalls: number;
  chainCalls: number;
  redirectCalls: number;
  multilineCalls: number;
  shellCalls: number;
  substitutionCalls: number;
  shapeBreakdown: Array<{
    shape: BashCommandShape;
    calls: number;
  }>;
}
export declare function queryToolHealth(since: string): ToolHealthRow[];
export declare function queryBashComplexity(since: string): BashComplexitySummary;
export declare function queryBashBreakdown(since: string): BashBreakdownRow[];
export interface ContextSessionRow {
  sessionId: string;
  totalTokens: number;
  contextWindow: number;
  pct: number;
  segSystem: number;
  segUser: number;
  segAssistant: number;
  segTool: number;
  segSummary: number;
  systemPromptTokens: number;
}
export declare function queryContextSessions(since: string): ContextSessionRow[];
export interface CompactionRow {
  sessionId: string;
  ts: string;
  reason: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
}
export declare function queryCompactions(since: string): CompactionRow[];
export declare function queryCompactionAggregates(since: string): {
  autoCount: number;
  manualCount: number;
  totalTokensSaved: number;
  overflowPct: number;
};
export interface AgentLoopRow {
  turnsPerRun: number;
  stepsPerTurn: number;
  runsOver20Turns: number;
  subagentsPerRun: number;
  avgDurationMs: number;
  durationP50Ms: number;
  durationP95Ms: number;
  durationP99Ms: number;
  stuckRuns: number;
}
export declare function queryAgentLoop(since: string): AgentLoopRow | null;
export interface TokenDailyRow {
  date: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  tokensCachedWrite: number;
  toolErrors: number;
  cost: number;
}
export interface AutoModeEvent {
  sessionId: string;
  ts: string;
  enabled: boolean;
  stopReason: string | null;
}
export interface AutoModeSummary {
  enabledCount: number;
  disabledCount: number;
  currentActive: number;
  topStopReasons: Array<{
    reason: string;
    count: number;
  }>;
  recentEvents: AutoModeEvent[];
}
export declare function queryAutoMode(since: string): AutoModeSummary;
export declare function queryTokensDaily(since: string): TokenDailyRow[];
export interface ThroughputRow {
  modelId: string;
  avgTokensPerSec: number;
  peakTokensPerSec: number;
  tokensOutput: number;
  durationMs: number;
}
export declare function queryThroughput(since: string): ThroughputRow[];
export interface ToolTransition {
  fromTool: string;
  toTool: string;
  count: number;
}
export interface ToolCoOccurrence {
  toolA: string;
  toolB: string;
  sessions: number;
}
export interface FailureTrajectory {
  toolName: string;
  errorMessage: string;
  previousCalls: string[];
  ts: string;
  sessionId: string;
}
export interface ToolFlowResult {
  transitions: ToolTransition[];
  coOccurrences: ToolCoOccurrence[];
  failureTrajectories: FailureTrajectory[];
}
/**
 * Analyze tool call sequences to find:
 * 1. Most common tool→tool transitions
 * 2. Tool co-occurrence within sessions
 * 3. Last N tool calls before each error
 */
export declare function queryToolFlow(since: string): ToolFlowResult;
export interface CacheEfficiencyPoint {
  ts: string;
  modelId: string;
  totalInput: number;
  cachedInput: number;
  hitRate: number;
}
export interface SystemPromptPoint {
  ts: string;
  sessionId: string;
  modelId: string;
  systemPromptTokens: number;
  totalTokens: number;
  contextWindow: number;
  pctOfTotal: number;
  pctOfContextWindow: number;
}
export interface SystemPromptModelAggregate {
  modelId: string;
  avgSystemPromptTokens: number;
  maxSystemPromptTokens: number;
  contextWindow: number;
  avgPctOfContextWindow: number;
  samples: number;
}
export declare function queryCacheEfficiency(since: string): CacheEfficiencyPoint[];
export declare function querySystemPromptTrend(since: string): SystemPromptPoint[];
export declare function queryCacheEfficiencyAggregate(since: string): {
  overallHitRate: number;
  requestCacheHitRate: number;
  totalInput: number;
  totalCached: number;
  totalCachedWrite: number;
  requests: number;
  cachedRequests: number;
  byModel: Array<{
    modelId: string;
    hitRate: number;
    requestCacheHitRate: number;
    totalInput: number;
    totalCached: number;
    totalCachedWrite: number;
    requests: number;
    cachedRequests: number;
  }>;
};
export declare function querySystemPromptAggregate(since: string): {
  avgSystemPromptTokens: number;
  avgPctOfTotal: number;
  avgPctOfContextWindow: number;
  maxSystemPromptTokens: number;
  samples: number;
  byModel: SystemPromptModelAggregate[];
};
/**
 * Return the set of conversation IDs that were suggested to a session.
 * Used to determine `was_suggested` on inspect calls without relying on
 * in-memory state that resets on server restart.
 */
export declare function querySessionSuggestedPointerIds(sessionId: string): Set<string>;
export interface ContextPointerUsageSummary {
  /** Total conversation_inspect calls on suggested pointers */
  totalInspects: number;
  /** Unique sessions that inspected at least one suggested pointer */
  sessionsWithInspect: number;
  /** Total times pointers were surfaced (one event per prompt turn) */
  totalSuggested: number;
  /** Unique sessions that received pointers */
  sessionsWithSuggested: number;
  /** Usage rate: sessions that inspected / sessions that received pointers */
  usageRate: number;
  /** Total inspect calls (any conversation, not just suggested) */
  totalAnyInspects: number;
  /** Avg pointers suggested per turn */
  avgPointersPerTurn: number;
}
export interface ContextPointerDailyRow {
  date: string;
  suggested: number;
  inspected: number;
}
export declare function queryContextPointerUsage(since: string): {
  summary: ContextPointerUsageSummary;
  daily: ContextPointerDailyRow[];
};
