export interface ComposerDictationCapture {
  stop: () => Promise<{ audio: Uint8Array; durationMs: number; mimeType: string; fileName: string }>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return globalThis.btoa(binary);
}

export async function startComposerDictationCapture(): Promise<ComposerDictationCapture> {
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
