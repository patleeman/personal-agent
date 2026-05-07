import { dirname, join } from 'node:path';

import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { getPiAgentRuntimeDir } from '@personal-agent/core';

import { normalizeModelContextWindow } from './modelContextWindows.js';

type RegistryModel = ReturnType<ModelRegistry['getAvailable']>[number];

function applyPersonalAgentModelMetadataOverrides(model: RegistryModel): RegistryModel {
  const contextWindow = normalizeModelContextWindow(model.id, model.contextWindow, 128_000);
  if (contextWindow !== model.contextWindow) {
    return { ...model, contextWindow };
  }

  return model;
}

function applyPersonalAgentRegistryOverrides(registry: ModelRegistry): ModelRegistry {
  const originalGetAll = registry.getAll.bind(registry);
  const originalGetAvailable = registry.getAvailable.bind(registry);
  const originalFind = registry.find.bind(registry);

  registry.getAll = () => originalGetAll().map(applyPersonalAgentModelMetadataOverrides);
  registry.getAvailable = () => originalGetAvailable().map(applyPersonalAgentModelMetadataOverrides);
  registry.find = (provider: string, modelId: string) => {
    const model = originalFind(provider, modelId);
    return model ? applyPersonalAgentModelMetadataOverrides(model) : undefined;
  };

  return registry;
}

export function createRuntimeModelRegistry(authStorage: AuthStorage): ModelRegistry {
  return applyPersonalAgentRegistryOverrides(ModelRegistry.create(authStorage, join(getPiAgentRuntimeDir(), 'models.json')));
}

export function createModelRegistryForAuthFile(authFile: string): ModelRegistry {
  return applyPersonalAgentRegistryOverrides(ModelRegistry.create(AuthStorage.create(authFile), join(dirname(authFile), 'models.json')));
}
