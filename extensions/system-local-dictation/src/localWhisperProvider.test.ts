import { describe, expect, it } from 'vitest';

import { testExports } from './localWhisperProvider.js';

describe('local whisper provider', () => {
  it('includes the desktop package when resolving whisper-cpp-node from the bundled extension', () => {
    const candidates = testExports.buildWhisperRequireCandidatePaths(
      'file:///repo/extensions/system-local-dictation/dist/backend.mjs',
      '/tmp/not-the-repo-root',
    );

    expect(candidates).toContain('/repo/packages/desktop/package.json');
  });

  it('resolves curated and custom Hugging Face model downloads', () => {
    expect(testExports.resolveModelFileName('small.en')).toBe('ggml-small.en.bin');
    expect(testExports.resolveModelDownloadUrl('small.en')).toBe(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    );

    const custom = 'https://huggingface.co/acme/whisper-models/resolve/main/ggml-custom.bin';
    expect(testExports.resolveCustomHuggingFaceUrl(custom)?.toString()).toBe(custom);
    expect(testExports.resolveModelFileName(custom)).toBe('ggml-custom.bin');
    expect(testExports.resolveModelDownloadUrl(custom)).toBe(custom);
  });

  it('rejects vague or non-Hugging Face custom model URLs', () => {
    expect(testExports.resolveCustomHuggingFaceUrl('https://huggingface.co/acme/whisper-models')).toBeNull();
    expect(() => testExports.resolveModelFileName('https://huggingface.co/acme/whisper-models')).toThrow(
      'Custom Whisper models must be direct Hugging Face /resolve/ URLs to .bin files.',
    );
    expect(testExports.resolveCustomHuggingFaceUrl('https://example.com/ggml-model.bin')).toBeNull();
    expect(() => testExports.resolveModelFileName('https://example.com/ggml-model.bin')).toThrow(
      'Custom Whisper models must be direct Hugging Face /resolve/ URLs to .bin files.',
    );
  });

  it('rejects local model names that escape the model cache directory', () => {
    expect(() => testExports.resolveModelFileName('../secret')).toThrow('Invalid Whisper model name.');
    expect(() => testExports.resolveModelFileName('nested/model')).toThrow('Invalid Whisper model name.');
  });

  it('formats tuple segments returned by whisper-cpp-node', () => {
    expect(
      testExports.formatWhisperSegments([
        ['00:00:00.000', '00:00:01.000', ' hello '],
        ['00:00:01.000', '00:00:02.000', 'world'],
      ]),
    ).toBe('hello world');
  });

  it('formats object segments defensively', () => {
    expect(
      testExports.formatWhisperSegments([
        { start: '00:00:00.000', end: '00:00:01.000', text: ' hello ' },
        { start: '00:00:01.000', end: '00:00:02.000', text: 'world' },
      ]),
    ).toBe('hello world');
  });
});
