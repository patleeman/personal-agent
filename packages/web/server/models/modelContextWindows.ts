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
  const resolved = Number.isFinite(contextWindow) && contextWindow !== undefined ? contextWindow : fallback;
  const minimum = MIN_CONTEXT_WINDOWS_BY_MODEL_ID[canonicalModelId(modelId) ?? ''];
  return minimum === undefined ? resolved : Math.max(resolved, minimum);
}
