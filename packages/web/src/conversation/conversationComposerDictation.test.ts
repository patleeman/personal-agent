import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64, resampleFloat32ToPcm16, startComposerDictationCapture } from './conversationComposerDictation';

describe('conversation composer dictation helpers', () => {
  const originalAudioContext = globalThis.AudioContext;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      writable: true,
      value: originalAudioContext,
    });
  });

  it('encodes bytes in chunks as base64', () => {
    expect(bytesToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe('aGVsbG8=');
    expect(bytesToBase64(new Uint8Array(40_000).fill(65))).toBe(globalThis.btoa('A'.repeat(40_000)));
  });

  it('resamples float audio to 16khz pcm16', () => {
    const pcm = resampleFloat32ToPcm16(new Float32Array([0.25, 0.75, -0.25, -0.75, 0.5, 0.25]), 48_000, 16_000);

    expect([...pcm]).toEqual([8191, 0]);
  });

  it('reports unavailable microphone capture before requesting media', async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });

    await expect(startComposerDictationCapture()).rejects.toThrow('Microphone capture is not available');

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  it('reports unavailable audio capture before requesting media', async () => {
    const getUserMedia = vi.fn();
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia } },
    });
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    await expect(startComposerDictationCapture()).rejects.toThrow('Audio capture is not available');
    expect(getUserMedia).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });
});
