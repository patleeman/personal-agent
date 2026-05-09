/**
 * Traces Page — Full telemetry and monitoring dashboard.
 *
 * Sections:
 * 1. Live token stream (animated bar)
 * 2. Pulse row (5 summary cards)
 * 3. Token activity heatmap
 * 4. Model usage & cost breakdown
 * 5. Braid chart (time series overlay)
 * 6. Tool telemetry
 * 7. Context pressure & session activity
 * 8. Agent loop health & run waterfall
 * 9. Subagent flame graph
 */

import { AppPageIntro, AppPageLayout, ErrorState, LoadingState, ToolbarButton } from '@personal-agent/extensions/ui';
import { useState } from 'react';

import { TracesAgentLoop } from './traces/TracesAgentLoop';
import { TracesAutoMode } from './traces/TracesAutoMode';
import { TracesBraidChart } from './traces/TracesBraidChart';
import { TracesCacheAndSystemPrompt } from './traces/TracesCacheAndSystemPrompt';
import { TracesContextPointers } from './traces/TracesContextPointers';
import { TracesContextPressure } from './traces/TracesContextPressure';
import { TracesHeatmap } from './traces/TracesHeatmap';
import { TracesModelUsage } from './traces/TracesModelUsage';
import { TracesToolFlow } from './traces/TracesToolFlow';
import { TracesToolHealth } from './traces/TracesToolHealth';
import type { TraceRange } from './traces/useTracesData';
import { useTracesData } from './traces/useTracesData';

export function TelemetryPage() {
  const [range, setRange] = useState<TraceRange>('24h');
  const {
    summary,
    modelUsage,
    throughput,
    toolHealth,
    contextSessions,
    compactions,
    compactionAggs,
    agentLoop,
    tokensDaily,
    toolFlow,
    autoMode,
    cacheEfficiency,
    systemPrompt,
    contextPointers,
    loading,
    error,
    refetch,
  } = useTracesData(range);

  if (loading && !summary) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <LoadingState label="Loading trace data…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center space-y-3">
          <ErrorState message={error} />
          <button type="button" onClick={refetch} className="ui-action-button text-[11px]">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="space-y-10">
        <AppPageIntro
          title="Telemetry"
          summary="Monitoring, usage, and runtime instrumentation across recent agent activity."
          actions={
            <div className="flex items-center gap-2">
              <TimeRangeSelector value={range} onChange={setRange} />
              <ToolbarButton className="rounded-lg px-3 py-1.5 text-[12px] text-primary shadow-none" onClick={refetch}>
                Refresh
              </ToolbarButton>
            </div>
          }
        />

        {/* ── Pulse Row ── */}
        {summary && <PulseRow summary={summary} />}

        <section className="space-y-4 border-t border-border-subtle pt-6">
          {tokensDaily && <TracesHeatmap data={tokensDaily} />}
          {modelUsage && summary && (
            <TracesModelUsage
              models={modelUsage}
              throughput={throughput ?? []}
              totalTokens={modelUsage.reduce((total, model) => total + model.tokens, 0)}
              tokensInput={summary.tokensInput}
              tokensOutput={summary.tokensOutput}
              tokensCached={summary.tokensCached}
              tokensCachedWrite={summary.tokensCachedWrite}
              cacheHitRate={summary.cacheHitRate}
              cacheEfficiency={cacheEfficiency}
            />
          )}
          {tokensDaily && summary && <TracesBraidChart data={tokensDaily} />}
        </section>

        <section className="space-y-4 border-t border-border-subtle pt-6">
          {toolHealth && <TracesToolHealth tools={toolHealth} />}
          <TracesToolFlow data={toolFlow} />
        </section>

        <section className="space-y-4 border-t border-border-subtle pt-6">
          <TracesContextPointers data={contextPointers} />
          <TracesAutoMode data={autoMode} />
          <TracesCacheAndSystemPrompt cacheEfficiency={cacheEfficiency} systemPrompt={systemPrompt} />
          <TracesContextPressure sessions={contextSessions ?? []} compactions={compactions ?? []} compactionAggs={compactionAggs} />
          <TracesAgentLoop loop={agentLoop} />
        </section>
      </AppPageLayout>
    </div>
  );
}

// ── Time Range Selector ──────────────────────────────────────────────────────

function TimeRangeSelector({ value, onChange }: { value: TraceRange; onChange: (v: TraceRange) => void }) {
  const options: { label: string; value: TraceRange }[] = [
    { label: '1H', value: '1h' },
    { label: '6H', value: '6h' },
    { label: '24H', value: '24h' },
    { label: '7D', value: '7d' },
  ];

  return (
    <div className="flex gap-1 border-r border-border-subtle pr-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
            value === opt.value ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:bg-surface/45 hover:text-primary'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Pulse Row ────────────────────────────────────────────────────────────────

function PulseRow({ summary }: { summary: NonNullable<ReturnType<typeof useTracesData>['summary']> }) {
  const cards = [
    {
      label: 'Traced Sessions',
      value: String(summary.activeSessions),
      cls: 'text-accent',
      trend: `${summary.activeSessions > 0 ? '✦' : '—'} observed in range`,
      dot: summary.activeSessions > 0,
    },
    {
      label: 'Runs Today',
      value: String(summary.runsToday),
      cls: 'text-primary',
      trend: `${summary.toolCalls} tool calls`,
    },
    {
      label: 'Total Cost',
      value: `$${summary.totalCost.toFixed(2)}`,
      cls: 'text-warning',
      trend: `${(summary.tokensTotal / 1000).toFixed(0)}K tokens`,
    },
    {
      label: 'Tokens Today',
      value: formatTokens(summary.tokensTotal),
      cls: 'text-success',
      trend: `in ${formatTokens(summary.tokensInput)} · cached ${formatTokens(summary.tokensCached)} · out ${formatTokens(summary.tokensOutput)}`,
    },
    {
      label: 'Tool Errors',
      value: String(summary.toolErrors),
      cls: summary.toolErrors > 0 ? 'text-danger' : 'text-primary',
      trend: `${((summary.toolErrors / Math.max(summary.toolCalls, 1)) * 100).toFixed(1)}% error rate`,
      dot: summary.toolErrors > 0,
    },
  ];

  return (
    <section className="grid grid-cols-1 border-y border-border-subtle sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className="relative flex min-w-0 flex-col gap-2 border-border-subtle py-4 sm:px-4 sm:[&:not(:first-child)]:border-l max-sm:border-t max-sm:first:border-t-0"
        >
          {card.dot && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-accent animate-pulse" />}
          <span className="text-[10px] uppercase tracking-[0.1em] text-dim">{card.label}</span>
          <span className={`text-[24px] font-semibold leading-none tracking-tight ${card.cls}`}>{card.value}</span>
          <span className="text-[11px] text-dim">{card.trend}</span>
        </div>
      ))}
    </section>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
