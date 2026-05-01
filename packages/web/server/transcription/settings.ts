import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TranscriptionProviderId, TranscriptionSettings } from './types.js';

export const TRANSCRIPTION_PROVIDER_IDS: TranscriptionProviderId[] = [
  'local-whisper',
];

export const DEFAULT_TRANSCRIPTION_MODEL = 'base.en';
export const DEFAULT_TRANSCRIPTION_PROVIDER: TranscriptionProviderId = 'local-whisper';

const CLOUD_TRANSCRIPTION_MODEL_PATTERN = /^(?:gpt-4o(?:-mini)?-transcribe|whisper-1)$/i;

export interface TranscriptionSettingsState {
  settingsFile: string;
  settings: TranscriptionSettings;
  providers: Array<{
    id: TranscriptionProviderId;
    label: string;
    status: 'implemented' | 'planned';
    transports: Array<'stream' | 'file'>;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isTranscriptionProviderId(value: unknown): value is TranscriptionProviderId {
  return typeof value === 'string' && TRANSCRIPTION_PROVIDER_IDS.includes(value as TranscriptionProviderId);
}

export function normalizeTranscriptionModelForProvider(
  provider: TranscriptionProviderId | null,
  value: unknown,
): string {
  const model = typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : DEFAULT_TRANSCRIPTION_MODEL;

  if (provider === 'local-whisper' && CLOUD_TRANSCRIPTION_MODEL_PATTERN.test(model)) {
    return DEFAULT_TRANSCRIPTION_MODEL;
  }

  return model;
}

export function normalizeTranscriptionSettings(value: unknown): TranscriptionSettings {
  const input = isRecord(value) ? value : {};
  const provider = 'provider' in input
    ? isTranscriptionProviderId(input.provider)
      ? input.provider
      : null
    : DEFAULT_TRANSCRIPTION_PROVIDER;
  const model = normalizeTranscriptionModelForProvider(provider, input.model);

  return { provider, model };
}

export function readTranscriptionSettings(settingsFile: string): TranscriptionSettings {
  if (!existsSync(settingsFile)) {
    return normalizeTranscriptionSettings(undefined);
  }

  const parsed = JSON.parse(readFileSync(settingsFile, 'utf8')) as unknown;
  const root = isRecord(parsed) ? parsed : {};
  return normalizeTranscriptionSettings(root.transcription);
}

export function writeTranscriptionSettings(settingsFile: string, update: Partial<TranscriptionSettings>): TranscriptionSettings {
  const root = existsSync(settingsFile)
    ? JSON.parse(readFileSync(settingsFile, 'utf8')) as unknown
    : {};
  const currentRoot = isRecord(root) ? root : {};
  const current = normalizeTranscriptionSettings(currentRoot.transcription);

  const next = normalizeTranscriptionSettings({
    ...current,
    ...update,
  });

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({
    ...currentRoot,
    transcription: next,
  }, null, 2));

  return next;
}

export function buildTranscriptionSettingsState(settingsFile: string): TranscriptionSettingsState {
  return {
    settingsFile,
    settings: readTranscriptionSettings(settingsFile),
    providers: [
      {
        id: 'local-whisper',
        label: 'Local Whisper',
        status: 'implemented',
        transports: ['file'],
      },
    ],
  };
}
