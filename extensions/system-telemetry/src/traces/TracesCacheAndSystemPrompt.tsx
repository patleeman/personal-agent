/**
 * Cache Efficiency & System Prompt display
 */

import type { CacheEfficiencyAggregate, SystemPromptAggregate } from '@personal-agent/extensions/data';

export function TracesCacheAndSystemPrompt({
  cacheEfficiency,
  systemPrompt,
}: {
  cacheEfficiency: CacheEfficiencyAggregate | null;
  systemPrompt: SystemPromptAggregate | null;
}) {
  if (!cacheEfficiency && !systemPrompt) return null;

  return (
    <div className="rounded-2xl bg-surface/35">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <span className="text-[12px] font-semibold">💾 Cache Efficiency &amp; System Prompt</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {/* Cache */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Prompt Cache</div>
          {cacheEfficiency && (
            <>
              <div className="flex gap-2 mb-3">
                <QuickStat
                  value={`${cacheEfficiency.requestCacheHitRate}%`}
                  label="Request Hit Rate"
                  cls={cacheEfficiency.requestCacheHitRate > 50 ? 'text-success' : 'text-warning'}
                />
                <QuickStat
                  value={`${cacheEfficiency.overallHitRate}%`}
                  label="Cached Share"
                  cls={cacheEfficiency.overallHitRate > 30 ? 'text-success' : 'text-warning'}
                />
                <QuickStat value={fmt(cacheEfficiency.totalCached)} label="Cache Read" />
                <QuickStat value={`${cacheEfficiency.cachedRequests}/${cacheEfficiency.requests}`} label="Cached Requests" />
              </div>
              {cacheEfficiency.byModel.map((m) => {
                const barCls = m.requestCacheHitRate > 50 ? 'bg-success' : m.requestCacheHitRate > 10 ? 'bg-warning' : 'bg-danger';
                return (
                  <div key={m.modelId} className="flex items-center gap-2 py-1">
                    <span className="text-[11px] text-secondary w-[100px]">{m.modelId}</span>
                    <div className="flex-1 h-1.5 bg-elevated rounded overflow-hidden">
                      <div className={`h-full rounded ${barCls}`} style={{ width: `${Math.max(m.requestCacheHitRate, 2)}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-dim w-[120px] text-right">
                      {m.requestCacheHitRate}% req · {m.hitRate}% tok
                    </span>
                  </div>
                );
              })}
              <div className="text-[11px] text-dim pt-2 mt-2">
                Request hit rate counts requests with any cache read. Cached share is provider-reported cached token volume.
              </div>
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
                <QuickStat value={`${systemPrompt.avgPctOfContextWindow}%`} label="Avg % Window" />
                <QuickStat value={fmt(systemPrompt.maxSystemPromptTokens)} label="Max Size" />
              </div>
              {systemPrompt.byModel.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {systemPrompt.byModel.map((m) => (
                    <div key={m.modelId} className="grid grid-cols-[minmax(0,1fr)_64px_56px_54px] items-center gap-2 text-[11px]">
                      <span className="text-secondary truncate" title={m.modelId}>
                        {m.modelId}
                      </span>
                      <span className="font-mono text-primary text-right">{fmt(m.avgSystemPromptTokens)}</span>
                      <span className="font-mono text-dim text-right">{m.avgPctOfContextWindow}%</span>
                      <span className="font-mono text-dim text-right">/{fmt(m.contextWindow)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[11px] text-dim pt-2">
                Sampled from {systemPrompt.samples} session{systemPrompt.samples !== 1 ? 's' : ''}
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
