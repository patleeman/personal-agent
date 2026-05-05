/**
 * Tool Telemetry — Per-tool cards with sparklines
 */

import type { TraceToolHealth } from '../../shared/types';

export function TracesToolHealth({ tools }: { tools: TraceToolHealth[] }) {
  if (!tools || tools.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <span className="text-[12px] font-semibold">🔧 Tool Telemetry</span>
          <span className="ml-auto text-[10px] text-dim">No tool data yet</span>
        </div>
        <div className="p-6 text-center text-[12px] text-dim">Tool calls will appear here as agents execute tools.</div>
      </div>
    );
  }

  const totalCalls = tools.reduce((a, t) => a + t.calls, 0);
  const totalErrors = tools.reduce((a, t) => a + t.errors, 0);

  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="text-[12px] font-semibold">🔧 Tool Telemetry</span>
        <span className="ml-auto text-[10px] text-dim bg-elevated px-2 py-0.5 rounded-full">
          {totalCalls} calls · {totalErrors} errors ({((totalErrors / Math.max(totalCalls, 1)) * 100).toFixed(1)}%)
        </span>
      </div>
      <div className="p-4 grid grid-cols-2 gap-2.5">
        {tools.map((tool) => (
          <ToolCard key={tool.toolName} tool={tool} />
        ))}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: TraceToolHealth }) {
  const successRate = tool.calls > 0 ? ((tool.calls - tool.errors) / tool.calls) * 100 : 100;
  const hasTrouble = tool.errors > 0 && successRate < 95;
  const dotClass = tool.errors === 0 ? 'bg-success' : hasTrouble ? 'bg-danger' : 'bg-warning';

  // Generate mock sparkline data from tool stats (proportional to call count)
  const sparkBars = Array.from({ length: 10 }, (_, i) => {
    const base = tool.calls / 10;
    const noise = Math.sin(i * 1.5) * base * 0.3;
    const errBars = tool.errors > 0 && i % 3 === 1 ? Math.min(tool.errors / 3, base * 0.5) : 0;
    return { ok: Math.max(0, base + noise - errBars), err: errBars };
  });
  const maxSpark = Math.max(...sparkBars.map((b) => b.ok + b.err), 1);

  return (
    <div className={`rounded-lg p-3 border ${hasTrouble ? 'border-danger/20 bg-danger/[0.03]' : 'border-transparent bg-elevated'}`}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <span className="text-[13px] font-semibold">{tool.toolName}</span>
        <span className="ml-auto text-[10px] text-dim bg-surface px-1.5 py-0.5 rounded-full">{tool.calls} calls</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Stat
          label="Success"
          value={`${successRate.toFixed(1)}%`}
          cls={tool.errors === 0 ? 'text-success' : hasTrouble ? 'text-danger' : 'text-warning'}
        />
        <Stat label="Avg Latency" value={`${tool.avgLatencyMs.toFixed(1)}s`} />
        <Stat label="P95 Latency" value={`${tool.p95LatencyMs.toFixed(1)}s`} />
        <Stat label="Max Latency" value={`${tool.maxLatencyMs.toFixed(1)}s`} />
      </div>
      <div className="mt-2.5 pt-2 border-t border-border-subtle/50">
        <div className="flex items-end gap-0.5 h-6">
          {sparkBars.map((b, i) => (
            <div key={i} className="flex-1 flex flex-col justify-end" style={{ height: '100%' }}>
              {b.err > 0 && <div className="w-full bg-danger rounded-t" style={{ height: `${(b.err / maxSpark) * 100}%` }} />}
              <div className="w-full bg-success/60 rounded-t" style={{ height: `${(b.ok / maxSpark) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[9px] text-dim mt-1">
          <span>{tool.calls - tool.errors} ok</span>
          {tool.errors > 0 && <span className="text-danger">{tool.errors} err</span>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.06em] text-dim">{label}</div>
      <div className={`text-[12px] font-mono font-medium ${cls || 'text-primary'}`}>{value}</div>
    </div>
  );
}
