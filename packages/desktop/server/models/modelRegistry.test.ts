import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authStorageCreateMock, getPiAgentRuntimeDirMock, modelRegistryCreateMock } = vi.hoisted(() => ({
  authStorageCreateMock: vi.fn(),
  getPiAgentRuntimeDirMock: vi.fn(),
  modelRegistryCreateMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  getPiAgentRuntimeDir: getPiAgentRuntimeDirMock,
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
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
    const registry = {
      getAll: vi.fn(() => []),
      getAvailable: vi.fn(() => []),
      find: vi.fn(),
    };
    getPiAgentRuntimeDirMock.mockReturnValue('/runtime/pi-agent-runtime');
    modelRegistryCreateMock.mockReturnValue(registry);

    expect(createRuntimeModelRegistry(authStorage as never)).toBe(registry);
    expect(modelRegistryCreateMock).toHaveBeenCalledWith(authStorage, '/runtime/pi-agent-runtime/models.json');
  });

  it('creates a registry beside the provided auth file', () => {
    const authFile = '/tmp/profile/auth.json';
    const authStorage = { kind: 'auth-storage' };
    const registry = {
      getAll: vi.fn(() => []),
      getAvailable: vi.fn(() => []),
      find: vi.fn(),
    };
    authStorageCreateMock.mockReturnValue(authStorage);
    modelRegistryCreateMock.mockReturnValue(registry);

    expect(createModelRegistryForAuthFile(authFile)).toBe(registry);
    expect(authStorageCreateMock).toHaveBeenCalledWith(authFile);
    expect(modelRegistryCreateMock).toHaveBeenCalledWith(authStorage, join('/tmp/profile', 'models.json'));
  });

  it('normalizes GPT-5.5 context metadata returned by runtime registries', () => {
    const authStorage = { kind: 'auth-storage' };
    const registry = {
      getAll: vi.fn(() => [{ id: 'gpt-5.5', provider: 'openai-codex', contextWindow: 272_000 }]),
      getAvailable: vi.fn(() => [
        { id: 'gpt-5.5', provider: 'openai-codex', contextWindow: 272_000 },
        { id: 'gpt-5.4', provider: 'openai-codex', contextWindow: 272_000 },
      ]),
      find: vi.fn(() => ({ id: 'gpt-5.5', provider: 'openai-codex', contextWindow: 272_000 })),
    };
    getPiAgentRuntimeDirMock.mockReturnValue('/runtime/pi-agent-runtime');
    modelRegistryCreateMock.mockReturnValue(registry);

    const created = createRuntimeModelRegistry(authStorage as never);

    expect(created.getAvailable()).toEqual([
      { id: 'gpt-5.5', provider: 'openai-codex', contextWindow: 400_000 },
      { id: 'gpt-5.4', provider: 'openai-codex', contextWindow: 272_000 },
    ]);
    expect(created.getAll()).toEqual([{ id: 'gpt-5.5', provider: 'openai-codex', contextWindow: 400_000 }]);
    expect(created.find('openai-codex', 'gpt-5.5')).toEqual({
      id: 'gpt-5.5',
      provider: 'openai-codex',
      contextWindow: 400_000,
    });
  });

  it('rejects unsafe context metadata returned by runtime registries', () => {
    const authStorage = { kind: 'auth-storage' };
    const registry = {
      getAll: vi.fn(() => [{ id: 'gpt-5.4', provider: 'openai-codex', contextWindow: Number.MAX_SAFE_INTEGER + 1 }]),
      getAvailable: vi.fn(() => [{ id: 'gpt-5.4', provider: 'openai-codex', contextWindow: Number.MAX_SAFE_INTEGER + 1 }]),
      find: vi.fn(() => ({ id: 'gpt-5.4', provider: 'openai-codex', contextWindow: Number.MAX_SAFE_INTEGER + 1 })),
    };
    getPiAgentRuntimeDirMock.mockReturnValue('/runtime/pi-agent-runtime');
    modelRegistryCreateMock.mockReturnValue(registry);

    const created = createRuntimeModelRegistry(authStorage as never);

    expect(created.getAvailable()).toEqual([{ id: 'gpt-5.4', provider: 'openai-codex', contextWindow: 128_000 }]);
    expect(created.getAll()).toEqual([{ id: 'gpt-5.4', provider: 'openai-codex', contextWindow: 128_000 }]);
    expect(created.find('openai-codex', 'gpt-5.4')).toEqual({
      id: 'gpt-5.4',
      provider: 'openai-codex',
      contextWindow: 128_000,
    });
  });
});
