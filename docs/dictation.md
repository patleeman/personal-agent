# Dictation

Dictation is local-first. The desktop app captures microphone audio, sends it to the server, and the server transcribes it with a local Whisper model via whisper.cpp (whisper-cpp-node). No cloud transcription backend is used.

## Architecture

```
Desktop UI (AudioContext) ──► Server (whisper-cpp-node) ──► Transcribed text
       │                             │
       │ 16 kHz mono PCM            │ GGML model file
       │ raw little-endian          │ from HuggingFace
       │                             │
```

The desktop composer uses `AudioContext` to capture and resample microphone input to 16 kHz mono PCM. The raw PCM16 bytes are sent to the server. No ffmpeg, no compiler toolchains, no cloud services.

## Settings

Runtime settings live in `settings.json` under `transcription`:

```json
{
  "transcription": {
    "provider": "local-whisper",
    "model": "base.en"
  }
}
```

Configure these in the Settings UI under the Dictation section.

## Models

| Model       | Size    | Notes                                            |
| ----------- | ------- | ------------------------------------------------ |
| `tiny.en`   | ~40 MB  | Fastest, lowest accuracy. Use for smoke tests    |
| `base.en`   | ~75 MB  | Default. Good balance of speed and accuracy      |
| `small.en`  | ~240 MB | Better accuracy, slower first load and inference |
| `medium.en` | ~770 MB | Heavier local option                             |

Models are downloaded from the [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) HuggingFace repository as GGML binary files and cached in the runtime `transcription-models/` directory.

The provider accepts legacy model IDs like `openai_whisper-base` and normalizes them to the whisper.cpp naming convention.

### Installing models

Models are not bundled with the app. They download on first use. To preload a model before first dictation, use the Settings "Install local model" button. The Settings UI shows whether the selected model is already installed.

## API Reference

| Method | Endpoint                             | Description                           |
| ------ | ------------------------------------ | ------------------------------------- |
| GET    | `/api/transcription/settings`        | Get current transcription settings    |
| PATCH  | `/api/transcription/settings`        | Update provider or model              |
| POST   | `/api/transcription/install-model`   | Download and cache the selected model |
| POST   | `/api/transcription/model-status`    | Check if the model is installed       |
| POST   | `/api/transcription/transcribe-file` | Transcribe audio data                 |

### Install model

```json
// POST /api/transcription/install-model
{ "provider": "local-whisper", "model": "base.en" }

// Response
{ "provider": "local-whisper", "model": "base.en", "cacheDir": "/path/to/models" }
```

### Model status

```json
// POST /api/transcription/model-status
{ "provider": "local-whisper", "model": "base.en" }

// Response
{ "provider": "local-whisper", "model": "base.en", "installed": true, "sizeBytes": 75000000, "cacheDir": "/path/to/models" }
```

### Transcribe

```json
// POST /api/transcription/transcribe-file
{
  "dataBase64": "...",
  "mimeType": "audio/pcm;rate=16000;channels=1",
  "fileName": "dictation.pcm",
  "language": "en"
}

// Response
{ "text": "transcribed text", "provider": "local-whisper", "model": "base.en", "durationMs": 3200 }
```

## Provider Interface

Server-side transcription providers implement this interface:

```typescript
interface TranscriptionProvider {
  id: TranscriptionProviderId;
  label: string;
  transports: Array<'stream' | 'file'>;
  isAvailable(): Promise<boolean>;
  installModel?(): Promise<TranscriptionInstallResult>;
  getModelStatus?(): Promise<TranscriptionModelStatus>;
  transcribeFile?(input: TranscriptionFileInput, options?: TranscriptionOptions): Promise<TranscriptionResult>;
  stream?(chunks: AsyncIterable<TranscriptionAudioChunk>, options?: TranscriptionOptions): AsyncIterable<TranscriptionStreamEvent>;
}
```

Currently only `local-whisper` is supported, with `file` transport. Streaming is not yet implemented.
