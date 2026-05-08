/**
 * Context Pressure — Session gauges, compaction log, and session timeline braid
 */

import type { TraceCompactionAggs, TraceCompactionEvent, TraceContextSession } from '@personal-agent/extensions/data';

export function TracesContextPressure({
  sessions,
  compactions,
  compactionAggs,
}: {
  sessions: TraceContextSession[];
  compactions: TraceCompactionEvent[];
  compactionAggs: TraceCompactionAggs | null;
}) {
  if ((!sessions || sessions.length === 0) && (!compactions || compactions.length === 0)) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <span className="text-[12px] font-semibold">🧠 Context Pressure</span>
          <span className="ml-auto text-[10px] text-dim">Waiting for data</span>
        </div>
        <div className="p-6 text-center text-[12px] text-dim">Context snapshots appear after agent turns complete.</div>
      </div>
    );
  }

  const highCount = sessions.filter((s) => s.pct > 90).length;
  const medCount = sessions.filter((s) => s.pct > 70 && s.pct <= 90).length;
  const lowCount = sessions.filter((s) => s.pct <= 70).length;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="text-[12px] font-semibold">🧠 Context Pressure &amp; Session Activity</span>
        <span className="ml-auto text-[10px] text-dim bg-elevated px-2 py-0.5 rounded-full">
          {sessions.length} sessions · {highCount + medCount} above 70%
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-border-subtle">
        {/* Cell 1: Session gauges */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Context Fill by Session</div>
          <div className="flex gap-2 mb-3">
            <AggBadge value={sessions.length} label="Active" cls="text-accent" />
            <AggBadge value={lowCount} label="Under 70%" cls="text-success" />
            <AggBadge value={medCount} label="70–90%" cls="text-warning" />
            <AggBadge value={highCount} label="Over 90%" cls="text-danger" />
          </div>
          {sessions.length > 0 ? (
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {sessions.slice(0, 8).map((s) => (
                <SessionGaugeRow key={s.sessionId} session={s} />
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-dim py-4 text-center">No context snapshots yet</div>
          )}
          <div className="flex gap-2 flex-wrap mt-2 pt-2 border-t border-border-subtle">
            <Legend color="bg-[#6c8aff]" label="System" />
            <Legend color="bg-[#4cd964]" label="User" />
            <Legend color="bg-[#ff9f0a]" label="Assistant" />
            <Legend color="bg-[#ff4757]" label="Tool" />
            <Legend color="bg-[#8e8ea0]" label="Summary" />
          </div>
        </div>

        {/* Cell 2: Session timeline braid + compaction */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Session Activity</div>
          <div className="space-y-1.5 mb-4">
            {sessions.slice(0, 5).map((s) => (
              <div key={s.sessionId} className="flex items-center gap-2">
                <span className="w-[100px] text-[11px] text-secondary truncate shrink-0">
                  {s.sessionId.length > 12 ? s.sessionId.slice(0, 12) + '…' : s.sessionId}
                </span>
                <div className="flex-1 h-2 bg-elevated rounded-full overflow-hidden flex">
                  <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${Math.max(s.pct, 2)}%` }} />
                  <div className="h-full bg-elevated-hover flex-1" />
                </div>
                <span
                  className={`text-[10px] font-mono w-[30px] text-right ${
                    s.pct > 90 ? 'text-danger' : s.pct > 70 ? 'text-warning' : 'text-success'
                  }`}
                >
                  {Math.round(s.pct)}%
                </span>
              </div>
            ))}
          </div>

          {/* Compaction log */}
          {compactions && compactions.length > 0 && (
            <div className="pt-3 border-t border-border-subtle">
              <div className="text-[11px] font-medium mb-2 flex items-center gap-2">
                Compactions Today
                <span className="text-[10px] text-dim font-normal">
                  · {compactionAggs?.autoCount ?? 0} auto · {compactionAggs?.manualCount ?? 0} manual
                </span>
                {compactionAggs && (
                  <span className="ml-auto text-[10px] font-mono text-success">−{formatNumber(compactionAggs.totalTokensSaved)} tok</span>
                )}
              </div>
              <div className="max-h-[150px] overflow-y-auto space-y-0.5">
                {compactions.slice(0, 10).map((c) => (
                  <div
                    key={c.ts + c.sessionId}
                    className="flex items-center gap-2 py-1 text-[11px] text-secondary border-b border-border-subtle/30 border-0"
                  >
                    <span className="font-mono text-[10px] text-dim w-[45px] shrink-0">{c.ts.slice(11, 16)}</span>
                    <span className="flex-1 truncate">{c.sessionId.length > 15 ? c.sessionId.slice(0, 15) + '…' : c.sessionId}</span>
                    <span className="text-[10px] text-dim">{c.reason}</span>
                    <span className="font-mono text-[10px] text-success shrink-0">−{formatNumber(c.tokensSaved)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionGaugeRow({ session }: { session: TraceContextSession }) {
  const total = session.segSystem + session.segUser + session.segAssistant + session.segTool + session.segSummary || 1;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-[110px] text-[11px] text-secondary truncate shrink-0" title={session.sessionId}>
        {session.sessionId.length > 14 ? session.sessionId.slice(0, 14) + '…' : session.sessionId}
      </span>
      <div className="flex-1 h-3 bg-elevated rounded-sm overflow-hidden flex">
        <div className="bg-[#6c8aff]" style={{ width: `${(session.segSystem / total) * 100}%` }} />
        <div className="bg-[#4cd964]" style={{ width: `${(session.segUser / total) * 100}%` }} />
        <div className="bg-[#ff9f0a]" style={{ width: `${(session.segAssistant / total) * 100}%` }} />
        <div className="bg-[#ff4757]" style={{ width: `${(session.segTool / total) * 100}%` }} />
        <div className="bg-[#8e8ea0]" style={{ width: `${(session.segSummary / total) * 100}%` }} />
      </div>
      <span
        className={`text-[10px] font-mono w-[35px] text-right ${
          session.pct > 90 ? 'text-danger' : session.pct > 70 ? 'text-warning' : 'text-success'
        }`}
      >
        {Math.round(session.pct)}%
      </span>
    </div>
  );
}

function AggBadge({ value, label, cls }: { value: number; label: string; cls: string }) {
  return (
    <div className="flex-1 bg-elevated rounded-lg p-2 text-center">
      <div className={`text-[15px] font-semibold font-mono ${cls}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-[0.08em] text-dim">{label}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[9px] text-dim">
      <span className={`w-2 h-2 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
