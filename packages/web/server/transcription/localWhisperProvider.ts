import { existsSync, mkdirSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const MODEL_FILE_NAMES: Record<string, string> = {
  tiny: 'ggml-tiny.bin',
  'tiny.en': 'ggml-tiny.en.bin',
  base: 'ggml-base.bin',
  'base.en': 'ggml-base.en.bin',
  small: 'ggml-small.bin',
  'small.en': 'ggml-small.en.bin',
  medium: 'ggml-medium.bin',
  'medium.en': 'ggml-medium.en.bin',
};

const MODEL_DOWNLOAD_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

type WhisperContext = Awaited<ReturnType<typeof import('whisper-cpp-node').createWhisperContext>>;

interface WhisperCppNodeModule {
  createWhisperContext(options: { model: string; use_gpu?: boolean; no_prints?: boolean }): WhisperContext;
  transcribeAsync(ctx: WhisperContext, options: { pcmf32: Float32Array; language?: string; no_timestamps?: boolean; no_prints?: boolean }): Promise<{ segments: Array<[string, string, string]> }>;
}

interface WhisperCppTranscriptionProviderOptions {
  model?: string;
  modelRootPath: string;
}

const contextCache = new Map<string, { ctx: WhisperContext; module: WhisperCppNodeModule }>();

function normalizeLocalWhisperModel(value: string | undefined): string {
  const model = value?.trim() || DEFAULT_LOCAL_WHISPER_MODEL;
  return MODEL_ALIASES[model] ?? model;
}

function resolveModelFileName(model: string): string {
  return MODEL_FILE_NAMES[normalizeLocalWhisperModel(model)] ?? `ggml-${model}.bin`;
}

function resolveModelFilePath(modelRootPath: string, model: string): string {
  return join(modelRootPath, resolveModelFileName(model));
}

function resolveModelDownloadUrl(model: string): string {
  return `${MODEL_DOWNLOAD_BASE_URL}/${resolveModelFileName(model)}`;
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

const _require = createRequire(fileURLToPath(import.meta.url));

let whisperCppModule: WhisperCppNodeModule | undefined;

function loadWhisperCpp(): WhisperCppNodeModule {
  if (!whisperCppModule) {
    whisperCppModule = _require('whisper-cpp-node') as WhisperCppNodeModule;
  }
  return whisperCppModule;
}

function getOrCreateContext(
  modelRootPath: string,
  model: string,
  module_: WhisperCppNodeModule,
): WhisperContext {
  const normalizedModel = normalizeLocalWhisperModel(model);
  const modelPath = resolveModelFilePath(modelRootPath, normalizedModel);
  const cacheKey = modelPath;
  const cached = contextCache.get(cacheKey);
  if (cached && cached.module === module_) {
    return cached.ctx;
  }

  if (!existsSync(modelPath)) {
    throw new Error(
      `Whisper model not found at ${modelPath}. Download it first via the Settings page or manually:\n`
      + `curl -L -o "${modelPath}" "${resolveModelDownloadUrl(normalizedModel)}"`,
    );
  }

  const ctx = module_.createWhisperContext({
    model: modelPath,
    use_gpu: true,
    no_prints: true,
  });
  contextCache.set(cacheKey, { ctx, module: module_ });
  return ctx;
}

function formatWhisperSegments(segments: Array<[string, string, string]>): string {
  return segments
    .map(([, , text]) => text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function downloadModel(modelRootPath: string, model: string): Promise<void> {
  const normalizedModel = normalizeLocalWhisperModel(model);
  const modelPath = resolveModelFilePath(modelRootPath, normalizedModel);

  if (existsSync(modelPath)) {
    return;
  }

  mkdirSync(modelRootPath, { recursive: true });

  const url = resolveModelDownloadUrl(normalizedModel);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download whisper model: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(modelPath, buffer);
}

async function getModelFileSize(modelRootPath: string, model: string): Promise<number | null> {
  const modelPath = resolveModelFilePath(modelRootPath, normalizeLocalWhisperModel(model));

  try {
    const stats = statSync(modelPath);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

export class LocalWhisperTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'local-whisper' as const;
  readonly label = 'Local Whisper';
  readonly transports: Array<'file'> = ['file'];
  private readonly model: string;
  private readonly modelRootPath: string;

  constructor(options: WhisperCppTranscriptionProviderOptions) {
    this.model = normalizeLocalWhisperModel(options.model);
    this.modelRootPath = options.modelRootPath;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async installModel(): Promise<TranscriptionInstallResult> {
    await downloadModel(this.modelRootPath, this.model);
    return {
      provider: this.id,
      model: this.model,
      cacheDir: this.modelRootPath,
    };
  }

  async getModelStatus(): Promise<TranscriptionModelStatus> {
    const sizeBytes = await getModelFileSize(this.modelRootPath, this.model);
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

    const whisperModule = loadWhisperCpp();
    const ctx = getOrCreateContext(this.modelRootPath, this.model, whisperModule);

    const result = await whisperModule.transcribeAsync(ctx, {
      pcmf32: audio,
      language: options.language === 'auto' ? undefined : options.language,
      no_timestamps: true,
      no_prints: true,
    });

    const text = formatWhisperSegments(result.segments);
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
  resolveModelFileName,
  resolveModelDownloadUrl,
  pcm16ToFloat32,
  resolveModelFilePath,
  formatWhisperSegments,
};
