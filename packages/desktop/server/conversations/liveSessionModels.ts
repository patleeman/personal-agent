import {
  type Api,
  type Context,
  type Model,
  type ProviderStreamOptions,
  type SimpleStreamOptions,
  stream,
  streamSimple,
} from '@mariozechner/pi-ai';
import { type AgentSession, type ModelRegistry, type SessionManager } from '@mariozechner/pi-coding-agent';

import { readSavedModelPreferences } from '../models/modelPreferences.js';
import { modelSupportsServiceTier } from '../models/modelServiceTiers.js';
import {
  type ConversationModelPreferenceState,
  readConversationModelPreferenceSnapshot,
  resolveConversationModelPreferenceState,
} from './conversationModelPreferences.js';

export function resolveConversationPreferenceStateForSession(
  settingsFile: string,
  sessionManager: Pick<SessionManager, 'buildSessionContext' | 'getBranch'>,
  availableModels: Model<Api>[],
): ConversationModelPreferenceState {
  return resolveConversationModelPreferenceState(
    readConversationModelPreferenceSnapshot(sessionManager),
    readSavedModelPreferences(settingsFile, availableModels),
    availableModels,
  );
}

export function buildConversationServiceTierPreferenceInput(
  state: Pick<ConversationModelPreferenceState, 'currentServiceTier' | 'hasExplicitServiceTier'>,
): string | null | undefined {
  if (!state.hasExplicitServiceTier) {
    return undefined;
  }

  return state.currentServiceTier || null;
}

function buildServiceTierAwareStreamFn(modelRegistry: ModelRegistry, serviceTier: string) {
  return async (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      throw new Error(auth.error);
    }

    const mergedOptions: ProviderStreamOptions = {
      ...options,
      apiKey: auth.apiKey,
      headers: auth.headers || options?.headers ? { ...auth.headers, ...options?.headers } : undefined,
    };

    if (!serviceTier || !modelSupportsServiceTier(model, serviceTier)) {
      return streamSimple(model, context, mergedOptions);
    }

    const reasoningEffort =
      typeof (options as { reasoning?: unknown } | undefined)?.reasoning === 'string'
        ? (options as { reasoning: string }).reasoning
        : undefined;

    return stream(model, context, {
      ...mergedOptions,
      reasoningEffort,
      serviceTier,
    });
  };
}

export function applyLiveSessionServiceTier(session: AgentSession, serviceTier: string): void {
  session.agent.streamFn = buildServiceTierAwareStreamFn(session.modelRegistry, serviceTier);
}

export async function repairSessionModelProvider(
  session: Pick<AgentSession, 'setModel' | 'sessionManager' | 'model'>,
  models: ReturnType<ModelRegistry['getAvailable']>,
): Promise<void> {
  const currentId = session.model?.id ?? '';
  const currentProvider = (session.model as { provider?: string } | undefined)?.provider ?? '';
  if (!currentId) {
    return;
  }

  const exactMatch = models.find((candidate) => candidate.id === currentId && candidate.provider === currentProvider);
  if (exactMatch) {
    return;
  }

  const idMatches = models.filter((candidate) => candidate.id === currentId);
  if (idMatches.length !== 1) {
    return;
  }

  const repairedModel = idMatches[0]!;
  await session.setModel(repairedModel);
  session.sessionManager.appendModelChange(repairedModel.provider, repairedModel.id);
}
