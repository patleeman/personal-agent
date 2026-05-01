import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutomaticSpeechRecognitionPipelineType } from '@xenova/transformers/types/pipelines.js';
import type { TranscriptionFileInput, TranscriptionInstallResult, TranscriptionModelStatus, TranscriptionOptions, TranscriptionProvider, TranscriptionResult } from './types.js';

const DEFAULT_LOCAL_WHISPER_MODEL = 'base.en';
const PCM_SAMPLE_RATE = 16_000;

const MODEL_ALIASES: Record<string, string> = {
  'openai_whisper-tiny': 'tiny',
  'openai_whisper-tiny.en': 'tiny.en',
  'openai_whisper-base': 'base',
  'openai_whisper-base.en': 'base.en',
  'openai_whisper-small': 'small',
  'openai_whisper-small.en': 'small.en',
  'openai_whisper-medium': 'medium',
  'openai_whisper-medium.en': 'medium.en',
};

const MODEL_REPOS: Record<string, string> = {
  tiny: 'Xenova/whisper-tiny',
  'tiny.en': 'Xenova/whisper-tiny.en',
  base: 'Xenova/whisper-base',
  'base.en': 'Xenova/whisper-base.en',
  small: 'Xenova/whisper-small',
  'small.en': 'Xenova/whisper-small.en',
  medium: 'Xenova/whisper-medium',
  'medium.en': 'Xenova/whisper-medium.en',
};

type AsrPipelineFactory = typeof import('@xenova/transformers').pipeline;

interface LocalWhisperTranscriptionProviderOptions {
  model?: string;
  modelRootPath: string;
  pipelineFactory?: AsrPipelineFactory;
}

const pipelineCache = new Map<string, Promise<AutomaticSpeechRecognitionPipelineType>>();

function normalizeLocalWhisperModel(value: string | undefined): string {
  const model = value?.trim() || DEFAULT_LOCAL_WHISPER_MODEL;
  return MODEL_ALIASES[model] ?? model;
}

function resolveLocalWhisperModelRepo(model: string): string {
  return MODEL_REPOS[normalizeLocalWhisperModel(model)] ?? model;
}

function isPcm16Input(input: TranscriptionFileInput): boolean {
  return input.mimeType.toLowerCase().startsWith('audio/pcm') || input.fileName?.toLowerCase().endsWith('.pcm') === true;
}

function pcm16ToFloat32(data: Buffer): Float32Array {
  if (data.length === 0) {
    return new Float32Array();
  }
  if (data.length % 2 !== 0) {
    throw new Error('Local Whisper PCM audio must have an even byte length.');
  }

  const output = new Float32Array(data.length / 2);
  for (let offset = 0; offset < data.length; offset += 2) {
    const sample = data.readInt16LE(offset);
    output[offset / 2] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
  }
  return output;
}

async function getAsrPipeline(input: {
  model: string;
  modelRootPath: string;
  pipelineFactory?: AsrPipelineFactory;
}): Promise<AutomaticSpeechRecognitionPipelineType> {
  const repo = resolveLocalWhisperModelRepo(input.model);
  const key = `${input.modelRootPath}:${repo}`;
  const cached = pipelineCache.get(key);
  if (cached) {
    return cached;
  }

  const pipelineFactory = input.pipelineFactory ?? (await loadDefaultPipelineFactory());
  const created = pipelineFactory('automatic-speech-recognition', repo, {
    cache_dir: input.modelRootPath,
    quantized: true,
  }) as Promise<AutomaticSpeechRecognitionPipelineType>;
  pipelineCache.set(key, created);
  return created;
}

async function loadDefaultPipelineFactory(): Promise<AsrPipelineFactory> {
  const transformers = await import('@xenova/transformers');
  return transformers.pipeline;
}

async function readDirectorySize(path: string): Promise<number | null> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        total += (await readDirectorySize(entryPath)) ?? 0;
      } else if (entry.isFile()) {
        total += (await stat(entryPath)).size;
      }
    }
    return total;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function getLocalModelCachePath(modelRootPath: string, model: string): string {
  return join(modelRootPath, ...resolveLocalWhisperModelRepo(model).split('/'));
}

function readAsrText(output: Awaited<ReturnType<AutomaticSpeechRecognitionPipelineType>>): string {
  if (Array.isArray(output)) {
    return output.map((entry) => entry.text).join(' ').replace(/\s+/g, ' ').trim();
  }
  return output.text.replace(/\s+/g, ' ').trim();
}

export class LocalWhisperTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'local-whisper' as const;
  readonly label = 'Local Whisper';
  readonly transports: Array<'file'> = ['file'];
  private readonly model: string;
  private readonly modelRootPath: string;
  private readonly pipelineFactory?: AsrPipelineFactory;

  constructor(options: LocalWhisperTranscriptionProviderOptions) {
    this.model = normalizeLocalWhisperModel(options.model);
    this.modelRootPath = options.modelRootPath;
    this.pipelineFactory = options.pipelineFactory;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async installModel(): Promise<TranscriptionInstallResult> {
    await getAsrPipeline({
      model: this.model,
      modelRootPath: this.modelRootPath,
      pipelineFactory: this.pipelineFactory,
    });
    return {
      provider: this.id,
      model: this.model,
      cacheDir: this.modelRootPath,
    };
  }

  async getModelStatus(): Promise<TranscriptionModelStatus> {
    const sizeBytes = await readDirectorySize(getLocalModelCachePath(this.modelRootPath, this.model));
    return {
      provider: this.id,
      model: this.model,
      cacheDir: this.modelRootPath,
      installed: sizeBytes !== null && sizeBytes > 0,
      ...(sizeBytes !== null ? { sizeBytes } : {}),
    };
  }

  async transcribeFile(input: TranscriptionFileInput, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
    if (!isPcm16Input(input)) {
      throw new Error('Local Whisper requires browser-captured PCM audio.');
    }

    const audio = pcm16ToFloat32(input.data);
    if (audio.length === 0) {
      throw new Error('Local Whisper requires non-empty audio.');
    }

    const transcriber = await getAsrPipeline({
      model: this.model,
      modelRootPath: this.modelRootPath,
      pipelineFactory: this.pipelineFactory,
    });
    const raw = await transcriber(audio, {
      ...(options.language ? { language: options.language } : {}),
      task: 'transcribe',
    });
    const text = readAsrText(raw);
    if (!text) {
      throw new Error('Local Whisper returned an empty transcript. Try speaking longer or check microphone input.');
    }

    return {
      text,
      provider: this.id,
      model: this.model,
      ...(options.language ? { language: options.language } : {}),
      durationMs: Math.round((audio.length / PCM_SAMPLE_RATE) * 1000),
    };
  }
}

export const testExports = {
  normalizeLocalWhisperModel,
  resolveLocalWhisperModelRepo,
  pcm16ToFloat32,
  readAsrText,
  getLocalModelCachePath,
};
