/**
 * Model Usage & Cost — 2×2 grid section
 */

import type { CacheEfficiencyAggregate, TraceModelUsage, TraceThroughput } from '@personal-agent/extensions/data';

export function TracesModelUsage({
  models,
  throughput,
  totalTokens,
  tokensInput,
  tokensOutput,
  tokensCached,
  tokensCachedWrite,
  cacheHitRate,
  cacheEfficiency,
}: {
  models: TraceModelUsage[];
  throughput: TraceThroughput[];
  totalTokens: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  tokensCachedWrite: number;
  cacheHitRate: number;
  cacheEfficiency?: CacheEfficiencyAggregate | null;
}) {
  const maxTokens = Math.max(...models.map((m) => m.tokens), 1);
  const cacheByModel = Object.fromEntries((cacheEfficiency?.byModel ?? []).map((m) => [m.modelId, m.hitRate]));
  const totalThroughputOutputTokens = throughput.reduce((sum, t) => sum + t.tokensOutput, 0);
  const totalThroughputDurationMs = throughput.reduce((sum, t) => sum + t.durationMs, 0);
  const totalThroughputTokensPerSec =
    totalThroughputDurationMs > 0 ? Math.round(totalThroughputOutputTokens / (totalThroughputDurationMs / 1000)) : 0;
  const peakThroughputTokensPerSec = Math.max(...throughput.map((t) => t.peakTokensPerSec), 0);

  return (
    <div className="rounded-2xl bg-surface/35">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <span className="text-[12px] font-semibold">📊 Model Usage &amp; Cost</span>
        <span className="ml-auto text-[10px] text-dim">Last 24h</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Cell 1: Tokens by model */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Tokens by Model</div>
          <div className="flex gap-4 flex-wrap pb-3 mb-3">
            <Metric value={formatNumber(totalTokens)} label="Total" cls="text-accent" />
            <Metric value={formatNumber(tokensInput)} label="Input" />
            <Metric value={formatNumber(tokensOutput)} label="Output" />
            <Metric value={formatNumber(tokensCached)} label="Cache Read" cls="text-success" />
            <Metric value={formatNumber(tokensCachedWrite)} label="Cache Write" cls="text-warning" />
            <Metric value={`${cacheHitRate}%`} label="Cached Share" cls="text-accent" />
          </div>
          {models.map((m) => {
            const hitRate = cacheByModel[m.modelId];
            return (
              <BarRow
                key={m.modelId}
                label={<span className="model-tag">{m.modelId}</span>}
                value={formatNumber(m.tokens)}
                pct={m.tokens / maxTokens}
                color="bg-accent"
                badge={hitRate != null ? `${hitRate}% cache` : undefined}
                badgeCls={hitRate != null ? (hitRate > 30 ? 'text-success' : hitRate > 10 ? 'text-warning' : 'text-danger') : undefined}
              />
            );
          })}
        </div>

        {/* Cell 2: Cost treemap */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Cost Breakdown</div>
          <div className="flex flex-wrap gap-1 mb-3">
            {(() => {
              const top = models.slice(0, 4);
              const totalCost = top.reduce((s, m) => s + m.cost, 0);
              const colors = [
                'from-[#6c8aff] to-[#4a6ae0]',
                'from-[#ff9f0a] to-[#e08500]',
                'from-[#4cd964] to-[#2db84d]',
                'from-[#ff6b6b] to-[#e04a4a]',
              ];
              return top.map((m, i) => {
                const flexSize = totalCost > 0 ? Math.max((m.cost / totalCost) * 4, 0.3) : 1;
                return (
                  <div
                    key={m.modelId}
                    className={`bg-gradient-to-br ${colors[i % colors.length]} rounded-lg p-2.5 min-h-[50px] flex flex-col justify-end`}
                    style={{ flex: flexSize }}
                  >
                    <div className="text-[11px] font-semibold text-white/90">{m.modelId}</div>
                    <div className="text-[10px] font-mono text-white/70">${m.cost.toFixed(2)}</div>
                    <div className="text-[9px] text-white/50">{formatNumber(m.tokens)} tok</div>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* Cell 3: Throughput */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Throughput</div>
          <div className="flex gap-2 mb-3">
            <QuickStat value={`${totalThroughputTokensPerSec}`} label="tok/s avg" cls="text-accent" />
            <QuickStat value={`${peakThroughputTokensPerSec}`} label="tok/s peak" cls="text-warning" />
          </div>
          {throughput.length > 0 ? (
            throughput.map((t) => (
              <BarRow
                key={t.modelId}
                label={<span className="model-tag">{t.modelId}</span>}
                value={`${t.avgTokensPerSec} tok/s avg · ${t.peakTokensPerSec} peak`}
                pct={t.avgTokensPerSec / Math.max(...throughput.map((x) => x.avgTokensPerSec), 1)}
                color="bg-accent"
              />
            ))
          ) : (
            <div className="text-[12px] text-dim py-4 text-center">No throughput data yet</div>
          )}
        </div>

        {/* Cell 4: Cache stats */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Prompt Cache</div>
          <CacheRow
            label="Cached input"
            value={formatNumber(tokensCached)}
            pct={Math.min(tokensCached / Math.max(tokensInput + tokensCached, 1), 1)}
            color="bg-steel/50"
          />
          <CacheRow label="Cached share" value={`${cacheHitRate}%`} pct={cacheHitRate / 100} color="bg-success" />
          <CacheRow
            label="Total prompt in"
            value={formatNumber(tokensInput + tokensCached)}
            pct={Math.min((tokensInput + tokensCached) / Math.max(totalTokens, 1), 1)}
            color="bg-success"
          />
          <div className="mt-2 pt-2 text-[11px] text-dim">
            {cacheHitRate > 0 ? <span className="text-warning">{cacheHitRate}%</span> : null} of prompt input read from cache
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ value, label, cls = '' }: { value: string; label: string; cls?: string }) {
  return (
    <div className="text-center">
      <div className={`text-[18px] font-semibold font-mono tracking-tight ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-dim">{label}</div>
    </div>
  );
}

function QuickStat({ value, label, cls = '' }: { value: string; label: string; cls?: string }) {
  return (
    <div className="flex-1 bg-elevated rounded-lg p-2.5 text-center">
      <div className={`text-[17px] font-semibold font-mono ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-dim">{label}</div>
    </div>
  );
}

function BarRow({
  label,
  value,
  pct,
  color,
  badge,
  badgeCls,
}: {
  label: React.ReactNode;
  value: string;
  pct: number;
  color: string;
  badge?: string;
  badgeCls?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <div className="w-[100px] shrink-0 text-[12px] text-secondary">{label}</div>
      <div className="flex-1 h-1.5 bg-elevated rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${Math.max(pct * 100, 2)}%` }} />
      </div>
      <div className="w-[70px] text-right font-mono text-[11px] text-secondary shrink-0">{value}</div>
      {badge != null && <div className={`w-[80px] text-right font-mono text-[10px] shrink-0 ${badgeCls ?? 'text-dim'}`}>{badge}</div>}
    </div>
  );
}

function CacheRow({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-[90px] shrink-0 text-[12px] text-secondary">{label}</div>
      <div className="flex-1 h-5 bg-elevated rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${Math.max(pct * 100, 2)}%` }} />
      </div>
      <div className="w-[80px] text-right font-mono text-[11px] text-secondary shrink-0">{value}</div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
