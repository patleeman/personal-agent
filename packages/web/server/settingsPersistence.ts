import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigRoot, getStateRoot } from '@personal-agent/core';

const DEFAULT_LOCAL_PROFILE_DIR = join(getConfigRoot(), 'local');

export const DEFAULT_RUNTIME_SETTINGS_FILE = join(getStateRoot(), 'pi-agent', 'settings.json');

function readLocalProfileDir(explicitLocalProfileDir?: string): string {
  const value = explicitLocalProfileDir ?? process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR;

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return DEFAULT_LOCAL_PROFILE_DIR;
}

export function resolveLocalProfileSettingsFilePath(explicitLocalProfileDir?: string): string {
  const localProfileDir = readLocalProfileDir(explicitLocalProfileDir);
  const nestedAgentDir = join(localProfileDir, 'agent');

  if (existsSync(nestedAgentDir) && statSync(nestedAgentDir).isDirectory()) {
    return join(nestedAgentDir, 'settings.json');
  }

  if (existsSync(localProfileDir) && !statSync(localProfileDir).isDirectory()) {
    throw new Error(`Local profile path is not a directory: ${localProfileDir}`);
  }

  return join(localProfileDir, 'settings.json');
}

export interface PersistSettingsWriteOptions {
  runtimeSettingsFile?: string;
  localSettingsFile?: string;
  localProfileDir?: string;
}

export function persistSettingsWrite<T>(
  writeSettingsFile: (settingsFile: string) => T,
  options: PersistSettingsWriteOptions = {},
): T {
  const localSettingsFile = options.localSettingsFile
    ?? resolveLocalProfileSettingsFilePath(options.localProfileDir);
  const runtimeSettingsFile = options.runtimeSettingsFile ?? DEFAULT_RUNTIME_SETTINGS_FILE;

  writeSettingsFile(localSettingsFile);
  return writeSettingsFile(runtimeSettingsFile);
}
