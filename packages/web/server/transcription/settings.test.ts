import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTranscriptionSettingsState,
  readTranscriptionSettings,
  writeTranscriptionSettings,
} from './settings.js';

describe('transcription settings', () => {
  it('defaults to no provider and codex transcribe model', () => {
    const settingsFile = join(mkdtempSync(join(tmpdir(), 'pa-transcription-')), 'settings.json');
    expect(readTranscriptionSettings(settingsFile)).toEqual({
      provider: null,
      model: 'gpt-4o-mini-transcribe',
    });
  });

  it('persists explicit provider configuration without auto resolution', () => {
    const settingsFile = join(mkdtempSync(join(tmpdir(), 'pa-transcription-')), 'settings.json');
    writeFileSync(settingsFile, JSON.stringify({ theme: 'cobalt2' }));

    const settings = writeTranscriptionSettings(settingsFile, {
      provider: 'openai-codex-realtime',
      model: 'gpt-4o-mini-transcribe',
    });

    expect(settings).toEqual({ provider: 'openai-codex-realtime', model: 'gpt-4o-mini-transcribe' });
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({
      theme: 'cobalt2',
      transcription: settings,
    });
  });

  it('documents provider implementation status in state', () => {
    const settingsFile = join(mkdtempSync(join(tmpdir(), 'pa-transcription-')), 'settings.json');
    const state = buildTranscriptionSettingsState(settingsFile);

    expect(state.providers).toContainEqual({
      id: 'openai-codex-realtime',
      label: 'OpenAI Codex Transcribe',
      status: 'implemented',
      transports: ['file'],
    });
    expect(state.providers.find((provider) => provider.id === 'openai-api')?.status).toBe('implemented');
    expect(state.providers.find((provider) => provider.id === 'whisperkit-local')?.status).toBe('planned');
  });
});
