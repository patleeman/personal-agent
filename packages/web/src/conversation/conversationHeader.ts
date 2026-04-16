export function formatThinkingLevelLabel(level?: string): string {
  const normalized = level?.trim();
  return normalized && normalized.length > 0 ? normalized : 'default';
}

export function formatServiceTierLabel(tier?: string): string {
  const normalized = tier?.trim().toLowerCase();
  switch (normalized) {
    case 'auto':
      return 'auto';
    case 'default':
      return 'default';
    case 'flex':
      return 'flex';
    case 'priority':
      return 'priority';
    case 'scale':
      return 'scale';
    default:
      return 'auto';
  }
}

export function formatContextWindowLabel(contextWindow: number): string {
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
  if (tokens === null || contextWindow <= 0) {
    return null;
  }

  return (tokens / contextWindow) * 100;
}

export function formatContextUsageLabel(tokens: number | null, contextWindow: number): string {
  if (tokens === null) {
    return `? of ${formatContextWindowLabel(contextWindow)} ctx`;
  }

  const pct = getContextUsagePercent(tokens, contextWindow) ?? 0;
  return `${pct.toFixed(1)}% of ${formatContextWindowLabel(contextWindow)} ctx`;
}
