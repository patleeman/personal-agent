import type { MethodHandler } from '../codexJsonRpcServer.js';

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function toCodexModel(model: Record<string, unknown>, index: number) {
  const id = String(model.id ?? model.model ?? 'personal-agent');
  const displayName = String(model.name ?? model.displayName ?? id);
  const reasoningEfforts = stringArray(model.supportedReasoningEfforts ?? model.reasoningEfforts ?? model.thinkingLevels);
  const defaultReasoning = typeof model.defaultReasoningEffort === 'string' ? model.defaultReasoningEffort : (reasoningEfforts[0] ?? null);

  return {
    id,
    model: id,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName,
    description: String(model.description ?? displayName),
    hidden: false,
    // Kitty/Codex render the reasoning selector from these fields. PA model
    // metadata is not Codex-native, so map common PA fields and otherwise
    // avoid advertising a fake reasoning selector.
    supportedReasoningEfforts: reasoningEfforts,
    defaultReasoningEffort: defaultReasoning,
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
