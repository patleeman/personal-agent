import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface SavedProfilePreferences {
  defaultProfile: string;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

export function getProfileConfigFilePath(): string {
  const explicit = process.env.PERSONAL_AGENT_CONFIG_FILE;
  if (explicit && explicit.trim().length > 0) {
    return explicit;
  }

  return join(homedir(), '.config', 'personal-agent', 'config.json');
}

export function readSavedProfilePreferences(configFile = getProfileConfigFilePath()): SavedProfilePreferences {
  if (!existsSync(configFile)) {
    return { defaultProfile: 'shared' };
  }

  try {
    const parsed = JSON.parse(readFileSync(configFile, 'utf-8')) as { defaultProfile?: unknown };
    return {
      defaultProfile: readNonEmptyString(parsed.defaultProfile) || 'shared',
    };
  } catch {
    return { defaultProfile: 'shared' };
  }
}

export function writeSavedProfilePreferences(profile: string, configFile = getProfileConfigFilePath()): void {
  mkdirSync(dirname(configFile), { recursive: true });
  writeFileSync(configFile, JSON.stringify({ defaultProfile: profile }, null, 2) + '\n');
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
