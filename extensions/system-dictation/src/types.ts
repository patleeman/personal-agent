export type TranscriptionProviderId = 'local-whisper';

export type TranscriptionTransport = 'stream' | 'file';

export interface TranscriptionSettings {
  provider: TranscriptionProviderId | null;
  model: string;
}

export interface TranscriptionAudioChunk {
  data: Buffer;
  format: 'pcm16';
  sampleRate: number;
}

export interface TranscriptionFileInput {
  data: Buffer;
  mimeType: string;
  fileName?: string;
}

export interface TranscriptionOptions {
  language?: string;
  signal?: AbortSignal;
}

export interface TranscriptionSegment {
  startMs?: number;
  endMs?: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  provider: TranscriptionProviderId;
  model?: string;
  language?: string;
  durationMs?: number;
  segments?: TranscriptionSegment[];
}

export interface TranscriptionInstallResult {
  provider: TranscriptionProviderId;
  model: string;
  cacheDir: string;
}

export interface TranscriptionModelStatus {
  provider: TranscriptionProviderId;
  model: string;
  cacheDir: string;
  installed: boolean;
  sizeBytes?: number;
}

export type TranscriptionStreamEvent =
  | { type: 'delta'; delta: string }
  | { type: 'done'; text: string; result: TranscriptionResult }
  | { type: 'error'; error: string };

export interface TranscriptionProvider {
  id: TranscriptionProviderId;
  label: string;
  transports: TranscriptionTransport[];
  isAvailable(): Promise<boolean>;
  installModel?(): Promise<TranscriptionInstallResult>;
  getModelStatus?(): Promise<TranscriptionModelStatus>;
  transcribeFile?(input: TranscriptionFileInput, options?: TranscriptionOptions): Promise<TranscriptionResult>;
  stream?(chunks: AsyncIterable<TranscriptionAudioChunk>, options?: TranscriptionOptions): AsyncIterable<TranscriptionStreamEvent>;
}

export interface TranscriptionProviderRegistry {
  get(providerId: TranscriptionProviderId): TranscriptionProvider | undefined;
  list(): TranscriptionProvider[];
  require(providerId: TranscriptionProviderId | null | undefined): TranscriptionProvider;
}
