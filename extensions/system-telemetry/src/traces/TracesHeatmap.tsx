/**
 * Token Activity Heatmap — GitHub-style contribution grid
 */

import type { TraceTokenDaily } from '@personal-agent/extensions/data';

export function TracesHeatmap({ data }: { data: TraceTokenDaily[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <span className="text-[12px] font-semibold">🔥 Token Activity — Last 12 Weeks</span>
          <span className="ml-auto text-[10px] text-dim">No data yet</span>
        </div>
        <div className="p-6 text-center text-[12px] text-dim">Data accumulates after sessions produce tokens.</div>
      </div>
    );
  }

  const values = data.map(tokenTotal);
  const max = Math.max(...values, 1);

  // Bucket into weeks (groups of 7)
  const weeks: TraceTokenDaily[][] = [];
  for (let i = 0; i < data.length; i += 7) {
    weeks.push(data.slice(i, i + 7));
  }

  const level = (v: number) => {
    if (v === 0) return 0;
    const ratio = v / max;
    if (ratio < 0.25) return 1;
    if (ratio < 0.5) return 2;
    if (ratio < 0.75) return 3;
    return 4;
  };

  const cellColors = ['bg-elevated', 'bg-accent/25', 'bg-accent/45', 'bg-accent/65', 'bg-accent'];

  const total = values.reduce((a, b) => a + b, 0);
  const avg = total / Math.max(values.length, 1);

  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="text-[12px] font-semibold">🔥 Token Activity — Last {data.length} Days</span>
        <span className="ml-auto text-[10px] text-dim bg-elevated px-2 py-0.5 rounded-full">
          {formatNumber(total)} total · {formatNumber(avg)} avg/day
        </span>
      </div>
      <div className="p-4 overflow-x-auto">
        <div className="flex gap-0.5 min-w-[500px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {week.map((day, di) => {
                const v = tokenTotal(day);
                const lvl = level(v);
                return (
                  <div
                    key={di}
                    className={`w-3 h-3 rounded-sm ${cellColors[lvl]}`}
                    title={`${day.date}: ${formatNumber(v)} tokens (in: ${formatNumber(day.tokensInput)}, cache read: ${formatNumber(day.tokensCached)}, cache write: ${formatNumber(day.tokensCachedWrite)}, out: ${formatNumber(day.tokensOutput)})`}
                  />
                );
              })}
              {/* Pad incomplete weeks */}
              {week.length < 7 && Array.from({ length: 7 - week.length }).map((_, i) => <div key={`pad-${i}`} className="w-3 h-3" />)}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 text-[10px] text-dim">
          <span>Less</span>
          {cellColors.map((c, i) => (
            <div key={i} className={`w-2.5 h-2.5 rounded-sm ${c}`} />
          ))}
          <span>More</span>
          <span className="ml-4 text-warning">● Peak: {formatNumber(max)} tokens</span>
          <span className="ml-auto">
            In:{' '}
            <span className="text-accent">
              {pct(
                data.reduce((a, d) => a + d.tokensInput, 0),
                total,
              )}
            </span>
          </span>
          <span>
            Cache Read:{' '}
            <span className="text-warning">
              {pct(
                data.reduce((a, d) => a + d.tokensCached, 0),
                total,
              )}
            </span>
          </span>
          <span>
            Cache Write:{' '}
            <span className="text-warning">
              {pct(
                data.reduce((a, d) => a + d.tokensCachedWrite, 0),
                total,
              )}
            </span>
          </span>
          <span>
            Out:{' '}
            <span className="text-success">
              {pct(
                data.reduce((a, d) => a + d.tokensOutput, 0),
                total,
              )}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

// Heatmap intensity is based on actual work done (fresh input + output),
// not cache tokens which inflate heavily in long-running sessions.
function tokenTotal(day: TraceTokenDaily): number {
  return day.tokensInput + day.tokensOutput;
}

function pct(value: number, total: number): string {
  return total > 0 ? `${((value / total) * 100).toFixed(0)}%` : '0%';
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
