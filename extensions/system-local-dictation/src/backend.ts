import { dirname, join } from 'node:path';

import { getPiAgentRuntimeDir, resolveLocalProfileSettingsFilePath } from '@personal-agent/core';

import { LocalWhisperTranscriptionProvider } from './localWhisperProvider.js';
import { buildDictationSettingsState, readDictationSettings, writeDictationSettings } from './settings.js';

function settingsFile(): string {
  return join(getPiAgentRuntimeDir(), 'settings.json');
}

function authFile(): string {
  return join(getPiAgentRuntimeDir(), 'auth.json');
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readRequiredBase64(value: unknown, label: string): Buffer {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized))
    throw new Error(`${label} must contain valid base64 data.`);
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0) throw new Error(`${label} must decode to non-empty data.`);
  return decoded;
}

function createProvider(model: string): LocalWhisperTranscriptionProvider {
  return new LocalWhisperTranscriptionProvider({ model, modelRootPath: join(dirname(authFile()), 'transcription-models') });
}

export async function readSettings() {
  return buildDictationSettingsState(settingsFile());
}

export async function updateSettings(input: { enabled?: unknown; model?: unknown }) {
  const update: Parameters<typeof writeDictationSettings>[1] = {};
  if ('enabled' in input) {
    if (typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean');
    update.enabled = input.enabled;
  }
  if ('model' in input) {
    const model = readOptionalString(input.model);
    if (!model) throw new Error('model must be a non-empty string');
    update.model = model;
  }
  writeDictationSettings(resolveLocalProfileSettingsFilePath(), update);
  writeDictationSettings(settingsFile(), update);
  return buildDictationSettingsState(settingsFile());
}

export async function modelStatus(input: { model?: unknown }) {
  const settings = readDictationSettings(settingsFile());
  const model = readOptionalString(input.model) ?? settings.model;
  return createProvider(model).getModelStatus();
}

export async function installModel(input: { model?: unknown }) {
  const settings = readDictationSettings(settingsFile());
  const model = readOptionalString(input.model) ?? settings.model;
  return createProvider(model).installModel();
}

export async function transcribeFile(input: { dataBase64?: unknown; mimeType?: unknown; fileName?: unknown; language?: unknown }) {
  const settings = readDictationSettings(settingsFile());
  if (!settings.enabled) throw new Error('Enable dictation in Settings before using it.');
  const provider = createProvider(settings.model);
  return provider.transcribeFile(
    {
      data: readRequiredBase64(input.dataBase64, 'dataBase64'),
      mimeType: readOptionalString(input.mimeType) ?? 'audio/pcm',
      fileName: readOptionalString(input.fileName),
    },
    { language: readOptionalString(input.language) },
  );
}
