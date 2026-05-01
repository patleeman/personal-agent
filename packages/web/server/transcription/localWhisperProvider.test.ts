import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { LocalWhisperTranscriptionProvider, testExports } from './localWhisperProvider.js';

describe('Local Whisper transcription provider', () => {
  it('normalizes legacy WhisperKit model ids to Transformers.js model repos', () => {
    expect(testExports.normalizeLocalWhisperModel('openai_whisper-base')).toBe('base');
    expect(testExports.normalizeLocalWhisperModel('openai_whisper-small.en')).toBe('small.en');
    expect(testExports.normalizeLocalWhisperModel(undefined)).toBe('base.en');
    expect(testExports.resolveLocalWhisperModelRepo('base.en')).toBe('Xenova/whisper-base.en');
  });

  it('decodes 16-bit PCM into normalized float audio', () => {
    const audio = testExports.pcm16ToFloat32(Buffer.from([0x00, 0x40, 0x00, 0xc0]));

    expect(audio[0]).toBeCloseTo(0x4000 / 0x7fff);
    expect(audio[1]).toBe(-0.5);
  });

  it('transcribes PCM through a cached local ASR pipeline', async () => {
    const transcriber = vi.fn(async () => ({ text: ' local words ' }));
    const pipelineFactory = vi.fn(async () => transcriber);
    const provider = new LocalWhisperTranscriptionProvider({
      model: 'small.en',
      modelRootPath: '/tmp/pa-models',
      pipelineFactory: pipelineFactory as never,
    });

    const result = await provider.transcribeFile({
      data: Buffer.from([0x00, 0x40, 0x00, 0xc0]),
      mimeType: 'audio/pcm;rate=16000;channels=1',
      fileName: 'dictation.pcm',
    });

    expect(result).toMatchObject({ provider: 'local-whisper', model: 'small.en', text: 'local words', durationMs: 0 });
    expect(pipelineFactory).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-small.en', {
      cache_dir: '/tmp/pa-models',
      quantized: true,
    });
    expect(transcriber).toHaveBeenCalledWith(expect.any(Float32Array), { task: 'transcribe' });
  });

  it('installs the selected model into the local model cache', async () => {
    const transcriber = vi.fn(async () => ({ text: 'unused' }));
    const pipelineFactory = vi.fn(async () => transcriber);
    const provider = new LocalWhisperTranscriptionProvider({
      model: 'tiny.en',
      modelRootPath: '/tmp/pa-models',
      pipelineFactory: pipelineFactory as never,
    });

    await expect(provider.installModel()).resolves.toEqual({
      provider: 'local-whisper',
      model: 'tiny.en',
      cacheDir: '/tmp/pa-models',
    });
    expect(pipelineFactory).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      cache_dir: '/tmp/pa-models',
      quantized: true,
    });
  });
});
