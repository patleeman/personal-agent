export interface DictationSettings {
  enabled: boolean;
  model: string;
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
  provider: string;
  model?: string;
  language?: string;
  durationMs?: number;
  segments?: TranscriptionSegment[];
}

export interface TranscriptionInstallResult {
  provider: string;
  model: string;
  cacheDir: string;
}

export interface TranscriptionModelStatus {
  provider: string;
  model: string;
  cacheDir: string;
  installed: boolean;
  sizeBytes?: number;
}
