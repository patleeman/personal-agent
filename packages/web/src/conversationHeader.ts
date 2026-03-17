export function formatThinkingLevelLabel(level?: string): string {
  const normalized = level?.trim();
  return normalized && normalized.length > 0 ? normalized : 'default';
}

export function formatLiveSessionLabel(isLiveSession: boolean): string {
  return isLiveSession ? 'active session' : '';
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

export function formatContextShareLabel(label: string, value: number, contextWindow: number): string {
  const pct = contextWindow > 0 ? (value / contextWindow) * 100 : 0;
  return `${label}: ${pct.toFixed(1)}% of ctx`;
}

export function formatContextBreakdownLabel(
  segments: Array<{ label: string; tokens: number }>,
  contextWindow: number,
  total: number | null,
): string {
  const lines = total === null
    ? ['Current context usage is unknown right now (common immediately after compaction).']
    : [`total: ${formatContextUsageLabel(total, contextWindow)}`];

  for (const segment of segments) {
    lines.push(formatContextShareLabel(segment.label, segment.tokens, contextWindow));
  }

  return lines.join('\n');
}

export function getContextUsagePercent(tokens: number | null, contextWindow: number): number | null {
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
