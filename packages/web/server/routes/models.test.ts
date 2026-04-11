import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelProviderOAuthLoginMock,
  getAvailableModelsMock,
  getDefaultVaultRootMock,
  getProviderOAuthLoginStateMock,
  getVaultRootMock,
  invalidateAppTopicsMock,
  logErrorMock,
  normalizeSavedModelPreferencesMock,
  persistSettingsWriteMock,
  readCodexPlanUsageMock,
  readMachineConfigMock,
  readModelProvidersStateMock,
  readProviderAuthStateMock,
  readSavedDefaultCwdPreferencesMock,
  readSavedModelPreferencesMock,
  refreshAllLiveSessionModelRegistriesMock,
  reloadAllLiveSessionAuthMock,
  removeModelProviderMock,
  removeModelProviderModelMock,
  removeProviderCredentialMock,
  setProviderApiKeyMock,
  startProviderOAuthLoginMock,
  submitProviderOAuthLoginInputMock,
  subscribeProviderOAuthLoginMock,
  updateMachineConfigMock,
  upsertModelProviderMock,
  upsertModelProviderModelMock,
  writeSavedDefaultCwdPreferenceMock,
  writeSavedModelPreferencesMock,
} = vi.hoisted(() => ({
  cancelProviderOAuthLoginMock: vi.fn(),
  getAvailableModelsMock: vi.fn(),
  getDefaultVaultRootMock: vi.fn(),
  getProviderOAuthLoginStateMock: vi.fn(),
  getVaultRootMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  logErrorMock: vi.fn(),
  normalizeSavedModelPreferencesMock: vi.fn(),
  persistSettingsWriteMock: vi.fn(),
  readCodexPlanUsageMock: vi.fn(),
  readMachineConfigMock: vi.fn(),
  readModelProvidersStateMock: vi.fn(),
  readProviderAuthStateMock: vi.fn(),
  readSavedDefaultCwdPreferencesMock: vi.fn(),
  readSavedModelPreferencesMock: vi.fn(),
  refreshAllLiveSessionModelRegistriesMock: vi.fn(),
  reloadAllLiveSessionAuthMock: vi.fn(),
  removeModelProviderMock: vi.fn(),
  removeModelProviderModelMock: vi.fn(),
  removeProviderCredentialMock: vi.fn(),
  setProviderApiKeyMock: vi.fn(),
  startProviderOAuthLoginMock: vi.fn(),
  submitProviderOAuthLoginInputMock: vi.fn(),
  subscribeProviderOAuthLoginMock: vi.fn(),
  updateMachineConfigMock: vi.fn(),
  upsertModelProviderMock: vi.fn(),
  upsertModelProviderModelMock: vi.fn(),
  writeSavedDefaultCwdPreferenceMock: vi.fn(),
  writeSavedModelPreferencesMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  getDefaultVaultRoot: getDefaultVaultRootMock,
  getVaultRoot: getVaultRootMock,
  readMachineConfig: readMachineConfigMock,
  updateMachineConfig: updateMachineConfigMock,
}));

vi.mock('../models/modelPreferences.js', () => ({
  normalizeSavedModelPreferences: normalizeSavedModelPreferencesMock,
  readSavedModelPreferences: readSavedModelPreferencesMock,
  writeSavedModelPreferences: writeSavedModelPreferencesMock,
}));

vi.mock('../models/modelProviders.js', () => ({
  readModelProvidersState: readModelProvidersStateMock,
  removeModelProvider: removeModelProviderMock,
  removeModelProviderModel: removeModelProviderModelMock,
  upsertModelProvider: upsertModelProviderMock,
  upsertModelProviderModel: upsertModelProviderModelMock,
}));

vi.mock('../models/providerAuth.js', () => ({
  cancelProviderOAuthLogin: cancelProviderOAuthLoginMock,
  getProviderOAuthLoginState: getProviderOAuthLoginStateMock,
  readProviderAuthState: readProviderAuthStateMock,
  removeProviderCredential: removeProviderCredentialMock,
  setProviderApiKey: setProviderApiKeyMock,
  startProviderOAuthLogin: startProviderOAuthLoginMock,
  submitProviderOAuthLoginInput: submitProviderOAuthLoginInputMock,
  subscribeProviderOAuthLogin: subscribeProviderOAuthLoginMock,
}));

vi.mock('../models/codexUsage.js', () => ({
  readCodexPlanUsage: readCodexPlanUsageMock,
}));

vi.mock('../ui/defaultCwdPreferences.js', () => ({
  readSavedDefaultCwdPreferences: readSavedDefaultCwdPreferencesMock,
  writeSavedDefaultCwdPreference: writeSavedDefaultCwdPreferenceMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  getAvailableModels: getAvailableModelsMock,
}));

vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
  logError: logErrorMock,
  persistSettingsWrite: persistSettingsWriteMock,
  reloadAllLiveSessionAuth: reloadAllLiveSessionAuthMock,
  refreshAllLiveSessionModelRegistries: refreshAllLiveSessionModelRegistriesMock,
}));

import { registerModelRoutes } from './models.js';

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

type RouteFiles = {
  root: string;
  authFile: string;
  settingsFile: string;
  profileSettingsFile: string;
};

function createRouteFiles(): RouteFiles {
  const root = mkdtempSync(join(tmpdir(), 'pa-model-routes-'));
  return {
    root,
    authFile: join(root, 'auth.json'),
    settingsFile: join(root, 'runtime-settings.json'),
    profileSettingsFile: join(root, 'profile-settings.json'),
  };
}

function cleanupRouteFiles(files: RouteFiles): void {
  rmSync(files.root, { recursive: true, force: true });
}

function createRequest(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const req = {
    params: {},
    query: {},
    body: {},
    headers: {},
    on: vi.fn((event: string, listener: () => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(listener);
      listeners.set(event, existing);
    }),
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
    ...overrides,
  };

  return req;
}

function createResponse() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    end: vi.fn(),
    flushHeaders: vi.fn(),
    json: vi.fn((payload: unknown) => {
      response.body = payload;
      return response;
    }),
    setHeader: vi.fn((name: string, value: unknown) => {
      response.headers[name] = value;
    }),
    status: vi.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),
    write: vi.fn(),
  };

  return response;
}

function createDesktopHarness(files = createRouteFiles()) {
  const deleteHandlers = new Map<string, Handler>();
  const getHandlers = new Map<string, Handler>();
  const patchHandlers = new Map<string, Handler>();
  const postHandlers = new Map<string, Handler>();
  const materializeWebProfile = vi.fn();

  const router = {
    delete: vi.fn((path: string, handler: Handler) => {
      deleteHandlers.set(path, handler);
    }),
    get: vi.fn((path: string, handler: Handler) => {
      getHandlers.set(path, handler);
    }),
    patch: vi.fn((path: string, handler: Handler) => {
      patchHandlers.set(path, handler);
    }),
    post: vi.fn((path: string, handler: Handler) => {
      postHandlers.set(path, handler);
    }),
  };

  registerModelRoutes(router as never, {
    getAuthFile: () => files.authFile,
    getCurrentProfile: () => 'assistant',
    getCurrentProfileSettingsFile: () => files.profileSettingsFile,
    getSettingsFile: () => files.settingsFile,
    materializeWebProfile,
  });

  return {
    files,
    materializeWebProfile,
    deleteHandler: (path: string) => deleteHandlers.get(path)!,
    getHandler: (path: string) => getHandlers.get(path)!,
    patchHandler: (path: string) => patchHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
  };
}

describe('model routes', () => {
  const allocatedFiles: RouteFiles[] = [];
  let machineConfig: Record<string, unknown>;

  beforeEach(() => {
    machineConfig = {};

    cancelProviderOAuthLoginMock.mockReset();
    getAvailableModelsMock.mockReset();
    getDefaultVaultRootMock.mockReset();
    getProviderOAuthLoginStateMock.mockReset();
    getVaultRootMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    logErrorMock.mockReset();
    normalizeSavedModelPreferencesMock.mockReset();
    persistSettingsWriteMock.mockReset();
    readCodexPlanUsageMock.mockReset();
    readMachineConfigMock.mockReset();
    readModelProvidersStateMock.mockReset();
    readProviderAuthStateMock.mockReset();
    readSavedDefaultCwdPreferencesMock.mockReset();
    readSavedModelPreferencesMock.mockReset();
    refreshAllLiveSessionModelRegistriesMock.mockReset();
    reloadAllLiveSessionAuthMock.mockReset();
    removeModelProviderMock.mockReset();
    removeModelProviderModelMock.mockReset();
    removeProviderCredentialMock.mockReset();
    setProviderApiKeyMock.mockReset();
    startProviderOAuthLoginMock.mockReset();
    submitProviderOAuthLoginInputMock.mockReset();
    subscribeProviderOAuthLoginMock.mockReset();
    updateMachineConfigMock.mockReset();
    upsertModelProviderMock.mockReset();
    upsertModelProviderModelMock.mockReset();
    writeSavedDefaultCwdPreferenceMock.mockReset();
    writeSavedModelPreferencesMock.mockReset();

    getAvailableModelsMock.mockReturnValue([{ id: 'model-a', provider: 'provider-a', name: 'Model A' }]);
    getDefaultVaultRootMock.mockReturnValue('/default-vault');
    getProviderOAuthLoginStateMock.mockReturnValue({ id: 'login-1', status: 'pending' });
    getVaultRootMock.mockReturnValue('/effective-vault');
    normalizeSavedModelPreferencesMock.mockReturnValue({
      currentModel: 'model-a',
      currentThinkingLevel: 'high',
    });
    persistSettingsWriteMock.mockImplementation((write: (settingsFile: string) => unknown, options: { runtimeSettingsFile: string }) => write(options.runtimeSettingsFile));
    readCodexPlanUsageMock.mockResolvedValue({ available: true, updatedAt: '2026-04-09T00:00:00.000Z' });
    readMachineConfigMock.mockImplementation(() => machineConfig);
    readModelProvidersStateMock.mockReturnValue({ providers: [] });
    readProviderAuthStateMock.mockReturnValue({ providers: [] });
    readSavedDefaultCwdPreferencesMock.mockReturnValue({ cwd: '/repo' });
    readSavedModelPreferencesMock.mockReturnValue({ currentModel: 'model-a', currentThinkingLevel: 'high' });
    setProviderApiKeyMock.mockReturnValue({ providers: [{ id: 'openai' }] });
    startProviderOAuthLoginMock.mockReturnValue({ id: 'login-1', status: 'pending' });
    submitProviderOAuthLoginInputMock.mockReturnValue({ id: 'login-1', status: 'waiting_input' });
    subscribeProviderOAuthLoginMock.mockImplementation(() => vi.fn());
    updateMachineConfigMock.mockImplementation((updater: (current: unknown) => unknown) => {
      machineConfig = updater(machineConfig) as Record<string, unknown>;
    });
    upsertModelProviderMock.mockReturnValue({ providers: [{ id: 'openrouter' }] });
    upsertModelProviderModelMock.mockReturnValue({ providers: [{ id: 'openrouter', models: [{ id: 'model-b' }] }] });
    removeModelProviderMock.mockReturnValue({ state: { providers: [] } });
    removeModelProviderModelMock.mockReturnValue({ state: { providers: [] } });
    removeProviderCredentialMock.mockReturnValue({ providers: [] });
    cancelProviderOAuthLoginMock.mockReturnValue({ id: 'login-1', status: 'cancelled' });
    writeSavedDefaultCwdPreferenceMock.mockReturnValue({ cwd: '/next-repo' });
  });

  afterEach(() => {
    delete process.env.PERSONAL_AGENT_VAULT_ROOT;
    vi.useRealTimers();
    for (const files of allocatedFiles.splice(0)) {
      cleanupRouteFiles(files);
    }
  });

  function allocateFiles() {
    const files = createRouteFiles();
    allocatedFiles.push(files);
    return files;
  }

  it('serves model state, including the built-in fallback path', () => {
    const desktop = createDesktopHarness(allocateFiles());

    const desktopRes = createResponse();
    desktop.getHandler('/api/models')(createRequest(), desktopRes);

    expect(desktopRes.json).toHaveBeenCalledWith({
      currentModel: 'model-a',
      currentThinkingLevel: 'high',
      models: [{ id: 'model-a', provider: 'provider-a', name: 'Model A' }],
    });

    getAvailableModelsMock.mockImplementation(() => {
      throw new Error('registry unavailable');
    });
    normalizeSavedModelPreferencesMock.mockReturnValue({
      currentModel: 'missing-model',
      currentThinkingLevel: 'medium',
    });

    const fallbackRes = createResponse();
    desktop.getHandler('/api/models')(createRequest(), fallbackRes);

    expect(fallbackRes.json).toHaveBeenCalledWith(expect.objectContaining({
      currentModel: 'claude-opus-4-6',
      currentThinkingLevel: 'medium',
    }));
  });

  it('updates the current model, validates default cwd changes, and maps write failures', () => {
    const { materializeWebProfile, getHandler, patchHandler } = createDesktopHarness(allocateFiles());

    const invalidModelRes = createResponse();
    patchHandler('/api/models/current')(createRequest({ body: {} }), invalidModelRes);
    expect(invalidModelRes.status).toHaveBeenCalledWith(400);
    expect(invalidModelRes.json).toHaveBeenCalledWith({ error: 'model or thinkingLevel required' });

    const modelRes = createResponse();
    patchHandler('/api/models/current')(createRequest({ body: { model: 'model-b', thinkingLevel: 'medium' } }), modelRes);
    expect(writeSavedModelPreferencesMock).toHaveBeenCalledWith(
      { model: 'model-b', thinkingLevel: 'medium' },
      expect.any(String),
      [{ id: 'model-a', provider: 'provider-a', name: 'Model A' }],
    );
    expect(materializeWebProfile).toHaveBeenCalledWith('assistant');
    expect(modelRes.json).toHaveBeenCalledWith({ ok: true });

    const getDefaultCwdRes = createResponse();
    getHandler('/api/default-cwd')(createRequest(), getDefaultCwdRes);
    expect(readSavedDefaultCwdPreferencesMock).toHaveBeenCalledWith(expect.any(String), process.cwd());
    expect(getDefaultCwdRes.json).toHaveBeenCalledWith({ cwd: '/repo' });

    const invalidCwdRes = createResponse();
    patchHandler('/api/default-cwd')(createRequest({ body: { cwd: 123 } }), invalidCwdRes);
    expect(invalidCwdRes.status).toHaveBeenCalledWith(400);
    expect(invalidCwdRes.json).toHaveBeenCalledWith({ error: 'cwd must be a string or null' });

    const cwdRes = createResponse();
    patchHandler('/api/default-cwd')(createRequest({ body: { cwd: '/repo/next' } }), cwdRes);
    expect(writeSavedDefaultCwdPreferenceMock).toHaveBeenCalledWith(
      { cwd: '/repo/next' },
      expect.any(String),
      { baseDir: process.cwd(), validate: true },
    );
    expect(cwdRes.json).toHaveBeenCalledWith({ cwd: '/next-repo' });

    writeSavedDefaultCwdPreferenceMock.mockImplementationOnce(() => {
      throw new Error('Directory does not exist: /missing');
    });

    const missingCwdRes = createResponse();
    patchHandler('/api/default-cwd')(createRequest({ body: { cwd: '/missing' } }), missingCwdRes);
    expect(missingCwdRes.status).toHaveBeenCalledWith(400);
    expect(missingCwdRes.json).toHaveBeenCalledWith({ error: 'Directory does not exist: /missing' });
  });

  it('reads and writes vault root state with source precedence and filesystem validation', () => {
    const { patchHandler, getHandler, materializeWebProfile } = createDesktopHarness(allocateFiles());
    const validDir = mkdtempSync(join(tmpdir(), 'pa-vault-root-'));
    const invalidFile = join(validDir, 'not-a-directory.txt');
    writeFileSync(invalidFile, 'content');

    const defaultRes = createResponse();
    getHandler('/api/vault-root')(createRequest(), defaultRes);
    expect(defaultRes.json).toHaveBeenCalledWith({
      currentRoot: '',
      effectiveRoot: '/effective-vault',
      defaultRoot: '/default-vault',
      source: 'default',
    });

    machineConfig.vaultRoot = '/config-vault';
    const configuredRes = createResponse();
    getHandler('/api/vault-root')(createRequest(), configuredRes);
    expect(configuredRes.json).toHaveBeenCalledWith(expect.objectContaining({
      currentRoot: '/config-vault',
      source: 'config',
    }));

    process.env.PERSONAL_AGENT_VAULT_ROOT = ' /env-vault ';
    const envRes = createResponse();
    getHandler('/api/vault-root')(createRequest(), envRes);
    expect(envRes.json).toHaveBeenCalledWith(expect.objectContaining({
      source: 'env',
    }));

    const invalidTypeRes = createResponse();
    patchHandler('/api/vault-root')(createRequest({ body: { root: 123 } }), invalidTypeRes);
    expect(invalidTypeRes.status).toHaveBeenCalledWith(400);
    expect(invalidTypeRes.json).toHaveBeenCalledWith({ error: 'root must be a string or null' });

    const missingDirRes = createResponse();
    patchHandler('/api/vault-root')(createRequest({ body: { root: join(validDir, 'missing') } }), missingDirRes);
    expect(missingDirRes.status).toHaveBeenCalledWith(400);
    expect(missingDirRes.json).toHaveBeenCalledWith({ error: `Directory does not exist: ${join(validDir, 'missing')}` });

    const fileRes = createResponse();
    patchHandler('/api/vault-root')(createRequest({ body: { root: invalidFile } }), fileRes);
    expect(fileRes.status).toHaveBeenCalledWith(400);
    expect(fileRes.json).toHaveBeenCalledWith({ error: `Not a directory: ${invalidFile}` });

    delete process.env.PERSONAL_AGENT_VAULT_ROOT;
    getVaultRootMock.mockReturnValue(validDir);

    const updateRes = createResponse();
    patchHandler('/api/vault-root')(createRequest({ body: { root: validDir } }), updateRes);
    expect(updateMachineConfigMock).toHaveBeenCalled();
    expect(materializeWebProfile).toHaveBeenCalledWith('assistant');
    expect(updateRes.json).toHaveBeenCalledWith({
      currentRoot: validDir,
      effectiveRoot: validDir,
      defaultRoot: '/default-vault',
      source: 'config',
    });
  });

  it('reads conversation plan workspace state through the shared settings helpers', () => {
    const { files, getHandler } = createDesktopHarness(allocateFiles());

    writeFileSync(files.settingsFile, JSON.stringify({
      webUi: {
        conversationAutomation: {
          defaultEnabled: true,
          workflowPresets: {
            presets: [
              {
                id: 'preset-1',
                name: 'Alpha preset',
                updatedAt: '2026-04-09T17:00:00.000Z',
                items: [
                  { kind: 'instruction', label: 'Instruction', text: 'Follow the plan.' },
                  { kind: 'skill', label: 'Skill', skillName: 'backfill-tests', skillArgs: 'target=models' },
                ],
              },
            ],
            defaultPresetIds: ['preset-1'],
          },
        },
      },
    }, null, 2));

    const workspaceRes = createResponse();
    getHandler('/api/conversation-plans/workspace')(createRequest(), workspaceRes);
    expect(workspaceRes.json).toHaveBeenCalledWith({
      defaultEnabled: true,
      presetLibrary: {
        defaultPresetIds: ['preset-1'],
        presets: [
          {
            id: 'preset-1',
            name: 'Alpha preset',
            updatedAt: '2026-04-09T17:00:00.000Z',
            items: [
              { id: 'item-1', kind: 'instruction', label: 'Instruction', text: 'Follow the plan.' },
              { id: 'item-2', kind: 'skill', label: 'Skill', skillName: 'backfill-tests', skillArgs: 'target=models' },
            ],
          },
        ],
      },
    });
  });

  it('handles provider CRUD routes and refreshes live registries', () => {
    const { deleteHandler, getHandler, postHandler, materializeWebProfile } = createDesktopHarness(allocateFiles());

    const providersRes = createResponse();
    getHandler('/api/model-providers')(createRequest(), providersRes);
    expect(readModelProvidersStateMock).toHaveBeenCalledWith('assistant');
    expect(providersRes.json).toHaveBeenCalledWith({ providers: [] });

    const invalidCreateRes = createResponse();
    postHandler('/api/model-providers/providers')(createRequest({ body: {} }), invalidCreateRes);
    expect(invalidCreateRes.status).toHaveBeenCalledWith(400);
    expect(invalidCreateRes.json).toHaveBeenCalledWith({ error: 'provider required' });

    const createRes = createResponse();
    postHandler('/api/model-providers/providers')(createRequest({
      body: {
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai',
        apiKey: 'secret',
      },
    }), createRes);
    expect(upsertModelProviderMock).toHaveBeenCalledWith('assistant', 'openrouter', expect.objectContaining({
      apiKey: 'secret',
      baseUrl: 'https://openrouter.ai',
    }));
    expect(materializeWebProfile).toHaveBeenCalledWith('assistant');
    expect(refreshAllLiveSessionModelRegistriesMock).toHaveBeenCalled();
    expect(createRes.json).toHaveBeenCalledWith({ providers: [{ id: 'openrouter' }] });

    const invalidDeleteProviderRes = createResponse();
    deleteHandler('/api/model-providers/providers/:provider')(createRequest({ params: { provider: ' ' } }), invalidDeleteProviderRes);
    expect(invalidDeleteProviderRes.status).toHaveBeenCalledWith(400);
    expect(invalidDeleteProviderRes.json).toHaveBeenCalledWith({ error: 'provider required' });

    const deleteProviderRes = createResponse();
    deleteHandler('/api/model-providers/providers/:provider')(createRequest({ params: { provider: 'openrouter' } }), deleteProviderRes);
    expect(removeModelProviderMock).toHaveBeenCalledWith('assistant', 'openrouter');
    expect(deleteProviderRes.json).toHaveBeenCalledWith({ providers: [] });

    const invalidCreateModelRes = createResponse();
    postHandler('/api/model-providers/providers/:provider/models')(createRequest({
      params: { provider: 'openrouter' },
      body: {},
    }), invalidCreateModelRes);
    expect(invalidCreateModelRes.status).toHaveBeenCalledWith(400);
    expect(invalidCreateModelRes.json).toHaveBeenCalledWith({ error: 'modelId required' });

    const createModelRes = createResponse();
    postHandler('/api/model-providers/providers/:provider/models')(createRequest({
      params: { provider: 'openrouter' },
      body: {
        modelId: 'model-b',
        name: 'Model B',
        contextWindow: 128000,
      },
    }), createModelRes);
    expect(upsertModelProviderModelMock).toHaveBeenCalledWith('assistant', 'openrouter', 'model-b', expect.objectContaining({
      contextWindow: 128000,
      name: 'Model B',
    }));
    expect(createModelRes.json).toHaveBeenCalledWith({ providers: [{ id: 'openrouter', models: [{ id: 'model-b' }] }] });

    const invalidDeleteModelRes = createResponse();
    deleteHandler('/api/model-providers/providers/:provider/models/:modelId')(createRequest({
      params: { provider: 'openrouter', modelId: '' },
    }), invalidDeleteModelRes);
    expect(invalidDeleteModelRes.status).toHaveBeenCalledWith(400);
    expect(invalidDeleteModelRes.json).toHaveBeenCalledWith({ error: 'modelId required' });

    const deleteModelRes = createResponse();
    deleteHandler('/api/model-providers/providers/:provider/models/:modelId')(createRequest({
      params: { provider: 'openrouter', modelId: 'model-b' },
    }), deleteModelRes);
    expect(removeModelProviderModelMock).toHaveBeenCalledWith('assistant', 'openrouter', 'model-b');
    expect(deleteModelRes.json).toHaveBeenCalledWith({ providers: [] });
  });

  it('handles provider auth, codex usage, and oauth event streaming routes', async () => {
    vi.useFakeTimers();

    let oauthListener: ((login: { status: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    subscribeProviderOAuthLoginMock.mockImplementation((_loginId: string, listener: (login: { status: string }) => void) => {
      oauthListener = listener;
      return unsubscribe;
    });

    const { deleteHandler, getHandler, patchHandler, postHandler } = createDesktopHarness(allocateFiles());

    const authRes = createResponse();
    getHandler('/api/provider-auth')(createRequest(), authRes);
    expect(authRes.json).toHaveBeenCalledWith({ providers: [] });

    const usageRes = createResponse();
    await getHandler('/api/provider-auth/openai-codex/usage')(createRequest(), usageRes);
    expect(usageRes.json).toHaveBeenCalledWith({ available: true, updatedAt: '2026-04-09T00:00:00.000Z' });

    readCodexPlanUsageMock.mockRejectedValueOnce(new Error('network failed'));
    const usageErrorRes = createResponse();
    await getHandler('/api/provider-auth/openai-codex/usage')(createRequest(), usageErrorRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({ message: 'network failed' }));
    expect(usageErrorRes.status).toHaveBeenCalledWith(500);
    expect(usageErrorRes.json).toHaveBeenCalledWith(expect.objectContaining({
      available: true,
      error: 'network failed',
    }));

    const invalidApiKeyRes = createResponse();
    patchHandler('/api/provider-auth/:provider/api-key')(createRequest({ params: { provider: '' }, body: {} }), invalidApiKeyRes);
    expect(invalidApiKeyRes.status).toHaveBeenCalledWith(400);
    expect(invalidApiKeyRes.json).toHaveBeenCalledWith({ error: 'provider required' });

    const setApiKeyRes = createResponse();
    patchHandler('/api/provider-auth/:provider/api-key')(createRequest({
      params: { provider: 'openai' },
      body: { apiKey: 'secret' },
    }), setApiKeyRes);
    expect(setProviderApiKeyMock).toHaveBeenCalledWith(expect.any(String), 'openai', 'secret');
    expect(reloadAllLiveSessionAuthMock).toHaveBeenCalled();
    expect(setApiKeyRes.json).toHaveBeenCalledWith({ providers: [{ id: 'openai' }] });

    const invalidDeleteAuthRes = createResponse();
    deleteHandler('/api/provider-auth/:provider')(createRequest({ params: { provider: ' ' } }), invalidDeleteAuthRes);
    expect(invalidDeleteAuthRes.status).toHaveBeenCalledWith(400);
    expect(invalidDeleteAuthRes.json).toHaveBeenCalledWith({ error: 'provider required' });

    const deleteAuthRes = createResponse();
    deleteHandler('/api/provider-auth/:provider')(createRequest({ params: { provider: 'openai' } }), deleteAuthRes);
    expect(removeProviderCredentialMock).toHaveBeenCalledWith(expect.any(String), 'openai');
    expect(deleteAuthRes.json).toHaveBeenCalledWith({ providers: [] });

    const oauthStartRes = createResponse();
    postHandler('/api/provider-auth/:provider/oauth/start')(createRequest({
      params: { provider: 'openrouter' },
      body: { redirectPort: 4123 },
    }), oauthStartRes);
    expect(startProviderOAuthLoginMock).toHaveBeenCalledWith(expect.any(String), 'openrouter');
    expect(oauthStartRes.json).toHaveBeenCalledWith({ id: 'login-1', status: 'pending' });

    const oauthStateRes = createResponse();
    getHandler('/api/provider-auth/oauth/:loginId')(createRequest({ params: { loginId: 'login-1' } }), oauthStateRes);
    expect(getProviderOAuthLoginStateMock).toHaveBeenCalledWith('login-1');
    expect(oauthStateRes.json).toHaveBeenCalledWith({ id: 'login-1', status: 'pending' });

    const eventsReq = createRequest({ params: { loginId: 'login-1' } });
    const eventsRes = createResponse();
    getHandler('/api/provider-auth/oauth/:loginId/events')(eventsReq, eventsRes);
    expect(eventsRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(eventsRes.flushHeaders).toHaveBeenCalled();

    oauthListener?.({ status: 'running' });
    expect(eventsRes.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ status: 'running' })}\n\n`);

    oauthListener?.({ status: 'completed' });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(eventsRes.end).toHaveBeenCalledTimes(1);

    const timeoutReq = createRequest({ params: { loginId: 'login-2' } });
    const timeoutRes = createResponse();
    subscribeProviderOAuthLoginMock.mockImplementationOnce(() => unsubscribe);
    getHandler('/api/provider-auth/oauth/:loginId/events')(timeoutReq, timeoutRes);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(timeoutRes.end).toHaveBeenCalledTimes(1);

    const inputRes = createResponse();
    postHandler('/api/provider-auth/oauth/:loginId/input')(createRequest({
      params: { loginId: 'login-1' },
      body: { input: '123456' },
    }), inputRes);
    expect(submitProviderOAuthLoginInputMock).toHaveBeenCalledWith('login-1', '123456');
    expect(inputRes.json).toHaveBeenCalledWith({ id: 'login-1', status: 'waiting_input' });

    const invalidCancelRes = createResponse();
    postHandler('/api/provider-auth/oauth/:loginId/cancel')(createRequest({ params: { loginId: ' ' } }), invalidCancelRes);
    expect(invalidCancelRes.status).toHaveBeenCalledWith(400);
    expect(invalidCancelRes.json).toHaveBeenCalledWith({ error: 'loginId required' });

    const cancelRes = createResponse();
    postHandler('/api/provider-auth/oauth/:loginId/cancel')(createRequest({ params: { loginId: 'login-1' } }), cancelRes);
    expect(cancelProviderOAuthLoginMock).toHaveBeenCalledWith('login-1');
    expect(cancelRes.json).toHaveBeenCalledWith({ id: 'login-1', status: 'cancelled' });
  });
});
