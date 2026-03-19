import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  resolveLocalProfileSettingsFilePath,
  resolveProfileSettingsFilePath,
  type ResolveProfileOptions,
} from '@personal-agent/resources';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSettingsObject(settingsFile: string): Record<string, unknown> {
  if (!existsSync(settingsFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    return isRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function writeSettingsObject(settingsFile: string, settings: Record<string, unknown>): void {
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
}

export function migrateLocalConversationAutomationSettingsToProfile(
  profileName: string,
  options: ResolveProfileOptions = {},
): { migrated: boolean; profileSettingsFile: string; localSettingsFile: string } {
  const profileSettingsFile = resolveProfileSettingsFilePath(profileName, options);
  const localSettingsFile = resolveLocalProfileSettingsFilePath(options);
  const localSettings = readSettingsObject(localSettingsFile);
  const localWebUi = isRecord(localSettings.webUi) ? { ...localSettings.webUi } : {};

  const hasConversationAutomation = 'conversationAutomation' in localWebUi;
  const hasConversationAutomationJudge = 'conversationAutomationJudge' in localWebUi;
  if (!hasConversationAutomation && !hasConversationAutomationJudge) {
    return {
      migrated: false,
      profileSettingsFile,
      localSettingsFile,
    };
  }

  const profileSettings = readSettingsObject(profileSettingsFile);
  const profileWebUi = isRecord(profileSettings.webUi) ? { ...profileSettings.webUi } : {};

  if (hasConversationAutomation) {
    profileWebUi.conversationAutomation = localWebUi.conversationAutomation;
    delete localWebUi.conversationAutomation;
  }

  if (hasConversationAutomationJudge) {
    delete localWebUi.conversationAutomationJudge;
  }

  if (Object.keys(profileWebUi).length > 0) {
    profileSettings.webUi = profileWebUi;
  } else {
    delete profileSettings.webUi;
  }

  if (Object.keys(localWebUi).length > 0) {
    localSettings.webUi = localWebUi;
  } else {
    delete localSettings.webUi;
  }

  writeSettingsObject(profileSettingsFile, profileSettings);
  writeSettingsObject(localSettingsFile, localSettings);

  return {
    migrated: true,
    profileSettingsFile,
    localSettingsFile,
  };
}

export function clearLocalConversationAutomationSettings(
  options: ResolveProfileOptions = {},
): { changed: boolean; localSettingsFile: string } {
  const localSettingsFile = resolveLocalProfileSettingsFilePath(options);
  const localSettings = readSettingsObject(localSettingsFile);
  const localWebUi = isRecord(localSettings.webUi) ? { ...localSettings.webUi } : {};
  const changed = 'conversationAutomation' in localWebUi || 'conversationAutomationJudge' in localWebUi;

  if (!changed) {
    return { changed: false, localSettingsFile };
  }

  delete localWebUi.conversationAutomation;
  delete localWebUi.conversationAutomationJudge;

  if (Object.keys(localWebUi).length > 0) {
    localSettings.webUi = localWebUi;
  } else {
    delete localSettings.webUi;
  }

  writeSettingsObject(localSettingsFile, localSettings);
  return { changed: true, localSettingsFile };
}

export function resolveConversationAutomationProfileSettingsFile(
  profileName: string,
  options: ResolveProfileOptions = {},
): string {
  return resolveProfileSettingsFilePath(profileName, options);
}
