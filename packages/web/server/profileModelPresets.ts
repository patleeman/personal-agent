import {
  mergeJsonFiles,
  resolveModelPreset,
  resolveResourceProfile,
  type ResolvedModelPreset,
} from '@personal-agent/resources';

export interface ResolveProfileModelPresetOptions {
  repoRoot: string;
  profilesRoot: string;
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
