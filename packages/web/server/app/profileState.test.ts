import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getProfilesRootMock,
  getStateRootMock,
  writeMergedMcpConfigFileMock,
  materializeProfileToAgentDirMock,
  resolveResourceProfileMock,
  createArtifactAgentExtensionMock,
  createCheckpointAgentExtensionMock,
  createAskUserQuestionAgentExtensionMock,
  createChangeWorkingDirectoryAgentExtensionMock,
  createConversationAutoModeAgentExtensionMock,
  createConversationInspectAgentExtensionMock,
  createConversationQueueAgentExtensionMock,
  createReminderAgentExtensionMock,
  createRunAgentExtensionMock,
  createScheduledTaskAgentExtensionMock,
  createWorkbenchBrowserAgentExtensionMock,
  requestConversationWorkingDirectoryChangeMock,
} = vi.hoisted(() => ({
  getProfilesRootMock: vi.fn(() => '/profiles-root'),
  getStateRootMock: vi.fn(() => '/state-root'),
  materializeProfileToAgentDirMock: vi.fn(),
  resolveResourceProfileMock: vi.fn(),
  writeMergedMcpConfigFileMock: vi.fn(() => ({ bundledServerCount: 0 })),
  createArtifactAgentExtensionMock: vi.fn(() => 'artifact-extension'),
  createCheckpointAgentExtensionMock: vi.fn(() => 'checkpoint-extension'),
  createAskUserQuestionAgentExtensionMock: vi.fn(() => 'ask-user-question-extension'),
  createChangeWorkingDirectoryAgentExtensionMock: vi.fn(() => 'change-working-directory-extension'),
  createConversationAutoModeAgentExtensionMock: vi.fn(() => 'conversation-auto-mode-extension'),
  createConversationInspectAgentExtensionMock: vi.fn(() => 'conversation-inspect-extension'),
  createConversationQueueAgentExtensionMock: vi.fn(() => 'conversation-queue-extension'),
  createReminderAgentExtensionMock: vi.fn(() => 'reminder-extension'),
  createRunAgentExtensionMock: vi.fn(() => 'run-extension'),
  createScheduledTaskAgentExtensionMock: vi.fn(() => 'scheduled-task-extension'),
  createWorkbenchBrowserAgentExtensionMock: vi.fn(() => 'workbench-browser-extension'),
  requestConversationWorkingDirectoryChangeMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  getProfilesRoot: getProfilesRootMock,
  getStateRoot: getStateRootMock,
  materializeProfileToAgentDir: materializeProfileToAgentDirMock,
  resolveResourceProfile: resolveResourceProfileMock,
  writeMergedMcpConfigFile: writeMergedMcpConfigFileMock,
}));

vi.mock('../extensions/artifactAgentExtension.js', () => ({
  createArtifactAgentExtension: createArtifactAgentExtensionMock,
}));

vi.mock('../extensions/checkpointAgentExtension.js', () => ({
  createCheckpointAgentExtension: createCheckpointAgentExtensionMock,
}));

vi.mock('../extensions/askUserQuestionAgentExtension.js', () => ({
  createAskUserQuestionAgentExtension: createAskUserQuestionAgentExtensionMock,
}));

vi.mock('../extensions/changeWorkingDirectoryAgentExtension.js', () => ({
  createChangeWorkingDirectoryAgentExtension: createChangeWorkingDirectoryAgentExtensionMock,
}));

vi.mock('../extensions/conversationAutoModeAgentExtension.js', () => ({
  createConversationAutoModeAgentExtension: createConversationAutoModeAgentExtensionMock,
}));

vi.mock('../extensions/conversationQueueAgentExtension.js', () => ({
  createConversationQueueAgentExtension: createConversationQueueAgentExtensionMock,
}));

vi.mock('../extensions/conversationInspectAgentExtension.js', () => ({
  createConversationInspectAgentExtension: createConversationInspectAgentExtensionMock,
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

vi.mock('../extensions/workbenchBrowserAgentExtension.js', () => ({
  createWorkbenchBrowserAgentExtension: createWorkbenchBrowserAgentExtensionMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  requestConversationWorkingDirectoryChange: requestConversationWorkingDirectoryChangeMock,
}));

import { createProfileState } from './profileState.js';

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

describe('createProfileState', () => {
  beforeEach(() => {
    getProfilesRootMock.mockClear();
    getStateRootMock.mockClear();
    materializeProfileToAgentDirMock.mockReset();
    resolveResourceProfileMock.mockReset();
    resolveResourceProfileMock.mockReturnValue(resolvedShared);
    createArtifactAgentExtensionMock.mockClear();
    createAskUserQuestionAgentExtensionMock.mockClear();
    createChangeWorkingDirectoryAgentExtensionMock.mockClear();
    createConversationAutoModeAgentExtensionMock.mockClear();
    createConversationInspectAgentExtensionMock.mockClear();
    createConversationQueueAgentExtensionMock.mockClear();
    createReminderAgentExtensionMock.mockClear();
    createRunAgentExtensionMock.mockClear();
    createScheduledTaskAgentExtensionMock.mockClear();
    createWorkbenchBrowserAgentExtensionMock.mockClear();
    requestConversationWorkingDirectoryChangeMock.mockReset();
    delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;
    delete process.env.PERSONAL_AGENT_PROFILE;
    delete process.env.PERSONAL_AGENT_REPO_ROOT;
  });

  it('materializes the shared runtime and builds live session helpers', async () => {
    const logger = createLogger();
    const state = createProfileState({
      repoRoot: '/repo-root',
      agentDir: '/agent-dir',
      logger,
    });

    expect(materializeProfileToAgentDirMock).toHaveBeenCalledWith(resolvedShared, '/agent-dir');
    expect(state.getCurrentProfile()).toBe('shared');
    expect(process.env.PERSONAL_AGENT_ACTIVE_PROFILE).toBe('shared');
    expect(process.env.PERSONAL_AGENT_PROFILE).toBe('shared');
    expect(process.env.PERSONAL_AGENT_REPO_ROOT).toBe('/repo-root');

    expect(state.buildLiveSessionResourceOptions()).toEqual({
      additionalExtensionPaths: ['/ext/shared'],
      additionalSkillPaths: ['/skills/shared'],
      additionalPromptTemplatePaths: ['/prompts/shared.md'],
      additionalThemePaths: ['/themes/shared.json'],
    });

    expect(state.buildLiveSessionExtensionFactories()).toEqual([
      'scheduled-task-extension',
      'ask-user-question-extension',
      'change-working-directory-extension',
      'run-extension',
      'conversation-inspect-extension',
      expect.any(Function),
      'artifact-extension',
      'checkpoint-extension',
      'workbench-browser-extension',
      'conversation-auto-mode-extension',
      'conversation-queue-extension',
      'reminder-extension',
    ]);
    expect(createScheduledTaskAgentExtensionMock).toHaveBeenCalledWith({
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
      additionalExtensionPaths: ['/ext/shared'],
      additionalSkillPaths: ['/skills/shared'],
      additionalPromptTemplatePaths: ['/prompts/shared.md'],
      additionalThemePaths: ['/themes/shared.json'],
      extensionFactories: expect.any(Array),
    });

    let temporaryAgentDir = '';
    await expect(state.withTemporaryProfileAgentDir('ignored', async (profileAgentDir) => {
      temporaryAgentDir = profileAgentDir;
      expect(existsSync(profileAgentDir)).toBe(true);
      return 'done';
    })).resolves.toBe('done');
    expect(materializeProfileToAgentDirMock).toHaveBeenCalledWith(resolvedShared, temporaryAgentDir);
    expect(existsSync(temporaryAgentDir)).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs initial materialization failures', async () => {
    materializeProfileToAgentDirMock.mockImplementationOnce(() => {
      throw new Error('initial materialize failed');
    });

    const logger = createLogger();
    createProfileState({
      repoRoot: '/repo-root',
      agentDir: '/agent-dir',
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith('failed to materialize initial profile', {
      profile: 'shared',
      message: 'initial materialize failed',
    });
  });
});
