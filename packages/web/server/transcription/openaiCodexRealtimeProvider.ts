import { arch, platform } from 'node:os';
import WebSocket from 'ws';
import type { Api, Model } from '@mariozechner/pi-ai';
import type {
  TranscriptionAudioChunk,
  TranscriptionFileInput,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionStreamEvent,
} from './types.js';

const DEFAULT_CODEX_REALTIME_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_SAMPLE_RATE = 24_000;

type AuthResult = { ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string };

type ModelRegistryLike = {
  find(provider: string, modelId: string): Model<Api> | undefined;
  getApiKeyAndHeaders(model: Model<Api>): Promise<AuthResult>;
};

interface OpenAICodexRealtimeProviderOptions {
  modelRegistry: ModelRegistryLike;
  model?: string;
  WebSocketCtor?: typeof WebSocket;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveCodexRealtimeWebSocketUrl(baseUrl: string | undefined): string {
  const normalized = trimTrailingSlashes(baseUrl?.trim() || DEFAULT_CODEX_REALTIME_BASE_URL);

  if (normalized.startsWith('ws://') || normalized.startsWith('wss://')) {
    return normalized.endsWith('/realtime') ? normalized : `${normalized}/realtime`;
  }

  const url = new URL(normalized);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  if (!url.pathname.endsWith('/realtime')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/realtime`;
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

function buildCodexRealtimeHeaders(input: {
  apiKey: string;
  headers?: Record<string, string>;
}): Record<string, string> {
  const headers = new Headers(input.headers ?? {});
  headers.set('Authorization', `Bearer ${input.apiKey}`);
  headers.set('OpenAI-Beta', 'realtime=v1');
  headers.set('originator', 'pi');
  headers.set('user-agent', `personal-agent/transcription (${platform()}; ${arch()})`);

  const accountId = extractCodexAccountId(input.apiKey);
  if (accountId) {
    headers.set('chatgpt-account-id', accountId);
  }

  return Object.fromEntries(headers.entries());
}

function createSessionUpdate(model: string) {
  return {
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: DEFAULT_SAMPLE_RATE },
          transcription: { model },
        },
      },
    },
  };
}

function normalizeChunk(chunk: TranscriptionAudioChunk): string {
  if (chunk.format !== 'pcm16') {
    throw new Error(`Codex realtime transcription requires pcm16 audio chunks; received ${chunk.format}.`);
  }
  if (chunk.sampleRate !== DEFAULT_SAMPLE_RATE) {
    throw new Error(`Codex realtime transcription requires ${DEFAULT_SAMPLE_RATE} Hz audio; received ${chunk.sampleRate} Hz.`);
  }
  return chunk.data.toString('base64');
}

function parseRealtimeTranscriptEvent(raw: unknown): TranscriptionStreamEvent | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const event = raw as { type?: unknown; delta?: unknown; transcript?: unknown };
  if (event.type === 'conversation.item.input_audio_transcription.delta' && typeof event.delta === 'string') {
    return { type: 'delta', delta: event.delta };
  }

  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    const text = typeof event.transcript === 'string' ? event.transcript : '';
    return {
      type: 'done',
      text,
      result: {
        text,
        provider: 'openai-codex-realtime',
        model: DEFAULT_TRANSCRIPTION_MODEL,
      },
    };
  }

  if (event.type === 'error') {
    const message = typeof (raw as { error?: { message?: unknown } }).error?.message === 'string'
      ? String((raw as { error?: { message?: unknown } }).error?.message)
      : 'Codex realtime transcription failed.';
    return { type: 'error', error: message };
  }

  return null;
}

async function waitForOpen(socket: WebSocket, signal?: AbortSignal): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off('open', onOpen);
      socket.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onAbort = () => { cleanup(); reject(new Error('Transcription aborted.')); };

    socket.once('open', onOpen);
    socket.once('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class OpenAICodexRealtimeTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'openai-codex-realtime' as const;
  readonly label = 'OpenAI Codex Realtime';
  readonly transports: Array<'stream' | 'file'> = ['stream', 'file'];
  private readonly modelRegistry: ModelRegistryLike;
  private readonly modelId: string;
  private readonly WebSocketCtor: typeof WebSocket;

  constructor(options: OpenAICodexRealtimeProviderOptions) {
    this.modelRegistry = options.modelRegistry;
    this.modelId = options.model?.trim() || DEFAULT_TRANSCRIPTION_MODEL;
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket;
  }

  async isAvailable(): Promise<boolean> {
    const target = await this.resolveTarget();
    return target !== null;
  }

  async transcribeFile(input: TranscriptionFileInput, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
    if (input.mimeType !== 'audio/pcm' && input.mimeType !== 'audio/L16') {
      throw new Error('Codex realtime file transcription currently expects 24 kHz pcm16 audio. Convert recorded audio before calling this provider.');
    }

    const events = this.stream((async function* () {
      yield { data: input.data, format: 'pcm16' as const, sampleRate: DEFAULT_SAMPLE_RATE };
    })(), options);

    let text = '';
    for await (const event of events) {
      if (event.type === 'delta') {
        text += event.delta;
      } else if (event.type === 'done') {
        return { ...event.result, text: event.text || text, model: this.modelId };
      } else if (event.type === 'error') {
        throw new Error(event.error);
      }
    }

    return { text, provider: this.id, model: this.modelId };
  }

  async *stream(chunks: AsyncIterable<TranscriptionAudioChunk>, options: TranscriptionOptions = {}): AsyncIterable<TranscriptionStreamEvent> {
    const target = await this.resolveTarget();
    if (!target) {
      throw new Error('OpenAI Codex transcription requires configured openai-codex auth.');
    }

    const socket = new this.WebSocketCtor(target.url, { headers: target.headers });
    const pendingEvents: TranscriptionStreamEvent[] = [];
    let done = false;
    let failure: Error | null = null;
    let notify: (() => void) | null = null;

    const wake = () => {
      notify?.();
      notify = null;
    };

    socket.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as unknown;
        const event = parseRealtimeTranscriptEvent(parsed);
        if (event) {
          pendingEvents.push(event);
          if (event.type === 'done' || event.type === 'error') {
            done = true;
          }
          wake();
        }
      } catch (error) {
        failure = error as Error;
        done = true;
        wake();
      }
    });

    socket.on('error', (error) => {
      failure = error;
      done = true;
      wake();
    });
    socket.on('close', () => {
      done = true;
      wake();
    });

    await waitForOpen(socket, options.signal);
    socket.send(JSON.stringify(createSessionUpdate(this.modelId)));

    void (async () => {
      try {
        for await (const chunk of chunks) {
          socket.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: normalizeChunk(chunk),
          }));
        }
        socket.send(JSON.stringify({ type: 'response.create' }));
      } catch (error) {
        failure = error as Error;
        done = true;
        wake();
      }
    })();

    try {
      while (!done || pendingEvents.length > 0) {
        const event = pendingEvents.shift();
        if (event) {
          yield event.type === 'done'
            ? { ...event, result: { ...event.result, model: this.modelId } }
            : event;
          continue;
        }

        if (failure) {
          throw failure;
        }

        await new Promise<void>((resolve) => { notify = resolve; });
      }

      if (failure) {
        throw failure;
      }
    } finally {
      socket.close();
    }
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
      url: resolveCodexRealtimeWebSocketUrl(model.baseUrl),
      headers: buildCodexRealtimeHeaders({ apiKey: auth.apiKey, headers: auth.headers }),
    };
  }
}

export const testExports = {
  resolveCodexRealtimeWebSocketUrl,
  buildCodexRealtimeHeaders,
  createSessionUpdate,
  parseRealtimeTranscriptEvent,
};
