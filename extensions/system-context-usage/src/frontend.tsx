import type { ExtensionStatusBarItemProps } from '@personal-agent/extensions';
import React from 'react';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function formatContextWindowLabel(contextWindow: number): string {
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
    return 'unknown';
  }

  if (contextWindow >= 1_000_000) {
    const millions = contextWindow / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
  }

  if (contextWindow >= 1_000) {
    const thousands = contextWindow / 1_000;
    return Number.isInteger(thousands) ? `${thousands}k` : `${thousands.toFixed(1)}k`;
  }

  return String(contextWindow);
}

function getContextUsagePercent(tokens: number | null, contextWindow: number): number | null {
  if (tokens === null || !Number.isSafeInteger(tokens) || tokens < 0 || !Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
    return null;
  }

  return (tokens / contextWindow) * 100;
}

function formatContextUsageLabel(tokens: number | null, contextWindow: number): string {
  const pct = getContextUsagePercent(tokens, contextWindow);
  if (pct === null) {
    return `? of ${formatContextWindowLabel(contextWindow)} ctx`;
  }
  return `${pct.toFixed(1)}% of ${formatContextWindowLabel(contextWindow)} ctx`;
}

export function ContextUsageIndicator({ statusBarContext }: ExtensionStatusBarItemProps) {
  const tokens = statusBarContext.contextUsage;
  if (!tokens) {
    return null;
  }

  const label = formatContextUsageLabel(tokens.total, tokens.contextWindow);
  const percent = getContextUsagePercent(tokens.total, tokens.contextWindow);
  const boundedPercent = Math.max(0, Math.min(100, percent ?? 0));
  const toneClass = percent === null ? 'bg-dim/70' : percent >= 90 ? 'bg-danger' : percent >= 70 ? 'bg-warning' : 'bg-accent';
  const ringColor =
    percent === null
      ? 'rgba(151, 164, 203, 0.5)'
      : percent >= 90
        ? 'rgba(248, 113, 113, 0.95)'
        : percent >= 70
          ? 'rgba(251, 191, 36, 0.95)'
          : 'rgba(139, 167, 255, 0.95)';

  return (
    <span className="group relative inline-flex shrink-0 items-center" role="img" title={label} aria-label={`Context usage: ${label}`}>
      <span
        className="grid h-3.5 w-3.5 place-items-center rounded-full border border-border-subtle/70 shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
        style={{ background: `conic-gradient(${ringColor} ${boundedPercent}%, rgba(151, 164, 203, 0.22) 0)` }}
        aria-hidden="true"
      >
        <span className="grid h-2 w-2 place-items-center rounded-full bg-base">
          <span className={cx('h-1 w-1 rounded-full', toneClass)} />
        </span>
      </span>
      <span className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 whitespace-nowrap rounded-md border border-border-subtle bg-elevated px-2 py-1 font-mono text-[10px] text-primary opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {label}
      </span>
    </span>
  );
}
