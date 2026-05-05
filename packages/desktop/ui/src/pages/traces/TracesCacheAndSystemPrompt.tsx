/**
 * Cache Efficiency & System Prompt display
 */

import type { CacheEfficiencyAggregate, SystemPromptAggregate } from '../../shared/types';

export function TracesCacheAndSystemPrompt({
  cacheEfficiency,
  systemPrompt,
}: {
  cacheEfficiency: CacheEfficiencyAggregate | null;
  systemPrompt: SystemPromptAggregate | null;
}) {
  if (!cacheEfficiency && !systemPrompt) return null;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="text-[12px] font-semibold">💾 Cache Efficiency &amp; System Prompt</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border-subtle">
        {/* Cache */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Prompt Cache</div>
          {cacheEfficiency && (
            <>
              <div className="flex gap-2 mb-3">
                <QuickStat
                  value={`${cacheEfficiency.overallHitRate}%`}
                  label="Overall Hit Rate"
                  cls={cacheEfficiency.overallHitRate > 30 ? 'text-success' : 'text-warning'}
                />
                <QuickStat value={fmt(cacheEfficiency.totalCached)} label="Cache Read" />
                <QuickStat value={fmt(cacheEfficiency.totalCachedWrite)} label="Cache Write" />
                <QuickStat value={fmt(cacheEfficiency.totalInput)} label="Total Input" />
              </div>
              {cacheEfficiency.byModel.map((m) => {
                const barCls = m.hitRate > 30 ? 'bg-success' : m.hitRate > 10 ? 'bg-warning' : 'bg-danger';
                return (
                  <div key={m.modelId} className="flex items-center gap-2 py-1">
                    <span className="text-[11px] text-secondary w-[100px]">{m.modelId}</span>
                    <div className="flex-1 h-1.5 bg-elevated rounded overflow-hidden">
                      <div className={`h-full rounded ${barCls}`} style={{ width: `${Math.max(m.hitRate, 2)}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-dim w-[50px] text-right">{m.hitRate}%</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
        {/* System Prompt */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">System Prompt</div>
          {systemPrompt && (
            <>
              <div className="flex gap-2 mb-3">
                <QuickStat value={fmt(systemPrompt.avgSystemPromptTokens)} label="Avg Size" />
                <QuickStat value={`${systemPrompt.avgPctOfTotal}%`} label="Avg % of Context" />
                <QuickStat value={fmt(systemPrompt.maxSystemPromptTokens)} label="Max Size" />
              </div>
              <div className="text-[11px] text-dim pt-2 border-t border-border-subtle">
                Sampled from {systemPrompt.samples} context snapshot{systemPrompt.samples !== 1 ? 's' : ''}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickStat({ value, label, cls = '' }: { value: string; label: string; cls?: string }) {
  return (
    <div className="flex-1 bg-elevated rounded-lg p-2.5 text-center">
      <div className={`text-[17px] font-semibold font-mono ${cls}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-[0.08em] text-dim">{label}</div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
