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

import { useState } from 'react';

import { ErrorState, LoadingState } from '../components/ui';
import { TracesAgentLoop } from './traces/TracesAgentLoop';
import { TracesAutoMode } from './traces/TracesAutoMode';
import { TracesBraidChart } from './traces/TracesBraidChart';
import { TracesCacheAndSystemPrompt } from './traces/TracesCacheAndSystemPrompt';
import { TracesContextPressure } from './traces/TracesContextPressure';
import { TracesHeatmap } from './traces/TracesHeatmap';
import { TracesModelUsage } from './traces/TracesModelUsage';
import { TracesToolFlow } from './traces/TracesToolFlow';
import { TracesToolHealth } from './traces/TracesToolHealth';
import type { TraceRange } from './traces/useTracesData';
import { useTracesData } from './traces/useTracesData';

export function TracesPage() {
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
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-border-subtle bg-surface px-6 py-3 shrink-0">
        <h1 className="text-[15px] font-semibold">Telemetry</h1>
        <span className="text-[12px] text-dim">Monitoring &amp; instrumentation</span>
        <span className="flex-1" />
        <TimeRangeSelector value={range} onChange={setRange} />
        <button type="button" onClick={refetch} className="ui-action-button text-[11px]">
          ↻ Refresh
        </button>
      </div>

      {/* Main scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 pb-10 space-y-4" style={{ paddingTop: '14px' }}>
        {/* ── Pulse Row ── */}
        {summary && <PulseRow summary={summary} />}

        {/* ── Heatmap ── */}
        {tokensDaily && <TracesHeatmap data={tokensDaily} />}

        {/* ── Model Usage ── */}
        {modelUsage && summary && (
          <TracesModelUsage
            models={modelUsage}
            throughput={throughput ?? []}
            totalTokens={modelUsage.reduce((total, model) => total + model.tokens, 0)}
            totalCost={summary.totalCost}
            tokensInput={summary.tokensInput}
            tokensOutput={summary.tokensOutput}
            tokensCached={summary.tokensCached}
            cacheHitRate={summary.cacheHitRate}
          />
        )}

        {/* ── Braid Chart ── */}
        {tokensDaily && summary && <TracesBraidChart data={tokensDaily} />}

        {/* ── Tool Telemetry ── */}
        {toolHealth && <TracesToolHealth tools={toolHealth} />}

        {/* ── Tool Flow ── */}
        <TracesToolFlow data={toolFlow} />

        {/* ── Auto Mode ── */}
        <TracesAutoMode data={autoMode} />

        {/* ── Cache & System Prompt ── */}
        <TracesCacheAndSystemPrompt cacheEfficiency={cacheEfficiency} systemPrompt={systemPrompt} />

        {/* ── Context Pressure ── */}
        <TracesContextPressure sessions={contextSessions ?? []} compactions={compactions ?? []} compactionAggs={compactionAggs} />

        {/* ── Agent Loop ── */}
        <TracesAgentLoop loop={agentLoop} />
      </div>
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
    <div className="flex gap-0.5 rounded-lg bg-elevated p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            value === opt.value ? 'bg-accent text-white' : 'text-dim hover:text-primary'
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
      label: 'Active Sessions',
      value: String(summary.activeSessions),
      cls: 'text-accent',
      trend: `${summary.activeSessions > 0 ? '✦' : '—'} live`,
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
      trend: `in ${formatTokens(summary.tokensInput)} · out ${formatTokens(summary.tokensOutput)}`,
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
    <div className="grid grid-cols-5 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="relative flex flex-col gap-1 rounded-xl border border-border-subtle bg-surface px-4 py-3">
          {card.dot && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-accent animate-pulse" />}
          <span className="text-[10px] uppercase tracking-[0.1em] text-dim">{card.label}</span>
          <span className={`text-[24px] font-semibold leading-none tracking-tight ${card.cls}`}>{card.value}</span>
          <span className="text-[11px] text-dim">{card.trend}</span>
        </div>
      ))}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
