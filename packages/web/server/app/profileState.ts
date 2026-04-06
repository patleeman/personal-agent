import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import { getProfilesRoot, getStateRoot } from '@personal-agent/core';
import {
  listProfiles,
  materializeProfileToAgentDir,
  resolveProfileSettingsFilePath,
  resolveResourceProfile,
} from '@personal-agent/resources';
import { createActivityAgentExtension } from '../extensions/activityAgentExtension.js';
import { createArtifactAgentExtension } from '../extensions/artifactAgentExtension.js';
import { createAskUserQuestionAgentExtension } from '../extensions/askUserQuestionAgentExtension.js';
import { createDeferredResumeAgentExtension } from '../extensions/deferredResumeAgentExtension.js';
import { createReminderAgentExtension } from '../extensions/reminderAgentExtension.js';
import { createRunAgentExtension } from '../extensions/runAgentExtension.js';
import { createScheduledTaskAgentExtension } from '../extensions/scheduledTaskAgentExtension.js';
import { clearMemoryBrowserCaches, warmMemoryBrowserCaches } from '../knowledge/memoryDocs.js';
import { invalidateAppTopics } from '../middleware/index.js';
import { readSavedProfilePreferences, resolveActiveProfile, writeSavedProfilePreferences } from '../ui/profilePreferences.js';
import type { LiveSessionResourceOptions } from '../routes/context.js';

export interface ProfileStateLogger {
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

export interface CreateProfileStateOptions {
  repoRoot: string;
  agentDir: string;
  profileConfigFile: string;
  logger: ProfileStateLogger;
  onProfileChanged?: (profile: string) => Promise<void> | void;
}

export interface ProfileState {
  getCurrentProfile: () => string;
  setCurrentProfile: (profile: string) => Promise<string>;
  listAvailableProfiles: () => string[];
  materializeWebProfile: (profile: string) => void;
  getCurrentProfileSettingsFile: () => string;
  buildLiveSessionExtensionFactories: () => ExtensionFactory[];
  buildLiveSessionResourceOptions: (profile?: string) => LiveSessionResourceOptions;
  withTemporaryProfileAgentDir: <T>(profile: string, run: (agentDir: string) => Promise<T>) => Promise<T>;
}

export function createProfileState(options: CreateProfileStateOptions): ProfileState {
  const { repoRoot, agentDir, profileConfigFile, logger, onProfileChanged } = options;

  function listAvailableProfiles(): string[] {
    return listProfiles({
      repoRoot,
      profilesRoot: getProfilesRoot(),
    });
  }

  function applyProfileEnvironment(profile: string): void {
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = profile;
    process.env.PERSONAL_AGENT_PROFILE = profile;
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
  }

  function materializeWebProfile(profile: string): void {
    applyProfileEnvironment(profile);
    const resolved = resolveResourceProfile(profile, {
      repoRoot,
      profilesRoot: getProfilesRoot(),
    });
    materializeProfileToAgentDir(resolved, agentDir);
  }

  let currentProfile = resolveActiveProfile({
    explicitProfile: process.env.PERSONAL_AGENT_ACTIVE_PROFILE,
    savedProfile: readSavedProfilePreferences(profileConfigFile).defaultProfile,
    availableProfiles: listAvailableProfiles(),
  });

  try {
    materializeWebProfile(currentProfile);
  } catch (error) {
    logger.warn('failed to materialize initial profile', {
      profile: currentProfile,
      message: (error as Error).message,
    });
  }

  function getCurrentProfile(): string {
    return currentProfile;
  }

  function getCurrentProfileSettingsFile(): string {
    return resolveProfileSettingsFilePath(getCurrentProfile(), {
      repoRoot,
      profilesRoot: getProfilesRoot(),
    });
  }

  function buildLiveSessionExtensionFactories(): ExtensionFactory[] {
    return [
      createScheduledTaskAgentExtension({
        getCurrentProfile,
      }),
      createActivityAgentExtension({
        stateRoot: getStateRoot(),
        getCurrentProfile,
      }),
      createAskUserQuestionAgentExtension(),
      createRunAgentExtension({
        getCurrentProfile,
        repoRoot,
        profilesRoot: getProfilesRoot(),
      }),
      createArtifactAgentExtension({
        stateRoot: getStateRoot(),
        getCurrentProfile,
      }),
      createDeferredResumeAgentExtension(),
      createReminderAgentExtension(),
    ];
  }

  function buildLiveSessionResourceOptions(profile = getCurrentProfile()): LiveSessionResourceOptions {
    const resolved = resolveResourceProfile(profile, {
      repoRoot,
      profilesRoot: getProfilesRoot(),
    });

    return {
      additionalExtensionPaths: resolved.extensionEntries,
      additionalSkillPaths: [...new Set(resolved.skillDirs)],
      additionalPromptTemplatePaths: resolved.promptEntries,
      additionalThemePaths: resolved.themeEntries,
    };
  }

  function withTemporaryProfileAgentDir<T>(profile: string, run: (profileAgentDir: string) => Promise<T>): Promise<T> {
    const resolved = resolveResourceProfile(profile, {
      repoRoot,
      profilesRoot: getProfilesRoot(),
    });
    const profileAgentDir = mkdtempSync(join(tmpdir(), 'pa-web-profile-inspect-'));
    materializeProfileToAgentDir(resolved, profileAgentDir);

    return run(profileAgentDir).finally(() => {
      rmSync(profileAgentDir, { recursive: true, force: true });
    });
  }

  async function setCurrentProfile(profile: string): Promise<string> {
    const availableProfiles = listAvailableProfiles();
    if (!availableProfiles.includes(profile)) {
      throw new Error(`Unknown profile: ${profile}`);
    }

    if (profile === currentProfile) {
      return currentProfile;
    }

    materializeWebProfile(profile);
    currentProfile = profile;
    writeSavedProfilePreferences(profile, profileConfigFile);
    clearMemoryBrowserCaches();
    warmMemoryBrowserCaches(profile);
    await onProfileChanged?.(profile);
    invalidateAppTopics(
      'activity',
      'alerts',
      'sessions',
      'tasks',
      'runs',
      'daemon',
      'sync',
      'webUi',
    );
    return currentProfile;
  }

  return {
    getCurrentProfile,
    setCurrentProfile,
    listAvailableProfiles,
    materializeWebProfile,
    getCurrentProfileSettingsFile,
    buildLiveSessionExtensionFactories,
    buildLiveSessionResourceOptions,
    withTemporaryProfileAgentDir,
  };
}
