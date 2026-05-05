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

  const okCalls = tool.calls - tool.errors;

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
        <Stat label="Avg Latency" value={formatDuration(tool.avgLatencyMs)} />
        <Stat label="P95 Latency" value={formatDuration(tool.p95LatencyMs)} />
        <Stat label="Max Latency" value={formatDuration(tool.maxLatencyMs)} />
      </div>
      <div className="mt-2.5 pt-2 border-t border-border-subtle/50">
        <div className="flex h-2 overflow-hidden rounded-full bg-surface">
          <div className="bg-success/70" style={{ width: `${tool.calls > 0 ? (okCalls / tool.calls) * 100 : 0}%` }} />
          {tool.errors > 0 && <div className="bg-danger" style={{ width: `${(tool.errors / tool.calls) * 100}%` }} />}
        </div>
        <div className="flex justify-between text-[9px] text-dim mt-1">
          <span>{okCalls} ok</span>
          {tool.errors > 0 && <span className="text-danger">{tool.errors} err</span>}
        </div>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function Stat({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.06em] text-dim">{label}</div>
      <div className={`text-[12px] font-mono font-medium ${cls || 'text-primary'}`}>{value}</div>
    </div>
  );
}
