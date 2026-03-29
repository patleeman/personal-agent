import { dirname, join } from 'node:path';
import { getPiAgentRuntimeDir } from '@personal-agent/core';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';

export function createRuntimeModelRegistry(authStorage: AuthStorage): ModelRegistry {
  return new ModelRegistry(authStorage, join(getPiAgentRuntimeDir(), 'models.json'));
}

export function createModelRegistryForAuthFile(authFile: string): ModelRegistry {
  return new ModelRegistry(AuthStorage.create(authFile), join(dirname(authFile), 'models.json'));
}
