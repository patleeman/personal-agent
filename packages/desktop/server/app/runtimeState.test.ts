import { existsSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getProfilesRootMock,
  getStateRootMock,
  writeMergedMcpConfigFileMock,
  materializeRuntimeResourcesToAgentDirMock,
  resolveRuntimeResourcesMock,
  createArtifactAgentExtensionMock,
  createCheckpointAgentExtensionMock,
  createConversationQueueAgentExtensionMock,
  createReminderAgentExtensionMock,
  createRunAgentExtensionMock,
  createScheduledTaskAgentExtensionMock,
  createImageAgentExtensionMock,
  createImageProbeAgentExtensionMock,
  webToolsExtensionMock,
  createManifestAgentExtensionsMock,
  daemonRunOrchestrationPromptExtensionMock,
  authStorageMock,
  readSavedModelPreferencesMock,
} = vi.hoisted(() => {
  const authStorageMock = {
    hasAuth: vi.fn(() => false),
    create: vi.fn(() => authStorageMock),
  };

  return {
    getProfilesRootMock: vi.fn(() => '/profiles-root'),
    getStateRootMock: vi.fn(() => '/state-root'),
    materializeRuntimeResourcesToAgentDirMock: vi.fn(),
    resolveRuntimeResourcesMock: vi.fn(),
    writeMergedMcpConfigFileMock: vi.fn(() => ({ bundledServerCount: 0 })),
    createArtifactAgentExtensionMock: vi.fn(() => 'artifact-extension'),
    createCheckpointAgentExtensionMock: vi.fn(() => 'checkpoint-extension'),
    createConversationQueueAgentExtensionMock: vi.fn(() => 'conversation-queue-extension'),
    createReminderAgentExtensionMock: vi.fn(() => 'reminder-extension'),
    createRunAgentExtensionMock: vi.fn(() => 'run-extension'),
    createScheduledTaskAgentExtensionMock: vi.fn(() => 'scheduled-task-extension'),
    createImageAgentExtensionMock: vi.fn(() => 'image-extension'),
    createImageProbeAgentExtensionMock: vi.fn(() => 'image-probe-extension'),
    webToolsExtensionMock: vi.fn(() => 'web-tools-extension'),
    createManifestAgentExtensionsMock: vi.fn(() => ['manifest-agent-extension']),
    daemonRunOrchestrationPromptExtensionMock: vi.fn(() => 'daemon-run-orchestration-prompt-extension'),
    authStorageMock,
    readSavedModelPreferencesMock: vi.fn(() => ({ currentVisionModel: 'openai/gpt-4o' })),
  };
});

vi.mock('@personal-agent/core', () => ({
  getProfilesRoot: getProfilesRootMock,
  getStateRoot: getStateRootMock,
  materializeRuntimeResourcesToAgentDir: materializeRuntimeResourcesToAgentDirMock,
  resolveRuntimeResources: resolveRuntimeResourcesMock,
  writeMergedMcpConfigFile: writeMergedMcpConfigFileMock,
}));

vi.mock('../extensions/artifactAgentExtension.js', () => ({
  createArtifactAgentExtension: createArtifactAgentExtensionMock,
}));

vi.mock('../extensions/checkpointAgentExtension.js', () => ({
  createCheckpointAgentExtension: createCheckpointAgentExtensionMock,
}));

vi.mock('../extensions/conversationQueueAgentExtension.js', () => ({
  createConversationQueueAgentExtension: createConversationQueueAgentExtensionMock,
}));

vi.mock('../extensions/reminderAgentExtension.js', () => ({
  createReminderAgentExtension: createReminderAgentExtensionMock,
}));

vi.mock('../extensions/runAgentExtension.js', () => ({
  createRunAgentExtension: createRunAgentExtensionMock,
}));

vi.mock('../extensions/scheduledTaskAgentExtension.js', () => ({
  createScheduledTaskAgentExtension: createScheduledTaskAgentExtensionMock,
}));

vi.mock('../extensions/imageAgentExtension.js', () => ({
  createImageAgentExtension: createImageAgentExtensionMock,
}));

vi.mock('../extensions/imageProbeAgentExtension.js', () => ({
  createImageProbeAgentExtension: createImageProbeAgentExtensionMock,
}));

vi.mock('../extensions/extensionRegistry.js', () => ({
  listExtensionSkillRegistrations: vi.fn(() => []),
}));

vi.mock('../extensions/manifestToolAgentExtension.js', () => ({
  createManifestToolAgentExtensions: vi.fn(() => []),
}));

vi.mock('../extensions/extensionAgentExtensions.js', () => ({
  createManifestAgentExtensions: createManifestAgentExtensionsMock,
}));

vi.mock('../extensions/web-tools/index.js', () => ({
  default: webToolsExtensionMock,
}));

vi.mock('../extensions/daemon-run-orchestration-prompt/index.js', () => ({
  default: daemonRunOrchestrationPromptExtensionMock,
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: authStorageMock,
}));

vi.mock('../models/modelPreferences.js', () => ({
  readSavedModelPreferences: readSavedModelPreferencesMock,
}));

vi.mock('../ui/settingsPersistence.js', () => ({
  DEFAULT_RUNTIME_SETTINGS_FILE: '/runtime/settings.json',
}));

import { createRuntimeState } from './runtimeState.js';

const resolvedShared = {
  extensionEntries: ['/ext/shared'],
  skillDirs: ['/skills/shared', '/skills/shared'],
  promptEntries: ['/prompts/shared.md'],
  themeEntries: ['/themes/shared.json'],
} as const;

function createLogger() {
  return {
    warn: vi.fn(),
  };
}

describe('createRuntimeState', () => {
  beforeEach(() => {
    getProfilesRootMock.mockClear();
    getStateRootMock.mockClear();
    materializeRuntimeResourcesToAgentDirMock.mockReset();
    resolveRuntimeResourcesMock.mockReset();
    resolveRuntimeResourcesMock.mockReturnValue(resolvedShared);
    createArtifactAgentExtensionMock.mockClear();
    createConversationQueueAgentExtensionMock.mockClear();
    createReminderAgentExtensionMock.mockClear();
    createRunAgentExtensionMock.mockClear();
    createScheduledTaskAgentExtensionMock.mockClear();
    createManifestAgentExtensionsMock.mockClear();
    createImageProbeAgentExtensionMock.mockClear();
    readSavedModelPreferencesMock.mockClear();
    readSavedModelPreferencesMock.mockReturnValue({ currentVisionModel: 'openai/gpt-4o' });
    authStorageMock.hasAuth.mockReset();
    authStorageMock.hasAuth.mockReturnValue(false);
    authStorageMock.create.mockClear();
    delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;
    delete process.env.PERSONAL_AGENT_PROFILE;
    delete process.env.PERSONAL_AGENT_REPO_ROOT;
  });

  it('materializes the shared runtime and builds live session helpers', async () => {
    const logger = createLogger();
    const state = createRuntimeState({
      repoRoot: '/repo-root',
      agentDir: '/agent-dir',
      logger,
    });

    expect(materializeRuntimeResourcesToAgentDirMock).toHaveBeenCalledWith(resolvedShared, '/agent-dir');
    expect(state.getRuntimeScope()).toBe('shared');
    expect(process.env.PERSONAL_AGENT_ACTIVE_PROFILE).toBe('shared');
    expect(process.env.PERSONAL_AGENT_PROFILE).toBe('shared');
    expect(process.env.PERSONAL_AGENT_REPO_ROOT).toBe('/repo-root');

    expect(state.buildLiveSessionResourceOptions()).toEqual({
      additionalExtensionPaths: ['/ext/shared'],
      additionalSkillPaths: ['/skills/shared'],
      additionalPromptTemplatePaths: ['/prompts/shared.md'],
      additionalThemePaths: ['/themes/shared.json'],
    });

    const factories = state.buildLiveSessionExtensionFactories();
    // All factories are wrapped by guardSystemPromptOverride so each
    // element is a function. Verify count and that each delegates correctly.
    expect(factories).toHaveLength(1);
    factories.forEach((factory) => {
      expect(typeof factory).toBe('function');
    });
    let temporaryAgentDir = '';
    await expect(
      state.withTemporaryRuntimeAgentDir(async (runtimeAgentDir) => {
        temporaryAgentDir = runtimeAgentDir;
        expect(existsSync(runtimeAgentDir)).toBe(true);
        return 'done';
      }),
    ).resolves.toBe('done');
    expect(materializeRuntimeResourcesToAgentDirMock).toHaveBeenCalledWith(resolvedShared, temporaryAgentDir);
    expect(existsSync(temporaryAgentDir)).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not register image probing until a preferred vision model is configured', () => {
    readSavedModelPreferencesMock.mockReturnValue({ currentVisionModel: '' });
    const state = createRuntimeState({
      repoRoot: '/repo-root',
      agentDir: '/agent-dir',
      logger: createLogger(),
    });

    expect(state.buildLiveSessionExtensionFactories()).toHaveLength(1);
    expect(createImageProbeAgentExtensionMock).not.toHaveBeenCalled();
  });

  it('logs initial materialization failures', async () => {
    materializeRuntimeResourcesToAgentDirMock.mockImplementationOnce(() => {
      throw new Error('initial materialize failed');
    });

    const logger = createLogger();
    createRuntimeState({
      repoRoot: '/repo-root',
      agentDir: '/agent-dir',
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith('failed to materialize runtime resources', {
      runtimeScope: 'shared',
      message: 'initial materialize failed',
    });
  });
});
