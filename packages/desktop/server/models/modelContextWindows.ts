const MIN_CONTEXT_WINDOWS_BY_MODEL_ID: Record<string, number> = {
  'gpt-5.5': 400_000,
};

/**
 * Per-model max context window cap.
 *
 * Prevents the effective context window from exceeding this value, which is
 * useful when a model advertises a large context window (e.g. 1M) but you
 * want auto-compaction to trigger earlier (e.g. at 400K).
 *
 * The compaction threshold is contextWindow - reserveTokens, so capping the
 * context window here is the simplest way to control the auto-compaction limit.
 */
const MAX_CONTEXT_WINDOWS_BY_MODEL_ID: Record<string, number> = {
  'deepseek-v4-flash': 400_000,
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const MAX_CONTEXT_WINDOW = 10_000_000;

function canonicalModelId(modelId: string | undefined): string | undefined {
  const trimmed = modelId?.trim();
  if (!trimmed) {
    return undefined;
  }

  const parts = trimmed.split('/');
  return parts[parts.length - 1];
}

export function normalizeModelContextWindow(modelId: string | undefined, contextWindow: number | undefined, fallback: number): number {
  const safeFallback = Number.isSafeInteger(fallback) && fallback > 0 && fallback <= MAX_CONTEXT_WINDOW ? fallback : DEFAULT_CONTEXT_WINDOW;
  let resolved =
    Number.isSafeInteger(contextWindow) && contextWindow !== undefined && contextWindow > 0
      ? Math.min(MAX_CONTEXT_WINDOW, contextWindow)
      : safeFallback;

  const canonicalId = canonicalModelId(modelId) ?? '';

  const minimum = MIN_CONTEXT_WINDOWS_BY_MODEL_ID[canonicalId];
  if (minimum !== undefined) {
    resolved = Math.max(resolved, minimum);
  }

  const maximum = MAX_CONTEXT_WINDOWS_BY_MODEL_ID[canonicalId];
  if (maximum !== undefined) {
    resolved = Math.min(resolved, maximum);
  }

  return resolved;
}
