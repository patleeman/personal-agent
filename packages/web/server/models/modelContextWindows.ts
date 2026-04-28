const MIN_CONTEXT_WINDOWS_BY_MODEL_ID: Record<string, number> = {
  'gpt-5.5': 400_000,
};

function canonicalModelId(modelId: string | undefined): string | undefined {
  const trimmed = modelId?.trim();
  if (!trimmed) {
    return undefined;
  }

  const parts = trimmed.split('/');
  return parts[parts.length - 1];
}

export function normalizeModelContextWindow(
  modelId: string | undefined,
  contextWindow: number | undefined,
  fallback: number,
): number {
  const safeFallback = Number.isSafeInteger(fallback) && fallback > 0 ? fallback : 128_000;
  const resolved = Number.isSafeInteger(contextWindow) && contextWindow !== undefined && contextWindow > 0 ? contextWindow : safeFallback;
  const minimum = MIN_CONTEXT_WINDOWS_BY_MODEL_ID[canonicalModelId(modelId) ?? ''];
  return minimum === undefined ? resolved : Math.max(resolved, minimum);
}
