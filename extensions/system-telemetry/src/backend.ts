/**
 * Traces Routes
 *
 * Aggregation endpoints for the Telemetry page. Trace JSONL is canonical; these
 * handlers calculate dashboard view models from recent trace events on demand.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ExtensionRouteRequest {
  query: Record<string, string | string[]>;
}
interface ExtensionRouteResponse {
  status?: number;
  body?: unknown;
}

type TraceTelemetryLogEventType =
  | 'stats'
  | 'tool_call'
  | 'context'
  | 'compaction'
  | 'auto_mode'
  | 'suggested_context'
  | 'context_pointer_inspect';

interface TraceTelemetryLogEvent {
  schemaVersion: 1;
  id: string;
  ts: string;
  type: TraceTelemetryLogEventType;
  sessionId: string;
  runId: string | null;
  profile: string;
  payload: Record<string, unknown>;
}

interface AppTelemetryEventRow {
  id: string;
  ts: string;
  source: string;
  category: string;
  name: string;
  sessionId: string | null;
  runId: string | null;
  route: string | null;
  status: number | null;
  durationMs: number | null;
  count: number | null;
  value: number | null;
  metadataJson: string | null;
}

function parseRangeParam(range: unknown): string {
  const valid = ['1h', '6h', '24h', '7d', '30d'];
  const value = typeof range === 'string' ? range.trim() : '24h';
  const selected = valid.includes(value) ? value : '24h';
  const now = Date.now();
  const ms: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - ms[selected]).toISOString();
}

function telemetryLogDir(stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT): string {
  return join(stateRoot ?? join(process.env.HOME ?? '.', '.local', 'state', 'personal-agent'), 'logs', 'telemetry');
}

function parseTraceTelemetryLogEvent(line: string): TraceTelemetryLogEvent | null {
  try {
    const parsed = JSON.parse(line) as Partial<TraceTelemetryLogEvent>;
    if (parsed.schemaVersion !== 1 || !parsed.id || !parsed.ts || !parsed.type || !parsed.sessionId) return null;
    return {
      schemaVersion: 1,
      id: String(parsed.id),
      ts: String(parsed.ts),
      type: parsed.type as TraceTelemetryLogEventType,
      sessionId: String(parsed.sessionId),
      runId: parsed.runId == null ? null : String(parsed.runId),
      profile: parsed.profile == null ? '' : String(parsed.profile),
      payload: parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload) ? parsed.payload : {},
    };
  } catch {
    return null;
  }
}

function readTraceTelemetryLogEvents(input: { since: string; limit?: number }): TraceTelemetryLogEvent[] {
  const dir = telemetryLogDir();
  if (!existsSync(dir)) return [];
  const limit = input.limit ?? 50_000;
  const events: TraceTelemetryLogEvent[] = [];
  try {
    const files = readdirSync(dir)
      .filter((fileName) => fileName.startsWith('trace-telemetry-') && fileName.endsWith('.jsonl'))
      .sort((left, right) => right.localeCompare(left));
    for (const fileName of files) {
      const lines = readFileSync(join(dir, fileName), 'utf-8').split('\n').filter(Boolean).reverse();
      for (const line of lines) {
        const event = parseTraceTelemetryLogEvent(line);
        if (!event || event.ts < input.since) continue;
        events.push(event);
        if (events.length >= limit) return events.sort((a, b) => a.ts.localeCompare(b.ts));
      }
    }
  } catch {
    return events.sort((a, b) => a.ts.localeCompare(b.ts));
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}

function parseAppTelemetryLogEvent(line: string): AppTelemetryEventRow | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.schemaVersion !== 1 || !parsed.id || !parsed.ts || !parsed.source || !parsed.category || !parsed.name) return null;
    return {
      id: String(parsed.id),
      ts: String(parsed.ts),
      source: String(parsed.source),
      category: String(parsed.category),
      name: String(parsed.name),
      sessionId: parsed.sessionId == null ? null : String(parsed.sessionId),
      runId: parsed.runId == null ? null : String(parsed.runId),
      route: parsed.route == null ? null : String(parsed.route),
      status: typeof parsed.status === 'number' && Number.isFinite(parsed.status) ? parsed.status : null,
      durationMs: typeof parsed.durationMs === 'number' && Number.isFinite(parsed.durationMs) ? parsed.durationMs : null,
      count: typeof parsed.count === 'number' && Number.isFinite(parsed.count) ? parsed.count : null,
      value: typeof parsed.value === 'number' && Number.isFinite(parsed.value) ? parsed.value : null,
      metadataJson: parsed.metadata && typeof parsed.metadata === 'object' ? JSON.stringify(parsed.metadata) : null,
    };
  } catch {
    return null;
  }
}

function queryAppTelemetryEvents(input: { since: string; limit?: number }): AppTelemetryEventRow[] {
  const dir = telemetryLogDir();
  if (!existsSync(dir)) return [];
  const events: AppTelemetryEventRow[] = [];
  const limit = Math.max(1, Math.min(input.limit ?? 200, 1000));
  try {
    const files = readdirSync(dir)
      .filter((fileName) => fileName.startsWith('app-telemetry-') && fileName.endsWith('.jsonl'))
      .sort((left, right) => right.localeCompare(left));
    for (const fileName of files) {
      const lines = readFileSync(join(dir, fileName), 'utf-8').split('\n').filter(Boolean).reverse();
      for (const line of lines) {
        const event = parseAppTelemetryLogEvent(line);
        if (!event || event.ts < input.since) continue;
        events.push(event);
        if (events.length >= limit) return events.sort((a, b) => b.ts.localeCompare(a.ts));
      }
    }
  } catch {
    return events.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
  }
  return events.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
}

function eventsSince(since: string): TraceTelemetryLogEvent[] {
  const events = readTraceTelemetryLogEvents({ since, limit: 100_000 });
  if (events.length > 0) return events;
  return readTraceTelemetryLogEvents({ since: '1970-01-01T00:00:00.000Z', limit: 100_000 });
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function percentile(values: number[], pct: number): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))] ?? 0;
}

function dayKey(ts: string): string {
  return ts.slice(0, 10);
}

function hourKey(ts: string): string {
  return `${ts.slice(0, 13)}:00:00.000Z`;
}

function statsEvents(events: TraceTelemetryLogEvent[]) {
  return events.filter((event) => event.type === 'stats');
}

function toolEvents(events: TraceTelemetryLogEvent[]) {
  return events.filter((event) => event.type === 'tool_call');
}

function contextEvents(events: TraceTelemetryLogEvent[]) {
  return events.filter((event) => event.type === 'context');
}

function emptySummary() {
  return {
    activeSessions: 0,
    runsToday: 0,
    totalCost: 0,
    tokensTotal: 0,
    tokensInput: 0,
    tokensOutput: 0,
    tokensCached: 0,
    tokensCachedWrite: 0,
    cacheHitRate: 0,
    toolErrors: 0,
    toolCalls: 0,
  };
}

function querySummaryFromEvents(events: TraceTelemetryLogEvent[]) {
  const summary = emptySummary();
  const sessions = new Set<string>();
  const runs = new Set<string>();
  for (const event of statsEvents(events)) {
    sessions.add(event.sessionId);
    if (event.runId) runs.add(event.runId);
    summary.tokensInput += numberValue(event.payload.tokensInput);
    summary.tokensOutput += numberValue(event.payload.tokensOutput);
    summary.tokensCached += numberValue(event.payload.tokensCachedInput);
    summary.tokensCachedWrite += numberValue(event.payload.tokensCachedWrite);
    summary.totalCost += numberValue(event.payload.cost);
  }
  for (const event of toolEvents(events)) {
    summary.toolCalls += 1;
    if (event.payload.status === 'error') summary.toolErrors += 1;
  }
  summary.activeSessions = sessions.size;
  summary.runsToday = runs.size;
  summary.tokensTotal = summary.tokensInput + summary.tokensOutput + summary.tokensCached + summary.tokensCachedWrite;
  const totalInput = summary.tokensInput + summary.tokensCached + summary.tokensCachedWrite;
  summary.cacheHitRate = totalInput > 0 ? (summary.tokensCached / totalInput) * 100 : 0;
  return summary;
}

function queryModelUsageFromEvents(events: TraceTelemetryLogEvent[]) {
  const models = new Map<
    string,
    {
      modelId: string;
      tokens: number;
      cost: number;
      calls: number;
      tokensInput: number;
      tokensOutput: number;
      tokensCached: number;
      tokensCachedWrite: number;
    }
  >();
  const throughput = new Map<string, { ts: string; tokens: number; cost: number; calls: number }>();
  for (const event of statsEvents(events)) {
    const modelId = stringValue(event.payload.modelId) ?? 'unknown';
    const tokensInput = numberValue(event.payload.tokensInput);
    const tokensOutput = numberValue(event.payload.tokensOutput);
    const tokensCached = numberValue(event.payload.tokensCachedInput);
    const tokensCachedWrite = numberValue(event.payload.tokensCachedWrite);
    const tokens = tokensInput + tokensOutput + tokensCached + tokensCachedWrite;
    const cost = numberValue(event.payload.cost);
    const model = models.get(modelId) ?? {
      modelId,
      tokens: 0,
      cost: 0,
      calls: 0,
      tokensInput: 0,
      tokensOutput: 0,
      tokensCached: 0,
      tokensCachedWrite: 0,
    };
    model.tokens += tokens;
    model.cost += cost;
    model.calls += 1;
    model.tokensInput += tokensInput;
    model.tokensOutput += tokensOutput;
    model.tokensCached += tokensCached;
    model.tokensCachedWrite += tokensCachedWrite;
    models.set(modelId, model);
    const hour = hourKey(event.ts);
    const bucket = throughput.get(hour) ?? { ts: hour, tokens: 0, cost: 0, calls: 0 };
    bucket.tokens += tokens;
    bucket.cost += cost;
    bucket.calls += 1;
    throughput.set(hour, bucket);
  }
  return {
    models: [...models.values()].sort((a, b) => b.tokens - a.tokens),
    throughput: [...throughput.values()].sort((a, b) => a.ts.localeCompare(b.ts)),
  };
}

function bashCommand(event: TraceTelemetryLogEvent): string | null {
  return stringValue(event.payload.bashCommand) ?? stringValue(event.payload.bashCommandLabel);
}

function bashLabel(event: TraceTelemetryLogEvent): string | null {
  return stringValue(event.payload.bashCommandLabel) ?? bashCommand(event)?.trim().split(/\s+/)[0] ?? null;
}

function bashComplexityScore(command: string): { score: number; shape: string; commandCount: number } {
  const commandCount = command.split(/&&|\|\||\||;/).filter((part) => part.trim()).length;
  const score =
    commandCount +
    (command.includes('|') ? 2 : 0) +
    (command.includes('&&') || command.includes('||') ? 2 : 0) +
    (/[<>]/.test(command) ? 1 : 0) +
    (command.includes('\n') ? 2 : 0) +
    (/\$\(|`/.test(command) ? 2 : 0);
  const shape = command.includes('|')
    ? 'pipeline'
    : command.includes('&&') || command.includes('||')
      ? 'chain'
      : commandCount > 1
        ? 'compound'
        : 'simple';
  return { score, shape, commandCount };
}

function queryToolHealthFromEvents(events: TraceTelemetryLogEvent[]) {
  const grouped = new Map<string, Array<TraceTelemetryLogEvent>>();
  for (const event of toolEvents(events)) {
    const name = stringValue(event.payload.toolName) ?? 'unknown';
    grouped.set(name, [...(grouped.get(name) ?? []), event]);
  }
  return [...grouped.entries()]
    .map(([toolName, rows]) => {
      const latencies = rows.map((event) => numberValue(event.payload.durationMs)).filter((value) => value > 0);
      const errors = rows.filter((event) => event.payload.status === 'error').length;
      const bashRows = toolName === 'bash' ? rows : [];
      const byCommand = new Map<string, Array<TraceTelemetryLogEvent>>();
      for (const row of bashRows) {
        const label = bashLabel(row) ?? 'unknown';
        byCommand.set(label, [...(byCommand.get(label) ?? []), row]);
      }
      const bashBreakdown = [...byCommand.entries()].map(([command, commandRows]) => {
        const commandLatencies = commandRows.map((event) => numberValue(event.payload.durationMs)).filter((value) => value > 0);
        const commandErrors = commandRows.filter((event) => event.payload.status === 'error').length;
        return {
          command,
          calls: commandRows.length,
          errors: commandErrors,
          errorRate: commandRows.length > 0 ? (commandErrors / commandRows.length) * 100 : 0,
          p95LatencyMs: percentile(commandLatencies, 0.95),
        };
      });
      const complexities = bashRows.map((event) => bashComplexityScore(bashCommand(event) ?? bashLabel(event) ?? ''));
      const shapeCounts = new Map<string, number>();
      for (const complexity of complexities) shapeCounts.set(complexity.shape, (shapeCounts.get(complexity.shape) ?? 0) + 1);
      const bashComplexity =
        toolName === 'bash'
          ? {
              avgScore: complexities.length ? complexities.reduce((total, row) => total + row.score, 0) / complexities.length : 0,
              maxScore: complexities.length ? Math.max(...complexities.map((row) => row.score)) : 0,
              maxCommandCount: complexities.length ? Math.max(...complexities.map((row) => row.commandCount)) : 0,
              pipelineCalls: bashRows.filter((event) => bashCommand(event)?.includes('|')).length,
              chainCalls: bashRows.filter((event) => /&&|\|\|/.test(bashCommand(event) ?? '')).length,
              redirectCalls: bashRows.filter((event) => /[<>]/.test(bashCommand(event) ?? '')).length,
              multilineCalls: bashRows.filter((event) => bashCommand(event)?.includes('\n')).length,
              shellCalls: bashRows.filter((event) => /\b(sh|bash|zsh)\b/.test(bashCommand(event) ?? '')).length,
              substitutionCalls: bashRows.filter((event) => /\$\(|`/.test(bashCommand(event) ?? '')).length,
              shapeBreakdown: [...shapeCounts.entries()].map(([shape, calls]) => ({ shape, calls })),
            }
          : null;
      return {
        toolName,
        calls: rows.length,
        errors,
        avgLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
        p95LatencyMs: percentile(latencies, 0.95),
        maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
        bashBreakdown,
        bashComplexity,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

function queryAgentLoopFromEvents(events: TraceTelemetryLogEvent[]) {
  const stats = statsEvents(events);
  const durations = stats.map((event) => numberValue(event.payload.durationMs)).filter((value) => value > 0);
  const steps = stats.map((event) => numberValue(event.payload.stepCount));
  const runs = new Set(stats.map((event) => event.runId).filter(Boolean));
  return {
    turns: stats.length,
    turnsPerRun: runs.size > 0 ? stats.length / runs.size : stats.length,
    avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    maxDurationMs: durations.length ? Math.max(...durations) : 0,
    avgSteps: steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : 0,
    errors: toolEvents(events).filter((event) => event.payload.status === 'error').length,
    recent: stats.slice(-20).reverse(),
  };
}

function queryToolFlowFromEvents(events: TraceTelemetryLogEvent[]) {
  const bySession = new Map<string, TraceTelemetryLogEvent[]>();
  for (const event of toolEvents(events)) bySession.set(event.sessionId, [...(bySession.get(event.sessionId) ?? []), event]);
  const transitions = new Map<string, { fromTool: string; toTool: string; count: number }>();
  const coOccurrences = new Map<string, { toolA: string; toolB: string; sessions: number }>();
  const failureTrajectories: Array<{
    sessionId: string;
    ts: string;
    toolName: string;
    failedTool: string;
    previousCalls: string[];
    errorMessage: string | null;
  }> = [];
  for (const [sessionId, rows] of bySession.entries()) {
    const sorted = rows.sort((a, b) => a.ts.localeCompare(b.ts));
    const labels = sorted.map((event) =>
      stringValue(event.payload.toolName) === 'bash'
        ? `bash:${bashLabel(event) ?? 'unknown'}`
        : (stringValue(event.payload.toolName) ?? 'unknown'),
    );
    for (let index = 1; index < labels.length; index += 1) {
      const key = `${labels[index - 1]}→${labels[index]}`;
      const current = transitions.get(key) ?? { fromTool: labels[index - 1], toTool: labels[index], count: 0 };
      current.count += 1;
      transitions.set(key, current);
    }
    const uniqueLabels = [...new Set(labels)].sort((left, right) => left.localeCompare(right));
    for (let left = 0; left < uniqueLabels.length; left += 1) {
      for (let right = left + 1; right < uniqueLabels.length; right += 1) {
        const key = `${uniqueLabels[left]}+${uniqueLabels[right]}`;
        const current = coOccurrences.get(key) ?? { toolA: uniqueLabels[left], toolB: uniqueLabels[right], sessions: 0 };
        current.sessions += 1;
        coOccurrences.set(key, current);
      }
    }
    sorted.forEach((event, index) => {
      if (event.payload.status !== 'error') return;
      failureTrajectories.push({
        sessionId,
        ts: event.ts,
        toolName: labels[index],
        failedTool: labels[index],
        previousCalls: labels.slice(Math.max(0, index - 3), index),
        errorMessage: stringValue(event.payload.errorMessage),
      });
    });
  }
  return {
    transitions: [...transitions.values()].sort((a, b) => b.count - a.count),
    coOccurrences: [...coOccurrences.values()].sort((a, b) => b.sessions - a.sessions),
    failureTrajectories: failureTrajectories.sort((a, b) => b.ts.localeCompare(a.ts)),
  };
}

function ok(body: unknown): ExtensionRouteResponse {
  return { status: 200, body };
}

export function summary(req: ExtensionRouteRequest): ExtensionRouteResponse {
  return ok(querySummaryFromEvents(eventsSince(parseRangeParam(req.query.range))));
}

export function modelUsage(req: ExtensionRouteRequest): ExtensionRouteResponse {
  return ok(queryModelUsageFromEvents(eventsSince(parseRangeParam(req.query.range))));
}

export function costByConversation(): ExtensionRouteResponse {
  return ok([]);
}

export function toolHealth(req: ExtensionRouteRequest): ExtensionRouteResponse {
  return ok(queryToolHealthFromEvents(eventsSince(parseRangeParam(req.query.range))));
}

export function context(req: ExtensionRouteRequest): ExtensionRouteResponse {
  const events = eventsSince(parseRangeParam(req.query.range));
  const sessions = contextEvents(events)
    .map((event) => ({
      sessionId: event.sessionId,
      ts: event.ts,
      modelId: stringValue(event.payload.modelId),
      totalTokens: numberValue(event.payload.totalTokens),
      contextWindow: numberValue(event.payload.contextWindow),
      pct: numberValue(event.payload.pct),
      segSystem: numberValue(event.payload.segSystem),
      segUser: numberValue(event.payload.segUser),
      segAssistant: numberValue(event.payload.segAssistant),
      segTool: numberValue(event.payload.segTool),
      segSummary: numberValue(event.payload.segSummary),
      systemPromptTokens: numberValue(event.payload.systemPromptTokens),
    }))
    .sort((a, b) => b.ts.localeCompare(a.ts));
  const compactions = events
    .filter((event) => event.type === 'compaction')
    .map((event) => ({
      sessionId: event.sessionId,
      ts: event.ts,
      reason: stringValue(event.payload.reason) ?? 'manual',
      tokensBefore: numberValue(event.payload.tokensBefore),
      tokensAfter: numberValue(event.payload.tokensAfter),
      tokensSaved: numberValue(event.payload.tokensSaved),
    }));
  return ok({
    sessions,
    compactions,
    compactionAggs: { count: compactions.length, tokensSaved: compactions.reduce((total, row) => total + row.tokensSaved, 0) },
  });
}

export function agentLoop(req: ExtensionRouteRequest): ExtensionRouteResponse {
  return ok(queryAgentLoopFromEvents(eventsSince(parseRangeParam(req.query.range))));
}

export function tokensDaily(req: ExtensionRouteRequest): ExtensionRouteResponse {
  const buckets = new Map<string, { date: string; tokens: number; cost: number; calls: number }>();
  for (const event of statsEvents(eventsSince(parseRangeParam(req.query.range)))) {
    const date = dayKey(event.ts);
    const bucket = buckets.get(date) ?? { date, tokens: 0, cost: 0, calls: 0 };
    bucket.tokens +=
      numberValue(event.payload.tokensInput) +
      numberValue(event.payload.tokensOutput) +
      numberValue(event.payload.tokensCachedInput) +
      numberValue(event.payload.tokensCachedWrite);
    bucket.cost += numberValue(event.payload.cost);
    bucket.calls += 1;
    buckets.set(date, bucket);
  }
  return ok([...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)));
}

export function toolFlow(req: ExtensionRouteRequest): ExtensionRouteResponse {
  return ok(queryToolFlowFromEvents(eventsSince(parseRangeParam(req.query.range))));
}

export function cacheEfficiency(req: ExtensionRouteRequest): ExtensionRouteResponse {
  const summary = querySummaryFromEvents(eventsSince(parseRangeParam(req.query.range)));
  return ok({
    series: [],
    aggregate: {
      requestCacheHitRate: Math.round(summary.cacheHitRate * 10) / 10,
      overallHitRate: Math.round(summary.cacheHitRate * 10) / 10,
      totalCached: summary.tokensCached,
      cachedRequests: summary.tokensCached > 0 ? 1 : 0,
      requests: summary.tokensInput + summary.tokensCached + summary.tokensCachedWrite > 0 ? 1 : 0,
      byModel: [],
    },
  });
}

export function systemPrompt(): ExtensionRouteResponse {
  return ok({
    series: [],
    aggregate: {
      avgSystemPromptTokens: 0,
      avgPctOfContextWindow: 0,
      maxSystemPromptTokens: 0,
      samples: 0,
      byModel: [],
    },
  });
}

export function autoMode(req: ExtensionRouteRequest): ExtensionRouteResponse {
  const events = eventsSince(parseRangeParam(req.query.range)).filter((event) => event.type === 'auto_mode');
  const recentEvents = events
    .slice(-20)
    .reverse()
    .map((event) => ({
      ts: event.ts,
      sessionId: event.sessionId,
      enabled: event.payload.enabled === 1 || event.payload.enabled === true,
      stopReason: stringValue(event.payload.stopReason),
    }));
  return ok({
    currentActive: recentEvents.filter((event) => event.enabled).length,
    enabledCount: recentEvents.filter((event) => event.enabled).length,
    disabledCount: recentEvents.filter((event) => !event.enabled).length,
    topStopReasons: [],
    recentEvents,
  });
}

export function contextPointers(req: ExtensionRouteRequest): ExtensionRouteResponse {
  const events = eventsSince(parseRangeParam(req.query.range));
  const suggested = events.filter((event) => event.type === 'suggested_context');
  const inspected = events.filter((event) => event.type === 'context_pointer_inspect');
  const totalSuggested = suggested.reduce((total, event) => total + numberValue(event.payload.pointerCount), 0);
  const totalInspects = inspected.filter((event) => event.payload.wasSuggested === 1).length;
  const daily = new Map<string, { date: string; suggested: number; inspected: number }>();
  for (const event of suggested) {
    const date = dayKey(event.ts);
    const bucket = daily.get(date) ?? { date, suggested: 0, inspected: 0 };
    bucket.suggested += numberValue(event.payload.pointerCount);
    daily.set(date, bucket);
  }
  for (const event of inspected) {
    const date = dayKey(event.ts);
    const bucket = daily.get(date) ?? { date, suggested: 0, inspected: 0 };
    bucket.inspected += event.payload.wasSuggested === 1 ? 1 : 0;
    daily.set(date, bucket);
  }
  return ok({
    summary: {
      totalSuggested,
      totalInspects,
      totalAnyInspects: inspected.length,
      usageRate: totalSuggested > 0 ? Math.round((totalInspects / totalSuggested) * 1000) / 10 : 0,
      sessionsWithSuggested: new Set(suggested.map((event) => event.sessionId)).size,
      avgPointersPerTurn: suggested.length > 0 ? Math.round((totalSuggested / suggested.length) * 10) / 10 : 0,
    },
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  });
}

export function sessionIntegrity(req: ExtensionRouteRequest): ExtensionRouteResponse {
  const since = parseRangeParam(req.query.range);
  return ok(queryAppTelemetryEvents({ since, limit: 200 }).filter((event) => event.category === 'session_integrity'));
}
