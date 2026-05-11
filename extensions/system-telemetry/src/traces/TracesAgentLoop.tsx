/**
 * Agent Loop Health & Run Waterfall
 */

import type { TraceAgentLoop } from '@personal-agent/extensions/data';

export function TracesAgentLoop({ loop }: { loop: TraceAgentLoop | null }) {
  if (!loop) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <span className="text-[12px] font-semibold">🔄 Agent Loop Health</span>
          <span className="ml-auto text-[10px] text-dim">No data yet</span>
        </div>
        <div className="p-6 text-center text-[12px] text-dim">Loop metrics appear after agent runs complete.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="text-[12px] font-semibold">🔄 Agent Loop Health</span>
        <span className="ml-auto text-[10px] text-dim bg-elevated px-2 py-0.5 rounded-full">Selected range</span>
      </div>
      <div className="p-4">
        {/* Loop stats grid */}
        <div className="grid grid-cols-4 gap-2.5 mb-4">
          <LoopStat value={formatNumber(loop.turnsPerRun)} label="Avg Turns / Run" cls="text-accent" />
          <LoopStat value={formatNumber(loop.stepsPerTurn)} label="Avg Steps / Turn" cls="text-accent" />
          <LoopStat value={formatNumber(loop.toolCallsPerRun)} label="Tool Calls / Run" cls="text-accent" />
          <LoopStat value={formatNumber(loop.toolCallsP95)} label="P95 Tool Calls" cls="text-warning" />
          <LoopStat
            value={formatPercent(loop.toolErrorRatePct)}
            label="Tool Error Rate"
            cls={loop.toolErrorRatePct > 0 ? 'text-danger' : 'text-dim'}
          />
          <LoopStat value={formatTokens(loop.avgTokensPerRun)} label="Avg Tokens / Run" cls="text-secondary" />
          <LoopStat value={formatNumber(loop.subagentsPerRun)} label="Subagents / Run" cls="text-accent" />
          <LoopStat value={formatDuration(loop.avgDurationMs)} label="Avg Run Duration" cls="text-success" />
          <LoopStat
            value={formatNumber(loop.runsOver20Turns)}
            label="Runs &gt; 20 Turns"
            cls={loop.runsOver20Turns > 0 ? 'text-warning' : 'text-dim'}
          />
          <LoopStat
            value={formatNumber(loop.stuckRuns)}
            label="Stuck Runs (&gt;10m)"
            cls={loop.stuckRuns > 0 ? 'text-danger' : 'text-dim'}
          />
          <LoopStat
            value={formatPercent(loop.stuckRunPct)}
            label="Stuck Run Rate"
            cls={loop.stuckRunPct > 0 ? 'text-danger' : 'text-dim'}
          />
        </div>

        <div className="pt-3 border-t border-border-subtle">
          <div className="text-[11px] font-medium mb-3">Run Duration Distribution</div>
          {loop.durationP99Ms > 0 ? (
            <>
              <DurBar
                label="P50"
                pct={durationPct(loop.durationP50Ms, loop.durationP99Ms)}
                val={formatDuration(loop.durationP50Ms)}
                color="bg-accent"
              />
              <DurBar
                label="P95"
                pct={durationPct(loop.durationP95Ms, loop.durationP99Ms)}
                val={formatDuration(loop.durationP95Ms)}
                color="bg-warning"
              />
              <DurBar label="P99" pct={100} val={formatDuration(loop.durationP99Ms)} color="bg-danger" />
            </>
          ) : (
            <div className="rounded-lg bg-elevated px-3 py-4 text-center text-[11px] text-dim">
              Duration percentiles need completed runs with timings.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoopStat({ value, label, cls }: { value: string; label: string; cls: string }) {
  return (
    <div className="bg-elevated rounded-lg p-3 text-center">
      <div className={`text-[17px] font-semibold font-mono ${cls}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-[0.08em] text-dim mt-0.5">{label}</div>
    </div>
  );
}

function DurBar({ label, pct, val, color }: { label: string; pct: number; val: string; color: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="w-[60px] text-[11px] text-secondary shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-elevated rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-[55px] text-right font-mono text-[11px] text-secondary shrink-0">{val}</span>
    </div>
  );
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0';
  return String(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0%';
  return `${value}%`;
}

function formatTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
  return String(value);
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

function durationPct(ms: number, maxMs: number): number {
  if (maxMs <= 0) return 0;
  return Math.max(4, Math.min(100, Math.round((ms / maxMs) * 100)));
}
