import { dirname, join } from 'node:path';

import type { ExtensionBackendContext } from '@personal-agent/extensions';

import { LocalWhisperTranscriptionProvider } from './localWhisperProvider.js';
import { buildDictationSettingsState, readDictationSettings, writeDictationSettings } from './settings.js';

function settingsFile(runtimeDir: string): string {
  return join(runtimeDir, 'settings.json');
}

function authFile(runtimeDir: string): string {
  return join(runtimeDir, 'auth.json');
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

function createProvider(model: string, runtimeDir: string): LocalWhisperTranscriptionProvider {
  return new LocalWhisperTranscriptionProvider({ model, modelRootPath: join(dirname(authFile(runtimeDir)), 'transcription-models') });
}

export async function readSettings(_input: unknown, ctx: ExtensionBackendContext) {
  return buildDictationSettingsState(settingsFile(ctx.runtimeDir));
}

export async function updateSettings(input: { enabled?: unknown; model?: unknown }, ctx: ExtensionBackendContext) {
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
  writeDictationSettings(ctx.profileSettingsFilePath, update);
  writeDictationSettings(settingsFile(ctx.runtimeDir), update);
  return buildDictationSettingsState(settingsFile(ctx.runtimeDir));
}

export async function modelStatus(input: { model?: unknown }, ctx: ExtensionBackendContext) {
  const settings = readDictationSettings(settingsFile(ctx.runtimeDir));
  const model = readOptionalString(input.model) ?? settings.model;
  return createProvider(model, ctx.runtimeDir).getModelStatus();
}

export async function installModel(input: { model?: unknown }, ctx: ExtensionBackendContext) {
  const settings = readDictationSettings(settingsFile(ctx.runtimeDir));
  const model = readOptionalString(input.model) ?? settings.model;
  return createProvider(model, ctx.runtimeDir).installModel();
}

export async function transcribeFile(
  input: { dataBase64?: unknown; mimeType?: unknown; fileName?: unknown; language?: unknown },
  ctx: ExtensionBackendContext,
) {
  const settings = readDictationSettings(settingsFile(ctx.runtimeDir));
  if (!settings.enabled) throw new Error('Enable dictation in Settings before using it.');
  const provider = createProvider(settings.model, ctx.runtimeDir);
  return provider.transcribeFile(
    {
      data: readRequiredBase64(input.dataBase64, 'dataBase64'),
      mimeType: readOptionalString(input.mimeType) ?? 'audio/pcm',
      fileName: readOptionalString(input.fileName),
    },
    { language: readOptionalString(input.language) },
  );
}
