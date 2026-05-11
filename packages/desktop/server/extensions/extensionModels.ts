import { readModelState } from '../models/modelState.js';

const DEFAULT_RUNTIME_SETTINGS_FILE = process.env.PERSONAL_AGENT_SETTINGS_FILE || '';

/**
 * Models capability for extensions.
 */
export function createExtensionModelsCapability() {
  return {
    /**
     * List available models and their capabilities.
     */
    async list(): Promise<unknown[]> {
      try {
        const settingsFile =
          DEFAULT_RUNTIME_SETTINGS_FILE ||
          (await (async () => {
            // Lazy default — look for the settings file in the agent dir
            const { getPiAgentRuntimeDir } = await import('@personal-agent/core');
            return `${getPiAgentRuntimeDir()}/settings.json`;
          })().catch(() => ''));
        if (!settingsFile) return [];

        const state = readModelState(settingsFile);
        return (state.models ?? []).map(
          (m: { id?: string; name?: string; provider?: string; contextWindow?: number; reasoning?: boolean; input?: string[] }) => ({
            id: m.id ?? '',
            name: m.name ?? m.id ?? '',
            provider: m.provider ?? '',
            contextWindow: m.contextWindow ?? 0,
            reasoning: m.reasoning ?? false,
            input: m.input ?? ['text'],
          }),
        );
      } catch {
        return [];
      }
    },
  };
}
