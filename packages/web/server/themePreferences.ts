import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface SavedThemePreferences {
  currentTheme: string;
  themeMode: ThemeMode;
  themeDark: string;
  themeLight: string;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function readSettingsObject(settingsFile: string): Record<string, unknown> {
  if (!existsSync(settingsFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return { ...(parsed as Record<string, unknown>) };
  } catch {
    return {};
  }
}

function normalizeThemeMode(value: unknown): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }

  return 'system';
}

export function readSavedThemePreferences(settingsFile: string): SavedThemePreferences {
  const parsed = readSettingsObject(settingsFile);

  return {
    currentTheme: readNonEmptyString(parsed.theme),
    themeMode: normalizeThemeMode(parsed.themeMode),
    themeDark: readNonEmptyString(parsed.themeDark),
    themeLight: readNonEmptyString(parsed.themeLight),
  };
}

export function writeSavedThemePreferences(
  input: {
    themeMode?: ThemeMode;
    themeDark?: string | null;
    themeLight?: string | null;
  },
  settingsFile: string,
): SavedThemePreferences {
  const settings = readSettingsObject(settingsFile);

  if (input.themeMode !== undefined) {
    settings.themeMode = normalizeThemeMode(input.themeMode);
  }

  if (input.themeDark !== undefined) {
    const normalized = readNonEmptyString(input.themeDark ?? '');
    if (normalized) {
      settings.themeDark = normalized;
    } else {
      delete settings.themeDark;
    }
  }

  if (input.themeLight !== undefined) {
    const normalized = readNonEmptyString(input.themeLight ?? '');
    if (normalized) {
      settings.themeLight = normalized;
    } else {
      delete settings.themeLight;
    }
  }

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');

  return readSavedThemePreferences(settingsFile);
}
