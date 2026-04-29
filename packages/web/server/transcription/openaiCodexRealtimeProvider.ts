import { arch, platform } from 'node:os';
import type { Api, Model } from '@mariozechner/pi-ai';
import type {
  TranscriptionFileInput,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from './types.js';

const DEFAULT_CODEX_TRANSCRIBE_BASE_URL = 'https://chatgpt.com/backend-api';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const CODEX_ORIGINATOR = 'codex_cli_rs';

type AuthResult = { ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string };

type ModelRegistryLike = {
  find(provider: string, modelId: string): Model<Api> | undefined;
  getApiKeyAndHeaders(model: Model<Api>): Promise<AuthResult>;
};

interface OpenAICodexRealtimeProviderOptions {
  modelRegistry: ModelRegistryLike;
  model?: string;
  fetch?: typeof fetch;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveCodexTranscribeUrl(baseUrl: string | undefined): string {
  const normalized = trimTrailingSlashes(baseUrl?.trim() || DEFAULT_CODEX_TRANSCRIBE_BASE_URL);
  const url = new URL(normalized);
  const path = trimTrailingSlashes(url.pathname);

  if (path === '' || path === '/') {
    url.pathname = '/backend-api/transcribe';
  } else if (path === '/backend-api') {
    url.pathname = '/backend-api/transcribe';
  } else if (path === '/backend-api/codex') {
    url.pathname = '/backend-api/transcribe';
  } else if (!path.endsWith('/transcribe')) {
    url.pathname = `${path}/transcribe`;
  }

  return url.toString();
}

function extractCodexAccountId(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      ['https://api.openai.com/auth']?: { chatgpt_account_id?: string };
    };
    const accountId = payload['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof accountId === 'string' && accountId.trim().length > 0 ? accountId.trim() : undefined;
  } catch {
    return undefined;
  }
}

function buildCodexTranscribeHeaders(input: {
  apiKey: string;
  headers?: Record<string, string>;
}): Record<string, string> {
  const headers = new Headers(input.headers ?? {});
  headers.set('Authorization', `Bearer ${input.apiKey}`);
  headers.set('originator', CODEX_ORIGINATOR);
  headers.set('user-agent', `personal-agent/transcription (${platform()}; ${arch()})`);

  const accountId = extractCodexAccountId(input.apiKey);
  if (accountId) {
    headers.set('chatgpt-account-id', accountId);
  }

  return Object.fromEntries(headers.entries());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseTranscribeResponse(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(parseTranscribeResponse).filter(Boolean).join(' ');
  }

  if (!isRecord(value)) {
    return '';
  }

  for (const key of ['text', 'transcript', 'transcription']) {
    const candidate = parseTranscribeResponse(value[key]);
    if (candidate.trim()) {
      return candidate;
    }
  }

  for (const key of ['segments', 'items', 'results']) {
    const candidate = parseTranscribeResponse(value[key]);
    if (candidate.trim()) {
      return candidate;
    }
  }

  return '';
}

export class OpenAICodexRealtimeTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'openai-codex-realtime' as const;
  readonly label = 'OpenAI Codex Transcribe';
  readonly transports: Array<'stream' | 'file'> = ['file'];
  private readonly modelRegistry: ModelRegistryLike;
  private readonly modelId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICodexRealtimeProviderOptions) {
    this.modelRegistry = options.modelRegistry;
    this.modelId = options.model?.trim() || DEFAULT_TRANSCRIPTION_MODEL;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async isAvailable(): Promise<boolean> {
    const target = await this.resolveTarget();
    return target !== null;
  }

  async transcribeFile(input: TranscriptionFileInput, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
    const target = await this.resolveTarget();
    if (!target) {
      throw new Error('OpenAI Codex transcription requires configured openai-codex auth.');
    }

    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.data)], { type: input.mimeType || 'application/octet-stream' });
    form.append('file', blob, input.fileName || 'dictation.webm');
    if (options.language) {
      form.append('language', options.language);
    }

    const response = await this.fetchImpl(target.url, {
      method: 'POST',
      headers: target.headers,
      body: form,
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`Codex transcription failed: ${response.status} ${response.statusText}`);
    }

    const raw = await response.json() as unknown;
    const text = parseTranscribeResponse(raw).trim();
    if (!text) {
      throw new Error('Codex transcription returned an empty transcript. Try speaking longer or check microphone input.');
    }

    return {
      text,
      provider: this.id,
      model: this.modelId,
      ...(options.language ? { language: options.language } : {}),
    };
  }

  private async resolveTarget(): Promise<{ url: string; headers: Record<string, string> } | null> {
    const model = this.modelRegistry.find('openai-codex', 'gpt-5.4')
      ?? this.modelRegistry.find('openai-codex', 'gpt-5.4-mini')
      ?? this.modelRegistry.find('openai-codex', 'gpt-5.2')
      ?? this.modelRegistry.find('openai-codex', 'gpt-5.1-codex-mini');
    if (!model) {
      return null;
    }

    const auth = await this.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      return null;
    }

    return {
      url: resolveCodexTranscribeUrl(model.baseUrl),
      headers: buildCodexTranscribeHeaders({ apiKey: auth.apiKey, headers: auth.headers }),
    };
  }
}

export const testExports = {
  resolveCodexTranscribeUrl,
  buildCodexTranscribeHeaders,
  parseTranscribeResponse,
};
