/**
 * Data hook for the Traces page.
 * Fetches all telemetry endpoints with a configurable time range.
 */

import type {
  AppTelemetryEventRow,
  AutoModeSummary,
  CacheEfficiencyAggregate,
  ContextPointerUsageResult,
  SystemPromptAggregate,
  ToolFlowResult,
  TraceAgentLoop,
  TraceCompactionAggs,
  TraceCompactionEvent,
  TraceContextSession,
  TraceCostRow,
  TraceModelUsage,
  TraceSummary,
  TraceThroughput,
  TraceTokenDaily,
  TraceToolHealth,
} from '@personal-agent/extensions/data';
import { useCallback, useEffect, useState } from 'react';

async function telemetryGet<T>(path: string, range: TraceRange): Promise<T> {
  const params = new URLSearchParams({ range });
  const response = await fetch(`/api/extensions/system-telemetry/routes${path}?${params.toString()}`);
  if (!response.ok) throw new Error(`Telemetry request failed: ${response.status}`);
  return (await response.json()) as T;
}

function notifyError(message: string) {
  window.dispatchEvent(new CustomEvent('pa-notification', { detail: { type: 'error', message, source: 'system-telemetry' } }));
}

export type TraceRange = '1h' | '6h' | '24h' | '7d' | '30d';

export interface TracesData {
  summary: TraceSummary | null;
  modelUsage: TraceModelUsage[] | null;
  throughput: TraceThroughput[] | null;
  costByConversation: TraceCostRow[] | null;
  toolHealth: TraceToolHealth[] | null;
  contextSessions: TraceContextSession[] | null;
  compactions: TraceCompactionEvent[] | null;
  compactionAggs: TraceCompactionAggs | null;
  agentLoop: TraceAgentLoop | null;
  tokensDaily: TraceTokenDaily[] | null;
  toolFlow: ToolFlowResult | null;
  autoMode: AutoModeSummary | null;
  cacheEfficiency: CacheEfficiencyAggregate | null;
  systemPrompt: SystemPromptAggregate | null;
  contextPointers: ContextPointerUsageResult | null;
  sessionIntegrity: AppTelemetryEventRow[] | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: TracesData = {
  summary: null,
  modelUsage: null,
  throughput: null,
  costByConversation: null,
  toolHealth: null,
  contextSessions: null,
  compactions: null,
  compactionAggs: null,
  agentLoop: null,
  tokensDaily: null,
  toolFlow: null,
  autoMode: null,
  cacheEfficiency: null,
  systemPrompt: null,
  contextPointers: null,
  sessionIntegrity: null,
  loading: true,
  error: null,
};

export function useTracesData(range: TraceRange): TracesData & { refetch: () => void } {
  const [data, setData] = useState<TracesData>(EMPTY);

  const fetch = useCallback(async () => {
    setData((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [
        summary,
        modelUsage,
        costByConversation,
        toolHealth,
        context,
        agentLoop,
        tokensDaily,
        toolFlow,
        autoMode,
        cacheEff,
        sysPrompt,
        contextPointers,
        sessionIntegrity,
      ] = await Promise.all([
        telemetryGet<TraceSummary>('/traces/summary', range),
        telemetryGet<{ models: TraceModelUsage[]; throughput: TraceThroughput[] }>('/traces/model-usage', range),
        telemetryGet<TraceCostRow[]>('/traces/cost-by-conversation', range),
        telemetryGet<TraceToolHealth[]>('/traces/tool-health', range),
        telemetryGet<{ sessions: TraceContextSession[]; compactions: TraceCompactionEvent[]; compactionAggs: TraceCompactionAggs }>(
          '/traces/context',
          range,
        ),
        telemetryGet<TraceAgentLoop>('/traces/agent-loop', range),
        telemetryGet<TraceTokenDaily[]>('/traces/tokens-daily', range),
        telemetryGet<ToolFlowResult>('/traces/tool-flow', range),
        telemetryGet<AutoModeSummary>('/traces/auto-mode', range),
        telemetryGet<{ series: unknown[]; aggregate: CacheEfficiencyAggregate }>('/traces/cache-efficiency', range),
        telemetryGet<{ series: unknown[]; aggregate: SystemPromptAggregate }>('/traces/system-prompt', range),
        telemetryGet<ContextPointerUsageResult>('/traces/context-pointers', range),
        telemetryGet<AppTelemetryEventRow[]>('/traces/session-integrity', range),
      ]);

      setData({
        summary,
        modelUsage: modelUsage.models,
        throughput: modelUsage.throughput,
        costByConversation,
        toolHealth,
        contextSessions: context.sessions,
        compactions: context.compactions,
        compactionAggs: context.compactionAggs,
        agentLoop,
        tokensDaily,
        toolFlow,
        autoMode,
        cacheEfficiency: cacheEff.aggregate,
        systemPrompt: sysPrompt.aggregate,
        contextPointers,
        sessionIntegrity,
        loading: false,
        error: null,
      });
    } catch (err) {
      setData((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load trace data',
      }));
      notifyError(err instanceof Error ? err.message : 'Failed to load trace data');
    }
  }, [range]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { ...data, refetch: fetch };
}
