import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { readConversationAutoTitleSettings } from '../conversations/conversationAutoTitle.js';

export interface SavedConversationTitlePreferences {
  enabled: boolean;
  currentModel: string;
  effectiveModel: string;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

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

function readUiSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return isRecord(settings.ui) ? { ...settings.ui } : {};
}

function readConversationTitleSettingsObject(settings: Record<string, unknown>): Record<string, unknown> {
  const ui = readUiSettings(settings);
  return isRecord(ui.conversationTitles) ? { ...ui.conversationTitles } : {};
}

function normalizeConversationTitleModel(value: unknown, provider: unknown): string {
  const model = readNonEmptyString(value);
  if (!model) {
    return '';
  }

  if (model.includes('/')) {
    return model;
  }

  const normalizedProvider = readNonEmptyString(provider);
  return normalizedProvider ? `${normalizedProvider}/${model}` : model;
}

function formatEffectiveModel(settingsFile: string): string {
  const settings = readConversationAutoTitleSettings(settingsFile);
  return `${settings.provider}/${settings.model}`;
}

export function readSavedConversationTitlePreferences(settingsFile: string): SavedConversationTitlePreferences {
  const settings = readSettingsObject(settingsFile);
  const conversationTitles = readConversationTitleSettingsObject(settings);

  return {
    enabled: readBoolean(conversationTitles.enabled, true),
    currentModel: normalizeConversationTitleModel(conversationTitles.model, conversationTitles.provider),
    effectiveModel: formatEffectiveModel(settingsFile),
  };
}

export function writeSavedConversationTitlePreferences(
  input: { enabled?: boolean; model?: string | null },
  settingsFile: string,
): SavedConversationTitlePreferences {
  const settings = readSettingsObject(settingsFile);
  const ui = readUiSettings(settings);
  const conversationTitles = readConversationTitleSettingsObject(settings);

  if (input.enabled !== undefined) {
    if (input.enabled) {
      delete conversationTitles.enabled;
    } else {
      conversationTitles.enabled = false;
    }
  }

  if (input.model !== undefined) {
    const normalizedModel = readNonEmptyString(input.model ?? '');
    if (normalizedModel) {
      conversationTitles.model = normalizedModel;
      delete conversationTitles.provider;
    } else {
      delete conversationTitles.model;
      delete conversationTitles.provider;
    }
  }

  if (Object.keys(conversationTitles).length > 0) {
    ui.conversationTitles = conversationTitles;
  } else {
    delete ui.conversationTitles;
  }

  if (Object.keys(ui).length > 0) {
    settings.ui = ui;
  } else {
    delete settings.ui;
  }

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');

  return readSavedConversationTitlePreferences(settingsFile);
}
