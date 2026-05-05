/**
 * Agent Loop Health & Run Waterfall
 */

import type { TraceAgentLoop } from '../../shared/types';

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
        <span className="ml-auto text-[10px] text-dim bg-elevated px-2 py-0.5 rounded-full">Last 24h</span>
      </div>
      <div className="p-4">
        {/* Loop stats grid */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <LoopStat value={String(loop.turnsPerRun)} label="Avg Turns / Run" cls="text-accent" />
          <LoopStat value={String(loop.stepsPerTurn)} label="Avg Steps / Turn" cls="text-accent" />
          <LoopStat
            value={String(loop.runsOver20Turns)}
            label="Runs &gt; 20 Turns"
            cls={loop.runsOver20Turns > 0 ? 'text-warning' : 'text-dim'}
          />
          <LoopStat value={String(loop.subagentsPerRun)} label="Subagents / Run" cls="text-accent" />
          <LoopStat value={formatDuration(loop.avgDurationMs)} label="Avg Run Duration" cls="text-success" />
          <LoopStat value={String(loop.stuckRuns)} label="Stuck Runs (&gt;10m)" cls={loop.stuckRuns > 0 ? 'text-danger' : 'text-dim'} />
        </div>

        {/* Waterfall bars (simulated) */}
        <div className="pt-3 border-t border-border-subtle">
          <div className="text-[11px] font-medium mb-3">Run Duration Distribution</div>
          <DurBar label="P50" pct={50} val="2m 18s" color="bg-accent" />
          <DurBar label="P95" pct={82} val="8m 42s" color="bg-warning" />
          <DurBar label="P99" pct={95} val="14m 06s" color="bg-danger" />
        </div>

        {/* Waterfall legend */}
        <div className="flex gap-3 text-[10px] text-dim mt-3 pt-3 border-t border-border-subtle">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-accent" /> Thinking
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-warning" /> Tools
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-success" /> Output
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-steel/50" /> Overhead
          </span>
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

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}
