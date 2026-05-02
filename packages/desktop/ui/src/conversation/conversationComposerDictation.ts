export interface ComposerDictationCapture {
  stop: () => Promise<{ audio: Uint8Array; durationMs: number; mimeType: string; fileName: string }>;
}

export interface ComposerDictationCaptureOptions {
  onLevel?: (level: number) => void;
}

const DICTATION_SAMPLE_RATE = 16_000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return globalThis.btoa(binary);
}

function floatToInt16Pcm(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

export function resampleFloat32ToPcm16(input: Float32Array, inputSampleRate: number, outputSampleRate = DICTATION_SAMPLE_RATE): Int16Array {
  if (input.length === 0 || inputSampleRate <= 0 || outputSampleRate <= 0) {
    return new Int16Array();
  }

  if (inputSampleRate === outputSampleRate) {
    const output = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      output[index] = floatToInt16Pcm(input[index] ?? 0);
    }
    return output;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((outputIndex + 1) * ratio)));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      sum += input[inputIndex] ?? 0;
    }
    output[outputIndex] = floatToInt16Pcm(sum / (end - start));
  }
  return output;
}

function int16ChunksToBytes(chunks: Int16Array[]): Uint8Array {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(sampleCount * 2);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return bytes;
}

export async function startComposerDictationCapture(options: ComposerDictationCaptureOptions = {}): Promise<ComposerDictationCapture> {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not available in this browser.');
  }

  const AudioContextConstructor = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('Audio capture is not available in this browser.');
  }

  const stream = await mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const audioContext = new AudioContextConstructor();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  const chunks: Int16Array[] = [];
  const startedAt = performance.now();
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) {
      return;
    }

    const input = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (const sample of input) {
      sum += sample * sample;
    }
    options.onLevel?.(Math.min(1, Math.sqrt(sum / input.length) * 4));
    chunks.push(resampleFloat32ToPcm16(input, audioContext.sampleRate));
  };

  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  return {
    stop: async () => {
      if (stopped) {
        return { audio: new Uint8Array(), durationMs: 0, mimeType: 'audio/pcm;rate=16000;channels=1', fileName: 'dictation.pcm' };
      }

      stopped = true;
      processor.disconnect();
      source.disconnect();
      silentGain.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close().catch(() => {});
      return {
        audio: int16ChunksToBytes(chunks),
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        mimeType: 'audio/pcm;rate=16000;channels=1',
        fileName: 'dictation.pcm',
      };
    },
  };
}
