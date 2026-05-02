import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalWhisperTranscriptionProvider, testExports } from './localWhisperProvider.js';

describe('Local Whisper transcription provider', () => {
  it('normalizes legacy WhisperKit model ids to whisper.cpp model names', () => {
    expect(testExports.normalizeLocalWhisperModel('openai_whisper-base')).toBe('base');
    expect(testExports.normalizeLocalWhisperModel('openai_whisper-small.en')).toBe('small.en');
    expect(testExports.normalizeLocalWhisperModel(undefined)).toBe('base.en');
    expect(testExports.resolveModelFileName('base.en')).toBe('ggml-base.en.bin');
    expect(testExports.resolveModelDownloadUrl('base.en')).toBe(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    );
  });

  it('resolves model file paths relative to the model root', () => {
    expect(testExports.resolveModelFilePath('/cache', 'tiny.en')).toBe('/cache/ggml-tiny.en.bin');
    expect(testExports.resolveModelFilePath('/cache', 'base')).toBe('/cache/ggml-base.bin');
  });

  it('decodes 16-bit PCM into normalized float audio', () => {
    const audio = testExports.pcm16ToFloat32(Buffer.from([0x00, 0x40, 0x00, 0xc0]));

    expect(audio[0]).toBeCloseTo(0x4000 / 0x7fff);
    expect(audio[1]).toBe(-0.5);
  });

  it('formats whisper.cpp segments into flat text', () => {
    expect(testExports.formatWhisperSegments([
      { start: '00:00:00,000', end: '00:00:01,500', text: ' hello world ' },
      { start: '00:00:01,500', end: '00:00:03,000', text: '  from whisper ' },
    ])).toBe('hello world from whisper');
  });

  it('reports whether the selected model is installed in the local cache', async () => {
    const modelRootPath = join(tmpdir(), `pa-model-status-${Date.now()}`);
    const provider = new LocalWhisperTranscriptionProvider({
      model: 'tiny.en',
      modelRootPath,
    });

    await expect(provider.getModelStatus()).resolves.toMatchObject({
      provider: 'local-whisper',
      model: 'tiny.en',
      cacheDir: modelRootPath,
      installed: false,
    });

    await mkdir(modelRootPath, { recursive: true });
    await writeFile(join(modelRootPath, 'ggml-tiny.en.bin'), 'fake model data');

    await expect(provider.getModelStatus()).resolves.toMatchObject({
      installed: true,
      sizeBytes: 15,
    });
  });
});
