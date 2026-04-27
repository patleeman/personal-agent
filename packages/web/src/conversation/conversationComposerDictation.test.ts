import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64, startComposerDictationCapture } from './conversationComposerDictation';

describe('conversation composer dictation helpers', () => {
  const originalMediaRecorder = globalThis.MediaRecorder;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: originalMediaRecorder,
    });
  });

  it('encodes bytes in chunks as base64', () => {
    expect(bytesToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe('aGVsbG8=');
    expect(bytesToBase64(new Uint8Array(40_000).fill(65))).toBe(globalThis.btoa('A'.repeat(40_000)));
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

  it('stops acquired tracks when MediaRecorder is unavailable', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop }],
    }));
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia } },
    });
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    await expect(startComposerDictationCapture()).rejects.toThrow('Audio capture is not available');
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(stop).toHaveBeenCalled();

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });
});
