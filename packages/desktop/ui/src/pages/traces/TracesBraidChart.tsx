/**
 * Braid Chart — Multi-metric time series overlay (SVG)
 */

import type { TraceTokenDaily } from '../../shared/types';

export function TracesBraidChart({ data }: { data: TraceTokenDaily[] }) {
  if (!data || data.length < 2) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <span className="text-[12px] font-semibold">🧶 Time Series — Last {data?.length ?? 0} Days</span>
          <span className="ml-auto text-[10px] text-dim">Need 2+ data points</span>
        </div>
      </div>
    );
  }

  const W = 700;
  const H = 110;
  const pad = { top: 8, bottom: 20, left: 0, right: 0 };
  const chartH = H - pad.top - pad.bottom;

  // Build series
  const inputSeries = data.map((d) => d.tokensInput);
  const outputSeries = data.map((d) => d.tokensOutput);
  const costSeries = data.map((d) => d.cost);
  const errorSeries = data.map((d) => d.toolErrors);
  const hasErrors = errorSeries.some((v) => v > 0);

  const maxVal = Math.max(...inputSeries, ...outputSeries, 1);
  const maxCost = Math.max(...costSeries, 0.01);
  const maxErr = Math.max(...errorSeries, 1);

  const xStep = W / Math.max(data.length - 1, 1);

  const line = (series: number[], scale: (v: number) => number) =>
    series.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * xStep},${pad.top + chartH - scale(v)}`).join(' ');

  const scaleTokens = (v: number) => (v / maxVal) * chartH * 0.5;
  const scaleCost = (v: number) => (v / maxCost) * chartH * 0.35;
  const scaleErr = (v: number) => (v / maxErr) * chartH * 0.15;

  const inputPath = line(inputSeries, scaleTokens);
  const outputPath = line(outputSeries, scaleTokens);
  const costPath = line(costSeries, scaleCost);
  const errPath = line(errorSeries, scaleErr);

  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="text-[12px] font-semibold">🧶 Time Series — Last {data.length} Days</span>
        <span className="ml-auto text-[10px] text-dim">{hasErrors ? '4' : '3'} metrics overlaid</span>
      </div>
      <div className="p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[100px]" preserveAspectRatio="none">
          {/* Grid */}
          {[0.25, 0.5, 0.75].map((r) => (
            <line
              key={r}
              x1="0"
              y1={pad.top + chartH * (1 - r)}
              x2={W}
              y2={pad.top + chartH * (1 - r)}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="0.5"
            />
          ))}
          {/* Input tokens */}
          <path d={inputPath} fill="none" stroke="#6c8aff" strokeWidth="1.5" opacity="0.7" />
          {/* Output tokens */}
          <path d={outputPath} fill="none" stroke="#4cd964" strokeWidth="1.5" opacity="0.7" />
          {/* Cost */}
          <path d={costPath} fill="none" stroke="#ff9f0a" strokeWidth="1.5" opacity="0.7" />
          {/* Tool errors (only rendered when non-zero data exists) */}
          {hasErrors && <path d={errPath} fill="none" stroke="#ff4757" strokeWidth="1.5" opacity="0.7" />}
          {/* X labels: first, middle, last */}
          <text x="0" y={H - 4} fill="var(--dim)" fontSize="7">
            {data[0]?.date?.slice(5) ?? ''}
          </text>
          <text x={W / 2} y={H - 4} fill="var(--dim)" fontSize="7" textAnchor="middle">
            {data[Math.floor(data.length / 2)]?.date?.slice(5) ?? ''}
          </text>
          <text x={W} y={H - 4} fill="var(--dim)" fontSize="7" textAnchor="end">
            {data[data.length - 1]?.date?.slice(5) ?? ''}
          </text>
        </svg>
        <div className="flex gap-3 text-[10px] text-dim mt-1">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded bg-[#6c8aff]" /> Input
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded bg-[#4cd964]" /> Output
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded bg-[#ff9f0a]" /> Cost
          </span>
          {hasErrors && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 rounded bg-[#ff4757]" /> Errors
            </span>
          )}
          <span className="ml-auto">Peak: {formatNumber(maxVal)} tokens</span>
        </div>
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
