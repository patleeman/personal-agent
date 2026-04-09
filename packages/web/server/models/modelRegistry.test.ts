import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authStorageCreateMock,
  getPiAgentRuntimeDirMock,
  modelRegistryCreateMock,
} = vi.hoisted(() => ({
  authStorageCreateMock: vi.fn(),
  getPiAgentRuntimeDirMock: vi.fn(),
  modelRegistryCreateMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  getPiAgentRuntimeDir: getPiAgentRuntimeDirMock,
}));

vi.mock('@mariozechner/pi-coding-agent', () => ({
  AuthStorage: {
    create: authStorageCreateMock,
  },
  ModelRegistry: {
    create: modelRegistryCreateMock,
  },
}));

import { createModelRegistryForAuthFile, createRuntimeModelRegistry } from './modelRegistry.js';

describe('model registry helpers', () => {
  beforeEach(() => {
    authStorageCreateMock.mockReset();
    getPiAgentRuntimeDirMock.mockReset();
    modelRegistryCreateMock.mockReset();
  });

  it('creates the runtime model registry inside the pi-agent runtime directory', () => {
    const authStorage = { kind: 'auth-storage' };
    const registry = { kind: 'registry' };
    getPiAgentRuntimeDirMock.mockReturnValue('/runtime/pi-agent-runtime');
    modelRegistryCreateMock.mockReturnValue(registry);

    expect(createRuntimeModelRegistry(authStorage as never)).toBe(registry);
    expect(modelRegistryCreateMock).toHaveBeenCalledWith(
      authStorage,
      '/runtime/pi-agent-runtime/models.json',
    );
  });

  it('creates a registry beside the provided auth file', () => {
    const authFile = '/tmp/profile/auth.json';
    const authStorage = { kind: 'auth-storage' };
    const registry = { kind: 'registry' };
    authStorageCreateMock.mockReturnValue(authStorage);
    modelRegistryCreateMock.mockReturnValue(registry);

    expect(createModelRegistryForAuthFile(authFile)).toBe(registry);
    expect(authStorageCreateMock).toHaveBeenCalledWith(authFile);
    expect(modelRegistryCreateMock).toHaveBeenCalledWith(
      authStorage,
      join('/tmp/profile', 'models.json'),
    );
  });
});
