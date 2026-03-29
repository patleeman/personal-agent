import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPiAgentRuntimeDir } from '@personal-agent/core';
import {
  formatModelPresetModelArgument,
  listModelPresetTargets,
  materializeProfileToAgentDir,
  mergeJsonFiles,
  resolveModelPreset,
  resolveResourceProfile,
  type ResolvedModelPreset,
  type ResolvedModelPresetTarget,
} from '@personal-agent/resources';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';

export interface ResolveProfileModelPresetOptions {
  repoRoot: string;
  profilesRoot: string;
}

export interface ResolvedProfileModelPresetSelection {
  preset: ResolvedModelPreset;
  target: ResolvedModelPresetTarget;
  modelArgument: string;
}

function createProfileModelRegistry(agentDir: string): ModelRegistry {
  return ModelRegistry.create(
    AuthStorage.create(join(getPiAgentRuntimeDir(), 'auth.json')),
    join(agentDir, 'models.json'),
  );
}

async function resolveUsablePresetTarget(
  modelRegistry: ModelRegistry,
  preset: ResolvedModelPreset,
): Promise<ResolvedModelPresetTarget | null> {
  for (const target of listModelPresetTargets(preset)) {
    const model = modelRegistry.getAvailable().find((candidate) => {
      if (target.provider) {
        return candidate.provider === target.provider && candidate.id === target.model;
      }

      return candidate.id === target.model;
    });
    if (!model) {
      continue;
    }

    const authResult = await modelRegistry.getApiKeyAndHeaders(model);
    if (!authResult.ok) {
      continue;
    }

    return target;
  }

  return null;
}

export function resolveProfileModelPreset(
  profile: string,
  presetId: string,
  options: ResolveProfileModelPresetOptions,
): ResolvedModelPreset | null {
  const resolvedProfile = resolveResourceProfile(profile, {
    repoRoot: options.repoRoot,
    profilesRoot: options.profilesRoot,
  });

  return resolveModelPreset(mergeJsonFiles(resolvedProfile.settingsFiles), presetId);
}

export async function resolveProfileModelPresetSelection(
  profile: string,
  presetId: string,
  options: ResolveProfileModelPresetOptions,
): Promise<ResolvedProfileModelPresetSelection | null> {
  const resolvedProfile = resolveResourceProfile(profile, {
    repoRoot: options.repoRoot,
    profilesRoot: options.profilesRoot,
  });
  const preset = resolveModelPreset(mergeJsonFiles(resolvedProfile.settingsFiles), presetId);
  if (!preset) {
    return null;
  }

  const tempAgentDir = mkdtempSync(join(tmpdir(), 'pa-model-preset-profile-'));
  try {
    materializeProfileToAgentDir(resolvedProfile, tempAgentDir);
    const modelRegistry = createProfileModelRegistry(tempAgentDir);
    const target = await resolveUsablePresetTarget(modelRegistry, preset);
    if (!target) {
      throw new Error(
        `No configured model target for preset ${preset.id} is currently usable. Tried ${listModelPresetTargets(preset).map((entry) => formatModelPresetModelArgument(entry)).join(', ')}.`,
      );
    }

    return {
      preset,
      target,
      modelArgument: formatModelPresetModelArgument(target),
    };
  } finally {
    rmSync(tempAgentDir, { recursive: true, force: true });
  }
}
