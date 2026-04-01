import {
  getMachineConfigFilePath,
  readMachineDefaultProfile,
  writeMachineDefaultProfile,
} from '@personal-agent/core';

export interface SavedProfilePreferences {
  defaultProfile: string;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

export function getProfileConfigFilePath(): string {
  return getMachineConfigFilePath();
}

export function readSavedProfilePreferences(configFile = getProfileConfigFilePath()): SavedProfilePreferences {
  return {
    defaultProfile: readMachineDefaultProfile({ filePath: configFile }),
  };
}

export function writeSavedProfilePreferences(profile: string, configFile = getProfileConfigFilePath()): void {
  writeMachineDefaultProfile(profile, { filePath: configFile });
}

export function resolveActiveProfile(input: {
  explicitProfile?: string;
  savedProfile?: string;
  availableProfiles: string[];
}): string {
  const candidates = [
    readNonEmptyString(input.explicitProfile),
    readNonEmptyString(input.savedProfile),
    'shared',
  ].filter((value) => value.length > 0);

  for (const candidate of candidates) {
    if (input.availableProfiles.includes(candidate)) {
      return candidate;
    }
  }

  return input.availableProfiles[0] ?? 'shared';
}
