import { dirname, join } from 'node:path';

import { getPiAgentRuntimeDir, resolveLocalProfileSettingsFilePath } from '@personal-agent/core';

import { LocalWhisperTranscriptionProvider } from './localWhisperProvider.js';
import {
  buildTranscriptionSettingsState,
  isTranscriptionProviderId,
  readTranscriptionSettings,
  writeTranscriptionSettings,
} from './settings.js';
import type { TranscriptionProviderId } from './types.js';

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

function createProvider(providerId: TranscriptionProviderId, model: string): LocalWhisperTranscriptionProvider {
  if (providerId !== 'local-whisper') throw new Error(`Unsupported transcription provider: ${providerId}`);
  return new LocalWhisperTranscriptionProvider({ model, modelRootPath: join(dirname(authFile()), 'transcription-models') });
}

export async function readSettings() {
  return buildTranscriptionSettingsState(settingsFile());
}

export async function updateSettings(input: { provider?: unknown; model?: unknown }) {
  const update: Parameters<typeof writeTranscriptionSettings>[1] = {};
  if ('provider' in input) {
    if (input.provider !== null && !isTranscriptionProviderId(input.provider)) throw new Error('provider must be local-whisper or null');
    update.provider = input.provider;
  }
  if ('model' in input) {
    const model = readOptionalString(input.model);
    if (!model) throw new Error('model must be a non-empty string');
    update.model = model;
  }
  writeTranscriptionSettings(resolveLocalProfileSettingsFilePath(), update);
  writeTranscriptionSettings(settingsFile(), update);
  return buildTranscriptionSettingsState(settingsFile());
}

export async function modelStatus(input: { provider?: unknown; model?: unknown }) {
  const settings = readTranscriptionSettings(settingsFile());
  const providerId = 'provider' in input ? input.provider : settings.provider;
  if (!providerId || !isTranscriptionProviderId(providerId)) throw new Error('provider must be local-whisper');
  const model = readOptionalString(input.model) ?? settings.model;
  return createProvider(providerId, model).getModelStatus();
}

export async function installModel(input: { provider?: unknown; model?: unknown }) {
  const settings = readTranscriptionSettings(settingsFile());
  const providerId = 'provider' in input ? input.provider : settings.provider;
  if (!providerId || !isTranscriptionProviderId(providerId)) throw new Error('provider must be local-whisper');
  const model = readOptionalString(input.model) ?? settings.model;
  return createProvider(providerId, model).installModel();
}

export async function transcribeFile(input: { dataBase64?: unknown; mimeType?: unknown; fileName?: unknown; language?: unknown }) {
  const settings = readTranscriptionSettings(settingsFile());
  if (!settings.provider) throw new Error('Choose a transcription provider in Settings before using dictation.');
  const provider = createProvider(settings.provider, settings.model);
  return provider.transcribeFile(
    {
      data: readRequiredBase64(input.dataBase64, 'dataBase64'),
      mimeType: readOptionalString(input.mimeType) ?? 'audio/pcm',
      fileName: readOptionalString(input.fileName),
    },
    { language: readOptionalString(input.language) },
  );
}
