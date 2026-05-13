import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getStateRoot } from '@personal-agent/core';

export const ADDITIONAL_EXTENSION_PATHS_SETTING = 'extensions.additionalPaths';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function splitExtensionPathList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,:\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readConfiguredExtensionPaths(stateRoot: string = getStateRoot()): string[] {
  const settingsFile = join(stateRoot, 'settings.json');
  if (!existsSync(settingsFile)) return [];

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    if (!isRecord(parsed)) return [];
    const value = parsed[ADDITIONAL_EXTENSION_PATHS_SETTING];
    return typeof value === 'string' ? splitExtensionPathList(value) : [];
  } catch {
    return [];
  }
}

export function readEnvironmentExtensionPaths(): string[] {
  return splitExtensionPathList(process.env.PERSONAL_AGENT_EXTENSION_PATHS);
}
