export interface ComposerDictationCapture {
  stop: () => Promise<{ audio: Uint8Array; durationMs: number; mimeType: string; fileName: string }>;
}

export interface ComposerDictationCaptureOptions {
  onLevel?: (level: number) => void;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return globalThis.btoa(binary);
}

function startDictationLevelMeter(stream: MediaStream, onLevel: (level: number) => void): (() => void) {
  const AudioContextConstructor = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor || typeof window === 'undefined') {
    return () => {};
  }

  const audioContext = new AudioContextConstructor();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let frame: number | null = null;
  let lastEmitAt = 0;

  const tick = (now: number) => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      sum += normalized * normalized;
    }

    if (now - lastEmitAt >= 45) {
      lastEmitAt = now;
      onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
    }
    frame = window.requestAnimationFrame(tick);
  };

  frame = window.requestAnimationFrame(tick);
  return () => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
    }
    source.disconnect();
    void audioContext.close().catch(() => {});
  };
}

export async function startComposerDictationCapture(options: ComposerDictationCaptureOptions = {}): Promise<ComposerDictationCapture> {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not available in this browser.');
  }

  const stream = await mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  if (typeof MediaRecorder === 'undefined') {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Audio capture is not available in this browser.');
  }

  const preferredMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : '';
  const recorder = new MediaRecorder(stream, preferredMimeType ? { mimeType: preferredMimeType } : undefined);
  const chunks: Blob[] = [];
  const startedAt = performance.now();
  let stopped = false;
  const stopLevelMeter = options.onLevel ? startDictationLevelMeter(stream, options.onLevel) : () => {};

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });
  recorder.start();

  return {
    stop: async () => {
      if (stopped) {
        return { audio: new Uint8Array(), durationMs: 0, mimeType: preferredMimeType || 'audio/webm', fileName: 'dictation.webm' };
      }

      stopped = true;
      stopLevelMeter();
      const stoppedPromise = new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
      });
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      await stoppedPromise;
      stream.getTracks().forEach((track) => track.stop());
      const mimeType = recorder.mimeType || preferredMimeType || chunks[0]?.type || 'audio/webm';
      const blob = new Blob(chunks, { type: mimeType });
      const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      return {
        audio: new Uint8Array(await blob.arrayBuffer()),
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        mimeType,
        fileName: `dictation.${extension}`,
      };
    },
  };
}
