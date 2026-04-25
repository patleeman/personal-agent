import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelProviderOAuthLoginMock,
  getAvailableModelsMock,
  getMachineConfigFilePathMock,
  getProviderOAuthLoginStateMock,
  readKnowledgeBaseStateMock,
  syncKnowledgeBaseNowMock,
  updateKnowledgeBaseMock,
  readMachineInstructionFilesMock,
  readMachineSkillDirsMock,
  invalidateAppTopicsMock,
  logErrorMock,
  normalizeSavedModelPreferencesMock,
  persistSettingsWriteMock,
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
  upsertModelProviderMock,
  writeMachineInstructionFilesMock,
  writeMachineSkillDirsMock,
  upsertModelProviderModelMock,
  writeSavedDefaultCwdPreferenceMock,
  writeSavedModelPreferencesMock,
} = vi.hoisted(() => ({
  cancelProviderOAuthLoginMock: vi.fn(),
  getAvailableModelsMock: vi.fn(),
  getMachineConfigFilePathMock: vi.fn(),
  getProviderOAuthLoginStateMock: vi.fn(),
  readKnowledgeBaseStateMock: vi.fn(),
  syncKnowledgeBaseNowMock: vi.fn(),
  updateKnowledgeBaseMock: vi.fn(),
  readMachineInstructionFilesMock: vi.fn(),
  readMachineSkillDirsMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  logErrorMock: vi.fn(),
  normalizeSavedModelPreferencesMock: vi.fn(),
  persistSettingsWriteMock: vi.fn(),
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
  upsertModelProviderMock: vi.fn(),
  writeMachineInstructionFilesMock: vi.fn(),
  writeMachineSkillDirsMock: vi.fn(),
  upsertModelProviderModelMock: vi.fn(),
  writeSavedDefaultCwdPreferenceMock: vi.fn(),
  writeSavedModelPreferencesMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  getMachineConfigFilePath: getMachineConfigFilePathMock,
  readKnowledgeBaseState: readKnowledgeBaseStateMock,
  readMachineInstructionFiles: readMachineInstructionFilesMock,
  readMachineSkillDirs: readMachineSkillDirsMock,
  syncKnowledgeBaseNow: syncKnowledgeBaseNowMock,
  updateKnowledgeBase: updateKnowledgeBaseMock,
  writeMachineInstructionFiles: writeMachineInstructionFilesMock,
  writeMachineSkillDirs: writeMachineSkillDirsMock,
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
    getCurrentProfile: () => 'shared',
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
    getMachineConfigFilePathMock.mockReset();
    getProviderOAuthLoginStateMock.mockReset();
    readKnowledgeBaseStateMock.mockReset();
    readMachineInstructionFilesMock.mockReset();
    readMachineSkillDirsMock.mockReset();
    syncKnowledgeBaseNowMock.mockReset();
    updateKnowledgeBaseMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    logErrorMock.mockReset();
    normalizeSavedModelPreferencesMock.mockReset();
    persistSettingsWriteMock.mockReset();
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
    upsertModelProviderMock.mockReset();
    upsertModelProviderModelMock.mockReset();
    writeMachineInstructionFilesMock.mockReset();
    writeMachineSkillDirsMock.mockReset();
    writeSavedDefaultCwdPreferenceMock.mockReset();
    writeSavedModelPreferencesMock.mockReset();

    getAvailableModelsMock.mockReturnValue([{ id: 'model-a', provider: 'provider-a', name: 'Model A', contextWindow: 128_000, api: 'anthropic-messages' }]);
    getMachineConfigFilePathMock.mockReturnValue('/config/config.json');
    getProviderOAuthLoginStateMock.mockReturnValue({ id: 'login-1', status: 'pending' });
    readKnowledgeBaseStateMock.mockImplementation(() => ({
      repoUrl: typeof machineConfig.knowledgeBaseRepoUrl === 'string' ? machineConfig.knowledgeBaseRepoUrl : '',
      branch: typeof machineConfig.knowledgeBaseBranch === 'string' ? machineConfig.knowledgeBaseBranch : 'main',
      configured: typeof machineConfig.knowledgeBaseRepoUrl === 'string' && machineConfig.knowledgeBaseRepoUrl.length > 0,
      effectiveRoot: '/effective-vault',
      managedRoot: '/runtime/knowledge-base/repo',
      usesManagedRoot: typeof machineConfig.knowledgeBaseRepoUrl === 'string' && machineConfig.knowledgeBaseRepoUrl.length > 0,
      syncStatus: 'idle',
      recoveredEntryCount: 0,
      recoveryDir: '/runtime/knowledge-base/recovered',
    }));
    readMachineInstructionFilesMock.mockImplementation(() => [...((machineConfig.instructionFiles as string[] | undefined) ?? [])]);
    readMachineSkillDirsMock.mockImplementation(() => [...((machineConfig.skillDirs as string[] | undefined) ?? [])]);
    normalizeSavedModelPreferencesMock.mockReturnValue({
      currentModel: 'model-a',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
    });
    persistSettingsWriteMock.mockImplementation((write: (settingsFile: string) => unknown, options: { runtimeSettingsFile: string }) => write(options.runtimeSettingsFile));
    readModelProvidersStateMock.mockReturnValue({ providers: [] });
    readProviderAuthStateMock.mockReturnValue({ providers: [] });
    readSavedDefaultCwdPreferencesMock.mockReturnValue({ cwd: '/repo' });
    readSavedModelPreferencesMock.mockReturnValue({ currentModel: 'model-a', currentThinkingLevel: 'high', currentServiceTier: '' });
    setProviderApiKeyMock.mockReturnValue({ providers: [{ id: 'openai' }] });
    startProviderOAuthLoginMock.mockReturnValue({ id: 'login-1', status: 'pending' });
    submitProviderOAuthLoginInputMock.mockReturnValue({ id: 'login-1', status: 'waiting_input' });
    subscribeProviderOAuthLoginMock.mockImplementation(() => vi.fn());
    syncKnowledgeBaseNowMock.mockImplementation(() => readKnowledgeBaseStateMock());
    updateKnowledgeBaseMock.mockImplementation((input: { repoUrl?: string | null; branch?: string | null }) => {
      const next = { ...machineConfig };
      if (input.repoUrl !== undefined) {
        if (typeof input.repoUrl === 'string' && input.repoUrl.trim().length > 0) {
          next.knowledgeBaseRepoUrl = input.repoUrl.trim();
          next.knowledgeBaseBranch = typeof input.branch === 'string' && input.branch.trim().length > 0 ? input.branch.trim() : 'main';
        } else {
          delete next.knowledgeBaseRepoUrl;
          delete next.knowledgeBaseBranch;
        }
      } else if (typeof input.branch === 'string' && next.knowledgeBaseRepoUrl) {
        next.knowledgeBaseBranch = input.branch.trim() || 'main';
      }
      machineConfig = next;
      return readKnowledgeBaseStateMock();
    });
    writeMachineInstructionFilesMock.mockImplementation((instructionFiles: string[]) => {
      machineConfig = instructionFiles.length > 0 ? { ...machineConfig, instructionFiles: [...instructionFiles] } : (() => {
        const next = { ...machineConfig };
        delete next.instructionFiles;
        return next;
      })();
      return machineConfig;
    });
    writeMachineSkillDirsMock.mockImplementation((skillDirs: string[]) => {
      machineConfig = skillDirs.length > 0 ? { ...machineConfig, skillDirs: [...skillDirs] } : (() => {
        const next = { ...machineConfig };
        delete next.skillDirs;
        return next;
      })();
      return machineConfig;
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

  it('serves model state, returning only live models unless the registry throws', () => {
    const desktop = createDesktopHarness(allocateFiles());

    const desktopRes = createResponse();
    desktop.getHandler('/api/models')(createRequest(), desktopRes);

    expect(desktopRes.json).toHaveBeenCalledWith({
      currentModel: 'model-a',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      models: [{ id: 'model-a', provider: 'provider-a', name: 'Model A', context: 128_000, supportedServiceTiers: [] }],
    });

    getAvailableModelsMock.mockReturnValue([]);
    normalizeSavedModelPreferencesMock.mockReturnValue({
      currentModel: 'missing-model',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
    });

    const emptyRes = createResponse();
    desktop.getHandler('/api/models')(createRequest(), emptyRes);

    expect(emptyRes.json).toHaveBeenCalledWith({
      currentModel: '',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
      models: [],
    });

    getAvailableModelsMock.mockImplementation(() => {
      throw new Error('registry unavailable');
    });

    const fallbackRes = createResponse();
    desktop.getHandler('/api/models')(createRequest(), fallbackRes);

    expect(fallbackRes.json).toHaveBeenCalledWith(expect.objectContaining({
      currentModel: 'claude-opus-4-6',
      currentThinkingLevel: 'medium',
    }));
  });

  it('updates the current model, validates default cwd changes, and maps write failures', () => {
    const { getHandler, patchHandler } = createDesktopHarness(allocateFiles());

    const invalidModelRes = createResponse();
    patchHandler('/api/models/current')(createRequest({ body: {} }), invalidModelRes);
    expect(invalidModelRes.status).toHaveBeenCalledWith(400);
    expect(invalidModelRes.json).toHaveBeenCalledWith({ error: 'model, thinkingLevel, or serviceTier required' });

    const modelRes = createResponse();
    patchHandler('/api/models/current')(createRequest({ body: { model: 'model-b', thinkingLevel: 'medium' } }), modelRes);
    expect(writeSavedModelPreferencesMock).toHaveBeenCalledWith(
      { model: 'model-b', thinkingLevel: 'medium', serviceTier: undefined },
      expect.any(String),
      [{ id: 'model-a', provider: 'provider-a', name: 'Model A', context: 128_000, supportedServiceTiers: [] }],
    );
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

  it('reads, updates, and syncs the managed knowledge base repo state', () => {
    const { patchHandler, getHandler, postHandler, materializeWebProfile } = createDesktopHarness(allocateFiles());

    const readRes = createResponse();
    getHandler('/api/knowledge-base')(createRequest(), readRes);
    expect(readRes.json).toHaveBeenCalledWith(expect.objectContaining({
      repoUrl: '',
      branch: 'main',
      configured: false,
      managedRoot: '/runtime/knowledge-base/repo',
    }));

    const invalidRepoUrlRes = createResponse();
    patchHandler('/api/knowledge-base')(createRequest({ body: { repoUrl: 123 } }), invalidRepoUrlRes);
    expect(invalidRepoUrlRes.status).toHaveBeenCalledWith(400);
    expect(invalidRepoUrlRes.json).toHaveBeenCalledWith({ error: 'repoUrl must be a string or null' });

    const invalidBranchRes = createResponse();
    patchHandler('/api/knowledge-base')(createRequest({ body: { repoUrl: 'https://github.com/patleeman/kb.git', branch: 123 } }), invalidBranchRes);
    expect(invalidBranchRes.status).toHaveBeenCalledWith(400);
    expect(invalidBranchRes.json).toHaveBeenCalledWith({ error: 'branch must be a string or null' });

    const saveRes = createResponse();
    patchHandler('/api/knowledge-base')(createRequest({ body: { repoUrl: 'https://github.com/patleeman/kb.git', branch: 'trunk' } }), saveRes);
    expect(updateKnowledgeBaseMock).toHaveBeenCalledWith({ repoUrl: 'https://github.com/patleeman/kb.git', branch: 'trunk' });
    expect(materializeWebProfile).toHaveBeenCalledWith('shared');
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('knowledgeBase');
    expect(saveRes.json).toHaveBeenCalledWith(expect.objectContaining({
      repoUrl: 'https://github.com/patleeman/kb.git',
      branch: 'trunk',
      configured: true,
    }));

    const syncRes = createResponse();
    postHandler('/api/knowledge-base/sync')(createRequest(), syncRes);
    expect(syncKnowledgeBaseNowMock).toHaveBeenCalledTimes(1);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('knowledgeBase');
    expect(syncRes.json).toHaveBeenCalledWith(expect.objectContaining({
      repoUrl: 'https://github.com/patleeman/kb.git',
      branch: 'trunk',
    }));
  });

  it('reads and writes skill folder state with filesystem validation', () => {
    const { patchHandler, getHandler, materializeWebProfile } = createDesktopHarness(allocateFiles());
    const validDir = mkdtempSync(join(tmpdir(), 'pa-skill-folders-'));
    const skillDirA = join(validDir, 'skills-a');
    const skillDirB = join(validDir, 'skills-b');
    const missingDir = join(validDir, 'missing');
    const invalidFile = join(validDir, 'not-a-dir.txt');
    mkdirSync(skillDirA, { recursive: true });
    mkdirSync(skillDirB, { recursive: true });
    writeFileSync(invalidFile, 'nope');

    machineConfig.skillDirs = [skillDirA];
    const readRes = createResponse();
    getHandler('/api/skill-folders')(createRequest(), readRes);
    expect(readRes.json).toHaveBeenCalledWith({
      configFile: '/config/config.json',
      skillDirs: [skillDirA],
    });

    const invalidRes = createResponse();
    patchHandler('/api/skill-folders')(createRequest({ body: { skillDirs: 'bad' } }), invalidRes);
    expect(invalidRes.status).toHaveBeenCalledWith(400);
    expect(invalidRes.json).toHaveBeenCalledWith({ error: 'skillDirs must be an array of strings' });

    const missingRes = createResponse();
    patchHandler('/api/skill-folders')(createRequest({ body: { skillDirs: [missingDir] } }), missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(400);
    expect(missingRes.json).toHaveBeenCalledWith({ error: `Directory does not exist: ${missingDir}` });

    const fileRes = createResponse();
    patchHandler('/api/skill-folders')(createRequest({ body: { skillDirs: [invalidFile] } }), fileRes);
    expect(fileRes.status).toHaveBeenCalledWith(400);
    expect(fileRes.json).toHaveBeenCalledWith({ error: `Not a directory: ${invalidFile}` });

    const saveRes = createResponse();
    patchHandler('/api/skill-folders')(createRequest({ body: { skillDirs: [skillDirA, skillDirB] } }), saveRes);
    expect(writeMachineSkillDirsMock).toHaveBeenCalledWith([skillDirA, skillDirB]);
    expect(materializeWebProfile).toHaveBeenCalledWith('shared');
    expect(saveRes.json).toHaveBeenCalledWith({
      configFile: '/config/config.json',
      skillDirs: [skillDirA, skillDirB],
    });
  });

  it('reads and writes instruction file state with filesystem validation', () => {
    const { patchHandler, getHandler, materializeWebProfile } = createDesktopHarness(allocateFiles());
    const validDir = mkdtempSync(join(tmpdir(), 'pa-instruction-files-'));
    const instructionA = join(validDir, 'AGENTS.md');
    const instructionB = join(validDir, 'custom.md');
    const missingFile = join(validDir, 'missing.md');
    writeFileSync(instructionA, '# Base\n');
    writeFileSync(instructionB, '# Custom\n');

    machineConfig.instructionFiles = [instructionA];
    const readRes = createResponse();
    getHandler('/api/instructions')(createRequest(), readRes);
    expect(readRes.json).toHaveBeenCalledWith({
      configFile: '/config/config.json',
      instructionFiles: [instructionA],
    });

    const invalidRes = createResponse();
    patchHandler('/api/instructions')(createRequest({ body: { instructionFiles: 'bad' } }), invalidRes);
    expect(invalidRes.status).toHaveBeenCalledWith(400);
    expect(invalidRes.json).toHaveBeenCalledWith({ error: 'instructionFiles must be an array of strings' });

    const missingRes = createResponse();
    patchHandler('/api/instructions')(createRequest({ body: { instructionFiles: [missingFile] } }), missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(400);
    expect(missingRes.json).toHaveBeenCalledWith({ error: `File does not exist: ${missingFile}` });

    const saveRes = createResponse();
    patchHandler('/api/instructions')(createRequest({ body: { instructionFiles: [instructionA, instructionB] } }), saveRes);
    expect(writeMachineInstructionFilesMock).toHaveBeenCalledWith([instructionA, instructionB]);
    expect(materializeWebProfile).toHaveBeenCalledWith('shared');
    expect(saveRes.json).toHaveBeenCalledWith({
      configFile: '/config/config.json',
      instructionFiles: [instructionA, instructionB],
    });
  });

  it('reads conversation plan workspace state through the shared settings helpers', () => {
    const { files, getHandler } = createDesktopHarness(allocateFiles());

    writeFileSync(files.settingsFile, JSON.stringify({
      ui: {
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
    expect(readModelProvidersStateMock).toHaveBeenCalledWith('shared');
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
    expect(upsertModelProviderMock).toHaveBeenCalledWith('shared', 'openrouter', expect.objectContaining({
      apiKey: 'secret',
      baseUrl: 'https://openrouter.ai',
    }));
    expect(materializeWebProfile).toHaveBeenCalledWith('shared');
    expect(refreshAllLiveSessionModelRegistriesMock).toHaveBeenCalled();
    expect(createRes.json).toHaveBeenCalledWith({ providers: [{ id: 'openrouter' }] });

    const invalidDeleteProviderRes = createResponse();
    deleteHandler('/api/model-providers/providers/:provider')(createRequest({ params: { provider: ' ' } }), invalidDeleteProviderRes);
    expect(invalidDeleteProviderRes.status).toHaveBeenCalledWith(400);
    expect(invalidDeleteProviderRes.json).toHaveBeenCalledWith({ error: 'provider required' });

    const deleteProviderRes = createResponse();
    deleteHandler('/api/model-providers/providers/:provider')(createRequest({ params: { provider: 'openrouter' } }), deleteProviderRes);
    expect(removeModelProviderMock).toHaveBeenCalledWith('shared', 'openrouter');
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
    expect(upsertModelProviderModelMock).toHaveBeenCalledWith('shared', 'openrouter', 'model-b', expect.objectContaining({
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
    expect(removeModelProviderModelMock).toHaveBeenCalledWith('shared', 'openrouter', 'model-b');
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
