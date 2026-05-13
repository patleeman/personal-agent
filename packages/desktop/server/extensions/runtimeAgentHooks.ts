import { dirname } from 'node:path';

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { resolveRuntimeResources } from '@personal-agent/core';

import type { LiveSessionResourceOptions } from '../routes/context.js';
import { listExtensionSkillRegistrations } from './extensionRegistry.js';

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

export function buildLiveSessionExtensionFactoriesForRuntime(): ExtensionFactory[] {
  if (!buildExtensionFactories) throw new Error('Live session extension factory builder is not registered.');
  return buildExtensionFactories();
}
