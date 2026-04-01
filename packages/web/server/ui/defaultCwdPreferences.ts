import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveRequestedCwd } from '../conversations/conversationCwd.js';

export interface SavedDefaultCwdPreferences {
  currentCwd: string;
  effectiveCwd: string;
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

function isExistingDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

export function readSavedDefaultCwdPreferences(
  settingsFile: string,
  fallbackCwd: string = process.cwd(),
): SavedDefaultCwdPreferences {
  const settings = readSettingsObject(settingsFile);
  const currentCwd = readNonEmptyString(settings.defaultCwd);
  const resolvedCwd = currentCwd ? resolveRequestedCwd(currentCwd, fallbackCwd) : undefined;

  return {
    currentCwd,
    effectiveCwd: resolvedCwd && isExistingDirectory(resolvedCwd) ? resolvedCwd : fallbackCwd,
  };
}

export function writeSavedDefaultCwdPreference(
  input: { cwd?: string | null },
  settingsFile: string,
  options: {
    baseDir?: string;
    validate?: boolean;
  } = {},
): SavedDefaultCwdPreferences {
  const settings = readSettingsObject(settingsFile);
  const baseDir = options.baseDir ?? process.cwd();

  if (input.cwd !== undefined) {
    const normalizedCwd = readNonEmptyString(input.cwd ?? '');

    if (normalizedCwd) {
      const resolvedCwd = resolveRequestedCwd(normalizedCwd, baseDir);
      if (!resolvedCwd) {
        throw new Error('cwd required');
      }

      if (options.validate) {
        if (!existsSync(resolvedCwd)) {
          throw new Error(`Directory does not exist: ${resolvedCwd}`);
        }

        if (!statSync(resolvedCwd).isDirectory()) {
          throw new Error(`Not a directory: ${resolvedCwd}`);
        }
      }

      settings.defaultCwd = normalizedCwd;
    } else {
      delete settings.defaultCwd;
    }
  }

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');

  return readSavedDefaultCwdPreferences(settingsFile, baseDir);
}
