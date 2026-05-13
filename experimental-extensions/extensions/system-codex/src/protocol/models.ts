import type { MethodHandler } from '../server.js';

function toCodexModel(model: Record<string, unknown>, index: number) {
  const id = String(model.id ?? model.model ?? 'personal-agent');
  const displayName = String(model.name ?? model.displayName ?? id);

  return {
    id,
    model: id,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName,
    description: String(model.description ?? displayName),
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: 'medium',
    inputModalities: Array.isArray(model.input) ? model.input : ['text'],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    isDefault: index === 0,
  };
}

export const models = {
  /**
   * `model/list` — list available models.
   */
  list: (async (_params, ctx) => {
    try {
      const allModels = await ctx.models.list();
      const data = Array.isArray(allModels) ? allModels.map((model, index) => toCodexModel(model as Record<string, unknown>, index)) : [];
      return { data, nextCursor: null };
    } catch {
      return { data: [], nextCursor: null };
    }
  }) as MethodHandler,
};
