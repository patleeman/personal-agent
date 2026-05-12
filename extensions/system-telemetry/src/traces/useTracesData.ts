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
import { api } from '@personal-agent/extensions/data';
import { useCallback, useEffect, useState } from 'react';

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
        api.tracesSummary(range),
        api.tracesModelUsage(range),
        api.tracesCostByConversation(range),
        api.tracesToolHealth(range),
        api.tracesContext(range),
        api.tracesAgentLoop(range),
        api.tracesTokensDaily(range),
        api.tracesToolFlow(range),
        api.tracesAutoMode(range),
        api.tracesCacheEfficiency(range),
        api.tracesSystemPrompt(range),
        api.tracesContextPointers(range),
        typeof api.tracesSessionIntegrity === 'function' ? api.tracesSessionIntegrity(range) : Promise.resolve([]),
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
