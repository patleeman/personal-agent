import { dirname } from 'node:path';

import { AuthStorage, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { getPiAgentRuntimeDir, getProfilesRoot, getStateRoot, resolveRuntimeResources } from '@personal-agent/core';

import { readSavedModelPreferences } from '../models/modelPreferences.js';
import type { LiveSessionResourceOptions } from '../routes/context.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE } from '../ui/settingsPersistence.js';
import { createManifestAgentExtensions } from './extensionAgentExtensions.js';
import { listExtensionSkillRegistrations } from './extensionRegistry.js';
import { createManifestToolAgentExtensions } from './manifestToolAgentExtension.js';

let buildResourceOptions: (() => LiveSessionResourceOptions) | null = null;
let buildExtensionFactories: (() => ExtensionFactory[]) | null = null;

export function setRuntimeAgentHookBuilders(builders: {
  buildLiveSessionResourceOptions: () => LiveSessionResourceOptions;
  buildLiveSessionExtensionFactories: () => ExtensionFactory[];
}): void {
  buildResourceOptions = builders.buildLiveSessionResourceOptions;
  buildExtensionFactories = builders.buildLiveSessionExtensionFactories;
}

function buildFallbackLiveSessionResourceOptions(): LiveSessionResourceOptions {
  const resolved = resolveRuntimeResources(process.env.PERSONAL_AGENT_ACTIVE_PROFILE || process.env.PERSONAL_AGENT_PROFILE || 'shared', {
    ...(process.env.PERSONAL_AGENT_REPO_ROOT ? { repoRoot: process.env.PERSONAL_AGENT_REPO_ROOT } : {}),
  });

  return {
    additionalExtensionPaths: resolved.extensionEntries,
    additionalSkillPaths: [...new Set([...resolved.skillDirs, ...listExtensionSkillRegistrations().map((skill) => dirname(skill.path))])],
    additionalPromptTemplatePaths: resolved.promptEntries,
    additionalThemePaths: resolved.themeEntries,
  };
}

export function buildLiveSessionResourceOptionsForRuntime(): LiveSessionResourceOptions {
  return buildResourceOptions ? buildResourceOptions() : buildFallbackLiveSessionResourceOptions();
}

function buildFallbackLiveSessionExtensionFactories(): ExtensionFactory[] {
  const agentDir = getPiAgentRuntimeDir();
  const agentExtensions = createManifestAgentExtensions({
    onError: (message, fields) => console.warn(`[runtime-agent] ${message}`, fields ?? ''),
  });

  return [
    ...createManifestToolAgentExtensions({
      getCurrentProfile: () => process.env.PERSONAL_AGENT_ACTIVE_PROFILE || process.env.PERSONAL_AGENT_PROFILE || 'shared',
      getPreferredVisionModel: () => readSavedModelPreferences(DEFAULT_RUNTIME_SETTINGS_FILE).currentVisionModel,
      hasOpenAiImageProvider: () => {
        try {
          const auth = AuthStorage.create(`${agentDir}/auth.json`);
          return auth.hasAuth('openai') || auth.hasAuth('openai-codex');
        } catch {
          return false;
        }
      },
      repoRoot: process.env.PERSONAL_AGENT_REPO_ROOT || process.cwd(),
      profilesRoot: getProfilesRoot(),
      stateRoot: getStateRoot(),
    }),
    ...agentExtensions.factories,
  ];
}

export function buildLiveSessionExtensionFactoriesForRuntime(): ExtensionFactory[] {
  return buildExtensionFactories ? buildExtensionFactories() : buildFallbackLiveSessionExtensionFactories();
}
