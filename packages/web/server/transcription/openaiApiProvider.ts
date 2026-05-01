import type { Api, Model } from '@mariozechner/pi-ai';
import type {
  TranscriptionFileInput,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionSegment,
} from './types.js';

const DEFAULT_OPENAI_AUDIO_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

type AuthResult = { ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string };

type ModelRegistryLike = {
  find(provider: string, modelId: string): Model<Api> | undefined;
  getApiKeyAndHeaders(model: Model<Api>): Promise<AuthResult>;
};

interface OpenAITranscriptionProviderOptions {
  modelRegistry: ModelRegistryLike;
  model?: string;
  fetch?: typeof fetch;
}

function parseOpenAITranscriptionResponse(value: unknown): { text: string; durationMs?: number; segments?: TranscriptionSegment[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { text: '' };
  }

  const record = value as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  const durationMs = typeof record.duration === 'number' && Number.isFinite(record.duration)
    ? Math.max(0, Math.round(record.duration * 1000))
    : undefined;
  const rawSegments = Array.isArray(record.segments) ? record.segments : [];
  const segments = rawSegments
    .map((segment): TranscriptionSegment | null => {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
        return null;
      }
      const segmentRecord = segment as Record<string, unknown>;
      const segmentText = typeof segmentRecord.text === 'string' ? segmentRecord.text.trim() : '';
      if (!segmentText) {
        return null;
      }
      return {
        text: segmentText,
        ...(typeof segmentRecord.start === 'number' ? { startMs: Math.max(0, Math.round(segmentRecord.start * 1000)) } : {}),
        ...(typeof segmentRecord.end === 'number' ? { endMs: Math.max(0, Math.round(segmentRecord.end * 1000)) } : {}),
      };
    })
    .filter((segment): segment is TranscriptionSegment => segment !== null);

  return {
    text,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(segments.length > 0 ? { segments } : {}),
  };
}

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly id = 'openai-api' as const;
  readonly label = 'OpenAI API transcription';
  readonly transports: Array<'file'> = ['file'];
  private readonly modelRegistry: ModelRegistryLike;
  private readonly modelId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAITranscriptionProviderOptions) {
    this.modelRegistry = options.modelRegistry;
    this.modelId = options.model?.trim() || DEFAULT_TRANSCRIPTION_MODEL;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async isAvailable(): Promise<boolean> {
    const auth = await this.resolveAuth();
    return auth !== null;
  }

  async transcribeFile(input: TranscriptionFileInput, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
    const auth = await this.resolveAuth();
    if (!auth) {
      throw new Error('OpenAI API transcription requires configured openai auth. Add an OpenAI API key in Settings → Providers.');
    }

    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.data)], { type: input.mimeType || 'application/octet-stream' });
    form.append('file', blob, input.fileName || 'dictation.webm');
    form.append('model', this.modelId);
    form.append('response_format', 'verbose_json');
    if (options.language) {
      form.append('language', options.language);
    }

    const headers = new Headers(auth.headers ?? {});
    headers.set('Authorization', `Bearer ${auth.apiKey}`);

    const response = await this.fetchImpl(DEFAULT_OPENAI_AUDIO_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers,
      body: form,
      signal: options.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI transcription failed: ${response.status} ${response.statusText}${rawText ? ` ${rawText.slice(0, 240)}` : ''}`);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(rawText) as unknown;
    } catch {
      throw new Error('OpenAI transcription returned non-JSON response.');
    }

    const parsed = parseOpenAITranscriptionResponse(raw);
    if (!parsed.text) {
      throw new Error('OpenAI transcription returned an empty transcript. Try speaking longer or check microphone input.');
    }

    return {
      text: parsed.text,
      provider: this.id,
      model: this.modelId,
      ...(options.language ? { language: options.language } : {}),
      ...(parsed.durationMs !== undefined ? { durationMs: parsed.durationMs } : {}),
      ...(parsed.segments ? { segments: parsed.segments } : {}),
    };
  }

  private async resolveAuth(): Promise<{ apiKey: string; headers?: Record<string, string> } | null> {
    const model = this.modelRegistry.find('openai', 'gpt-4o')
      ?? this.modelRegistry.find('openai', 'gpt-4.1')
      ?? this.modelRegistry.find('openai', 'gpt-4');
    if (!model) {
      return null;
    }

    const auth = await this.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey?.trim()) {
      return null;
    }

    return {
      apiKey: auth.apiKey.trim(),
      headers: auth.headers,
    };
  }
}

export const testExports = {
  parseOpenAITranscriptionResponse,
};
