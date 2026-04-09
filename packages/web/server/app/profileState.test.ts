import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getProfilesRootMock,
  getStateRootMock,
  listProfilesMock,
  materializeProfileToAgentDirMock,
  resolveProfileSettingsFilePathMock,
  resolveResourceProfileMock,
  createActivityAgentExtensionMock,
  createArtifactAgentExtensionMock,
  createAskUserQuestionAgentExtensionMock,
  createChangeWorkingDirectoryAgentExtensionMock,
  createDeferredResumeAgentExtensionMock,
  createReminderAgentExtensionMock,
  createRunAgentExtensionMock,
  createScheduledTaskAgentExtensionMock,
  requestConversationWorkingDirectoryChangeMock,
  clearMemoryBrowserCachesMock,
  warmMemoryBrowserCachesMock,
  invalidateAppTopicsMock,
  readSavedProfilePreferencesMock,
  resolveActiveProfileMock,
  writeSavedProfilePreferencesMock,
} = vi.hoisted(() => ({
  getProfilesRootMock: vi.fn(() => '/profiles-root'),
  getStateRootMock: vi.fn(() => '/state-root'),
  listProfilesMock: vi.fn(() => ['assistant', 'other']),
  materializeProfileToAgentDirMock: vi.fn(),
  resolveProfileSettingsFilePathMock: vi.fn((profile: string) => `/profiles/${profile}/settings.json`),
  resolveResourceProfileMock: vi.fn(),
  createActivityAgentExtensionMock: vi.fn(() => 'activity-extension'),
  createArtifactAgentExtensionMock: vi.fn(() => 'artifact-extension'),
  createAskUserQuestionAgentExtensionMock: vi.fn(() => 'ask-user-question-extension'),
  createChangeWorkingDirectoryAgentExtensionMock: vi.fn(() => 'change-working-directory-extension'),
  createDeferredResumeAgentExtensionMock: vi.fn(() => 'deferred-resume-extension'),
  createReminderAgentExtensionMock: vi.fn(() => 'reminder-extension'),
  createRunAgentExtensionMock: vi.fn(() => 'run-extension'),
  createScheduledTaskAgentExtensionMock: vi.fn(() => 'scheduled-task-extension'),
  requestConversationWorkingDirectoryChangeMock: vi.fn(),
  clearMemoryBrowserCachesMock: vi.fn(),
  warmMemoryBrowserCachesMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  readSavedProfilePreferencesMock: vi.fn(() => ({ defaultProfile: 'assistant' })),
  resolveActiveProfileMock: vi.fn(({ explicitProfile, savedProfile }: { explicitProfile?: string; savedProfile?: string }) => explicitProfile ?? savedProfile ?? 'assistant'),
  writeSavedProfilePreferencesMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  getProfilesRoot: getProfilesRootMock,
  getStateRoot: getStateRootMock,
}));

vi.mock('@personal-agent/resources', () => ({
  listProfiles: listProfilesMock,
  materializeProfileToAgentDir: materializeProfileToAgentDirMock,
  resolveProfileSettingsFilePath: resolveProfileSettingsFilePathMock,
  resolveResourceProfile: resolveResourceProfileMock,
}));

vi.mock('../extensions/activityAgentExtension.js', () => ({
  createActivityAgentExtension: createActivityAgentExtensionMock,
}));

vi.mock('../extensions/artifactAgentExtension.js', () => ({
  createArtifactAgentExtension: createArtifactAgentExtensionMock,
}));

vi.mock('../extensions/askUserQuestionAgentExtension.js', () => ({
  createAskUserQuestionAgentExtension: createAskUserQuestionAgentExtensionMock,
}));

vi.mock('../extensions/changeWorkingDirectoryAgentExtension.js', () => ({
  createChangeWorkingDirectoryAgentExtension: createChangeWorkingDirectoryAgentExtensionMock,
}));

vi.mock('../extensions/deferredResumeAgentExtension.js', () => ({
  createDeferredResumeAgentExtension: createDeferredResumeAgentExtensionMock,
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

vi.mock('../conversations/liveSessions.js', () => ({
  requestConversationWorkingDirectoryChange: requestConversationWorkingDirectoryChangeMock,
}));

vi.mock('../knowledge/memoryDocs.js', () => ({
  clearMemoryBrowserCaches: clearMemoryBrowserCachesMock,
  warmMemoryBrowserCaches: warmMemoryBrowserCachesMock,
}));

vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

vi.mock('../ui/profilePreferences.js', () => ({
  readSavedProfilePreferences: readSavedProfilePreferencesMock,
  resolveActiveProfile: resolveActiveProfileMock,
  writeSavedProfilePreferences: writeSavedProfilePreferencesMock,
}));

import { createProfileState } from './profileState.js';

const resolvedProfiles = {
  assistant: {
    extensionEntries: ['/ext/shared', '/ext/assistant'],
    skillDirs: ['/skills/shared', '/skills/assistant', '/skills/shared'],
    promptEntries: ['/prompts/assistant.md'],
    themeEntries: ['/themes/assistant.json'],
  },
  other: {
    extensionEntries: ['/ext/shared', '/ext/other'],
    skillDirs: ['/skills/shared', '/skills/other'],
    promptEntries: ['/prompts/other.md'],
    themeEntries: ['/themes/other.json'],
  },
} as const;

function createLogger() {
  return {
    warn: vi.fn(),
  };
}

describe('createProfileState', () => {
  beforeEach(() => {
    getProfilesRootMock.mockClear();
    getStateRootMock.mockClear();
    listProfilesMock.mockClear();
    materializeProfileToAgentDirMock.mockReset();
    resolveProfileSettingsFilePathMock.mockClear();
    resolveResourceProfileMock.mockReset();
    resolveResourceProfileMock.mockImplementation((profile: string) => {
      const resolved = resolvedProfiles[profile as keyof typeof resolvedProfiles];
      if (!resolved) {
        throw new Error(`missing resolved profile: ${profile}`);
      }
      return resolved;
    });
    createActivityAgentExtensionMock.mockClear();
    createArtifactAgentExtensionMock.mockClear();
    createAskUserQuestionAgentExtensionMock.mockClear();
    createChangeWorkingDirectoryAgentExtensionMock.mockClear();
    createDeferredResumeAgentExtensionMock.mockClear();
    createReminderAgentExtensionMock.mockClear();
    createRunAgentExtensionMock.mockClear();
    createScheduledTaskAgentExtensionMock.mockClear();
    requestConversationWorkingDirectoryChangeMock.mockReset();
    clearMemoryBrowserCachesMock.mockReset();
    warmMemoryBrowserCachesMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    readSavedProfilePreferencesMock.mockReset();
    readSavedProfilePreferencesMock.mockReturnValue({ defaultProfile: 'assistant' });
    resolveActiveProfileMock.mockReset();
    resolveActiveProfileMock.mockImplementation(({ explicitProfile, savedProfile }: { explicitProfile?: string; savedProfile?: string }) => explicitProfile ?? savedProfile ?? 'assistant');
    writeSavedProfilePreferencesMock.mockReset();
    delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;
    delete process.env.PERSONAL_AGENT_PROFILE;
    delete process.env.PERSONAL_AGENT_REPO_ROOT;
  });

  it('materializes the initial profile and builds live session helpers', async () => {
    const logger = createLogger();
    const state = createProfileState({
      repoRoot: '/repo-root',
      agentDir: '/agent-dir',
      profileConfigFile: '/config/profile.json',
      logger,
    });

    expect(listProfilesMock).toHaveBeenCalledWith({
      repoRoot: '/repo-root',
      profilesRoot: '/profiles-root',
    });
    expect(materializeProfileToAgentDirMock).toHaveBeenCalledWith(resolvedProfiles.assistant, '/agent-dir');
    expect(state.getCurrentProfile()).toBe('assistant');
    expect(state.listAvailableProfiles()).toEqual(['assistant', 'other']);
    expect(process.env.PERSONAL_AGENT_ACTIVE_PROFILE).toBe('assistant');
    expect(process.env.PERSONAL_AGENT_PROFILE).toBe('assistant');
    expect(process.env.PERSONAL_AGENT_REPO_ROOT).toBe('/repo-root');

    expect(state.getCurrentProfileSettingsFile()).toBe('/profiles/assistant/settings.json');
    expect(resolveProfileSettingsFilePathMock).toHaveBeenCalledWith('assistant', {
      repoRoot: '/repo-root',
      profilesRoot: '/profiles-root',
    });

    expect(state.buildLiveSessionResourceOptions()).toEqual({
      additionalExtensionPaths: ['/ext/shared', '/ext/assistant'],
      additionalSkillPaths: ['/skills/shared', '/skills/assistant'],
      additionalPromptTemplatePaths: ['/prompts/assistant.md'],
      additionalThemePaths: ['/themes/assistant.json'],
    });
    expect(state.buildLiveSessionResourceOptions('other')).toEqual({
      additionalExtensionPaths: ['/ext/shared', '/ext/other'],
      additionalSkillPaths: ['/skills/shared', '/skills/other'],
      additionalPromptTemplatePaths: ['/prompts/other.md'],
      additionalThemePaths: ['/themes/other.json'],
    });

    expect(state.buildLiveSessionExtensionFactories()).toEqual([
      'scheduled-task-extension',
      'activity-extension',
      'ask-user-question-extension',
      'change-working-directory-extension',
      'run-extension',
      'artifact-extension',
      'deferred-resume-extension',
      'reminder-extension',
    ]);
    expect(createScheduledTaskAgentExtensionMock).toHaveBeenCalledWith({
      getCurrentProfile: expect.any(Function),
    });
    expect(createActivityAgentExtensionMock).toHaveBeenCalledWith({
      stateRoot: '/state-root',
      getCurrentProfile: expect.any(Function),
    });
    expect(createRunAgentExtensionMock).toHaveBeenCalledWith({
      getCurrentProfile: expect.any(Function),
      repoRoot: '/repo-root',
      profilesRoot: '/profiles-root',
    });
    expect(createArtifactAgentExtensionMock).toHaveBeenCalledWith({
      stateRoot: '/state-root',
      repoRoot: '/repo-root',
      getCurrentProfile: expect.any(Function),
    });

    const changeWorkingDirectoryOptions = createChangeWorkingDirectoryAgentExtensionMock.mock.calls[0]?.[0] as {
      requestConversationWorkingDirectoryChange: (input: Record<string, unknown>) => Promise<unknown>;
    };
    requestConversationWorkingDirectoryChangeMock.mockResolvedValueOnce({ ok: true });
    await expect(changeWorkingDirectoryOptions.requestConversationWorkingDirectoryChange({
      conversationId: 'conv-1',
      cwd: '/next-cwd',
    })).resolves.toEqual({ ok: true });
    expect(requestConversationWorkingDirectoryChangeMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      cwd: '/next-cwd',
    }, {
      additionalExtensionPaths: ['/ext/shared', '/ext/assistant'],
      additionalSkillPaths: ['/skills/shared', '/skills/assistant'],
      additionalPromptTemplatePaths: ['/prompts/assistant.md'],
      additionalThemePaths: ['/themes/assistant.json'],
      extensionFactories: [
        'scheduled-task-extension',
        'activity-extension',
        'ask-user-question-extension',
        'change-working-directory-extension',
        'run-extension',
        'artifact-extension',
        'deferred-resume-extension',
        'reminder-extension',
      ],
    });

    let temporaryAgentDir = '';
    await expect(state.withTemporaryProfileAgentDir('other', async (profileAgentDir) => {
      temporaryAgentDir = profileAgentDir;
      expect(existsSync(profileAgentDir)).toBe(true);
      return 'done';
    })).resolves.toBe('done');
    expect(materializeProfileToAgentDirMock).toHaveBeenCalledWith(resolvedProfiles.other, temporaryAgentDir);
    expect(existsSync(temporaryAgentDir)).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs initial materialization failures and updates state on profile changes', async () => {
    materializeProfileToAgentDirMock.mockImplementationOnce(() => {
      throw new Error('initial materialize failed');
    });

    const logger = createLogger();
    const onProfileChanged = vi.fn();
    const state = createProfileState({
      repoRoot: '/repo-root',
      agentDir: '/agent-dir',
      profileConfigFile: '/config/profile.json',
      logger,
      onProfileChanged,
    });

    expect(logger.warn).toHaveBeenCalledWith('failed to materialize initial profile', {
      profile: 'assistant',
      message: 'initial materialize failed',
    });

    await expect(state.setCurrentProfile('missing')).rejects.toThrow('Unknown profile: missing');

    await expect(state.setCurrentProfile('assistant')).resolves.toBe('assistant');
    expect(writeSavedProfilePreferencesMock).not.toHaveBeenCalled();
    expect(clearMemoryBrowserCachesMock).not.toHaveBeenCalled();
    expect(warmMemoryBrowserCachesMock).not.toHaveBeenCalled();
    expect(onProfileChanged).not.toHaveBeenCalled();
    expect(invalidateAppTopicsMock).not.toHaveBeenCalled();

    await expect(state.setCurrentProfile('other')).resolves.toBe('other');
    expect(materializeProfileToAgentDirMock).toHaveBeenCalledWith(resolvedProfiles.other, '/agent-dir');
    expect(writeSavedProfilePreferencesMock).toHaveBeenCalledWith('other', '/config/profile.json');
    expect(clearMemoryBrowserCachesMock).toHaveBeenCalledTimes(1);
    expect(warmMemoryBrowserCachesMock).toHaveBeenCalledWith('other');
    expect(onProfileChanged).toHaveBeenCalledWith('other');
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith(
      'activity',
      'alerts',
      'sessions',
      'tasks',
      'runs',
      'daemon',
      'webUi',
    );
    expect(process.env.PERSONAL_AGENT_ACTIVE_PROFILE).toBe('other');
    expect(process.env.PERSONAL_AGENT_PROFILE).toBe('other');
  });
});
