/**
 * Model Usage & Cost — 2×2 grid section
 */

import type { TraceModelUsage, TraceThroughput } from '../../shared/types';

export function TracesModelUsage({
  models,
  throughput,
  totalTokens,
  tokensInput,
  tokensOutput,
  tokensCached,
  cacheHitRate,
}: {
  models: TraceModelUsage[];
  throughput: TraceThroughput[];
  totalTokens: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  cacheHitRate: number;
}) {
  const maxTokens = Math.max(...models.map((m) => m.tokens), 1);

  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="text-[12px] font-semibold">📊 Model Usage &amp; Cost</span>
        <span className="ml-auto text-[10px] text-dim bg-elevated px-2 py-0.5 rounded-full">Last 24h</span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-border-subtle">
        {/* Cell 1: Tokens by model */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Tokens by Model</div>
          <div className="flex gap-4 flex-wrap pb-3 mb-3 border-b border-border-subtle">
            <Metric value={formatNumber(totalTokens)} label="Total" cls="text-accent" />
            <Metric value={formatNumber(tokensInput)} label="Input" />
            <Metric value={formatNumber(tokensOutput)} label="Output" />
            <Metric value={formatNumber(tokensCached)} label="Cached In" cls="text-success" />
            <Metric value={`${cacheHitRate}%`} label="Cache Hit" cls="text-warning" />
          </div>
          {models.map((m) => (
            <BarRow
              key={m.modelId}
              label={<span className="model-tag">{m.modelId}</span>}
              value={formatNumber(m.tokens)}
              pct={m.tokens / maxTokens}
              color="bg-accent"
            />
          ))}
        </div>

        {/* Cell 2: Cost treemap */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Cost Breakdown</div>
          <div className="flex flex-wrap gap-1 mb-3">
            {models.slice(0, 4).map((m, i) => {
              const colors = [
                'from-[#6c8aff] to-[#4a6ae0]',
                'from-[#ff9f0a] to-[#e08500]',
                'from-[#4cd964] to-[#2db84d]',
                'from-[#6c8aff] to-[#4a6ae0]',
              ];
              const sizes = [2, 1, 0.8, 0.5];
              return (
                <div
                  key={m.modelId}
                  className={`flex-${sizes[i] || 1} bg-gradient-to-br ${colors[i % colors.length]} rounded-lg p-2.5 min-h-[50px] flex flex-col justify-end`}
                  style={{ flex: sizes[i] || 1 }}
                >
                  <div className="text-[11px] font-semibold text-white/90">{m.modelId}</div>
                  <div className="text-[10px] font-mono text-white/70">${m.cost.toFixed(2)}</div>
                  <div className="text-[9px] text-white/50">{formatNumber(m.tokens)} tok</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cell 3: Throughput */}
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-3">Throughput</div>
          <div className="flex gap-2 mb-3">
            <QuickStat value={`${throughput[0]?.avgTokensPerSec ?? 0}`} label="tok/s avg" cls="text-accent" />
            <QuickStat value={`${Math.max(...throughput.map((t) => t.avgTokensPerSec), 0)}`} label="tok/s peak" cls="text-warning" />
          </div>
          {throughput.length > 0 ? (
            throughput.map((t) => (
              <BarRow
                key={t.modelId}
                label={<span className="model-tag">{t.modelId}</span>}
                value={`${t.avgTokensPerSec} tok/s`}
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
          <CacheRow label="Hit rate" value={`${cacheHitRate}%`} pct={cacheHitRate / 100} color="bg-success" />
          <CacheRow
            label="Cacheable in"
            value={formatNumber(tokensInput + tokensCached)}
            pct={Math.min((tokensInput + tokensCached) / Math.max(totalTokens, 1), 1)}
            color="bg-success"
          />
          <div className="mt-2 pt-2 border-t border-border-subtle text-[11px] text-dim">
            {cacheHitRate > 0 ? <span className="text-warning">▲ +{cacheHitRate}%</span> : null} cache hit rate
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

function BarRow({ label, value, pct, color }: { label: React.ReactNode; value: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <div className="w-[100px] shrink-0 text-[12px] text-secondary">{label}</div>
      <div className="flex-1 h-1.5 bg-elevated rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${Math.max(pct * 100, 2)}%` }} />
      </div>
      <div className="w-[70px] text-right font-mono text-[11px] text-secondary shrink-0">{value}</div>
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
