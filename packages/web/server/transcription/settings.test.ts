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
  it('defaults to local Whisper and the base English model', () => {
    const settingsFile = join(mkdtempSync(join(tmpdir(), 'pa-transcription-')), 'settings.json');
    expect(readTranscriptionSettings(settingsFile)).toEqual({
      provider: 'local-whisper',
      model: 'base.en',
    });
  });

  it('persists explicit provider configuration without touching other settings', () => {
    const settingsFile = join(mkdtempSync(join(tmpdir(), 'pa-transcription-')), 'settings.json');
    writeFileSync(settingsFile, JSON.stringify({ theme: 'cobalt2' }));

    const settings = writeTranscriptionSettings(settingsFile, {
      provider: 'local-whisper',
      model: 'small.en',
    });

    expect(settings).toEqual({ provider: 'local-whisper', model: 'small.en' });
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({
      theme: 'cobalt2',
      transcription: settings,
    });
  });

  it('migrates old cloud transcription model ids to the local default', () => {
    const settingsFile = join(mkdtempSync(join(tmpdir(), 'pa-transcription-')), 'settings.json');
    writeFileSync(settingsFile, JSON.stringify({
      transcription: {
        provider: 'local-whisper',
        model: 'gpt-4o-mini-transcribe',
      },
    }));

    expect(readTranscriptionSettings(settingsFile)).toEqual({
      provider: 'local-whisper',
      model: 'base.en',
    });
  });

  it('allows explicitly disabling dictation', () => {
    const settingsFile = join(mkdtempSync(join(tmpdir(), 'pa-transcription-')), 'settings.json');

    expect(writeTranscriptionSettings(settingsFile, { provider: null })).toEqual({
      provider: null,
      model: 'base.en',
    });
  });

  it('documents the local provider in state', () => {
    const settingsFile = join(mkdtempSync(join(tmpdir(), 'pa-transcription-')), 'settings.json');
    const state = buildTranscriptionSettingsState(settingsFile);

    expect(state.providers).toEqual([{
      id: 'local-whisper',
      label: 'Local Whisper',
      status: 'implemented',
      transports: ['file'],
    }]);
  });
});
