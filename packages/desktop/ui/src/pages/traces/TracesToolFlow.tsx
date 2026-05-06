/**
 * Tool Flow — Trajectories, transitions, co-occurrence, and failure patterns
 */

import type { ToolFlowResult } from '../../shared/types';

export function TracesToolFlow({ data }: { data: ToolFlowResult | null }) {
  if (!data || (data.transitions.length === 0 && data.coOccurrences.length === 0)) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <span className="text-[12px] font-semibold">🔀 Tool Flow &amp; Trajectories</span>
          <span className="ml-auto text-[10px] text-dim">No tool sequences yet</span>
        </div>
        <div className="p-6 text-center text-[12px] text-dim">Appears after multiple tool calls are recorded.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="text-[12px] font-semibold">🔀 Tool Flow &amp; Trajectories</span>
        <span className="ml-auto text-[10px] text-dim bg-elevated px-2 py-0.5 rounded-full">
          {data.transitions.length} transitions · {data.coOccurrences.length} co-occurrences
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-border-subtle">
        {/* Cell 1: Top transitions — Sankey-like flow */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Top Tool Transitions</div>
          <div className="space-y-1">
            {data.transitions.slice(0, 10).map((t, i) => {
              const maxCount = data.transitions[0]?.count ?? 1;
              const pct = (t.count / maxCount) * 100;
              return (
                <div key={i} className="flex items-center gap-2 py-1">
                  <span className="text-[11px] text-secondary w-[90px] text-right font-mono truncate" title={t.fromTool}>
                    {t.fromTool}
                  </span>
                  <span className="text-dim text-[10px]">→</span>
                  <span className="text-[11px] text-primary w-[90px] font-mono truncate" title={t.toTool}>
                    {t.toTool}
                  </span>
                  <div className="flex-1 h-2 bg-elevated rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-dim w-[30px] text-right">{t.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cell 2: Co-occurrence grid */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Top Tool Pairs</div>
          <div className="space-y-1">
            {data.coOccurrences.slice(0, 10).map((c, i) => {
              const maxCount = data.coOccurrences[0]?.sessions ?? 1;
              const pct = (c.sessions / maxCount) * 100;
              return (
                <div key={i} className="flex items-center gap-2 py-1">
                  <span className="text-[11px] text-secondary w-[55px] text-right font-mono truncate">{c.toolA}</span>
                  <span className="text-dim text-[9px]">+</span>
                  <span className="text-[11px] text-primary w-[55px] font-mono truncate">{c.toolB}</span>
                  <div className="flex-1 h-2 bg-elevated rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-dim w-[24px] text-right">{c.sessions}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cell 3: Failure trajectories */}
        <div className="p-4 col-span-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Failure Trajectories (last 3 calls before error)</div>
          {data.failureTrajectories.length > 0 ? (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {data.failureTrajectories.slice(0, 15).map((f, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 text-[11px] border-b border-border-subtle/20 last:border-0">
                  <span className="text-dim font-mono w-[40px] shrink-0 text-[10px]">{f.ts.slice(11, 16)}</span>
                  <span className="flex items-center gap-1 text-secondary min-w-0">
                    {f.previousCalls.length > 0 ? (
                      f.previousCalls.map((pc, j) => (
                        <span key={j}>
                          <span className="font-mono text-dim">{pc}</span>
                          {j < f.previousCalls.length - 1 && <span className="text-dim mx-0.5">→</span>}
                        </span>
                      ))
                    ) : (
                      <span className="text-dim italic">(first call)</span>
                    )}
                    <span className="text-danger mx-1.5 font-bold">✕</span>
                    <span className="font-mono text-danger">{f.toolName}</span>
                  </span>
                  <span className="flex-1 min-w-0 truncate text-dim ml-1" title={f.errorMessage}>
                    {f.errorMessage}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-dim py-3 text-center">No tool errors recorded yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
