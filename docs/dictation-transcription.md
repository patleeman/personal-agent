# Dictation transcription

PA dictation is local-first. The composer captures microphone audio as 16 kHz mono PCM, sends it to the server, and the server transcribes it with a local Whisper model via Transformers.js/ONNX Runtime. No OpenAI dictation backend is used.

## Settings

Runtime settings live in the normal web/profile `settings.json` file under `transcription`:

```json
{
  "transcription": {
    "provider": "local-whisper",
    "model": "base.en"
  }
}
```

Supported provider ids:

| Provider        | Status      | Transports | Notes                                                                                                                                                                                 |
| --------------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local-whisper` | implemented | file       | Runs `Xenova/whisper-*` models locally through Transformers.js. Models are downloaded into the runtime `transcription-models/` cache on first use or via the Settings install button. |

Recommended models:

- `tiny.en`: fastest smoke-test / low accuracy.
- `base.en`: default; good enough for short dictation.
- `small.en`: better accuracy, slower first load and inference.
- `medium.en`: heavier local option.

The provider still accepts legacy model ids like `openai_whisper-base` and normalizes them to Whisper model names.

Models are not bundled with the app. Even `tiny.en` is roughly tens of MB on disk, while the better models are much larger, so the app downloads the selected quantized model on demand and reuses the local cache after that. Settings exposes **Install local model** to preload the selected model instead of making the first dictation do the download, and it shows whether the selected provider/model is already installed locally.

## Request flow

The settings API is:

```text
GET   /api/transcription/settings
PATCH /api/transcription/settings
POST  /api/transcription/install-model
POST  /api/transcription/model-status
POST  /api/transcription/transcribe-file
```

`POST /api/transcription/install-model` accepts JSON:

```json
{
  "provider": "local-whisper",
  "model": "base.en"
}
```

It downloads/loads the selected local model into the runtime cache and returns the cache path.

`POST /api/transcription/model-status` accepts the same provider/model body and returns whether the local cache already contains files for that model.

`POST /api/transcription/transcribe-file` accepts JSON:

```json
{
  "dataBase64": "...",
  "mimeType": "audio/pcm;rate=16000;channels=1",
  "fileName": "dictation.pcm",
  "language": "en"
}
```

The web composer no longer uses `MediaRecorder`/WebM for dictation. It uses `AudioContext`, resamples to 16 kHz mono PCM, and sends raw little-endian PCM16 bytes. This avoids server-side ffmpeg, native compiler toolchains, and cloud transcription services.

## Provider abstraction

Server-side providers implement `TranscriptionProvider`:

```ts
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

The current UI is still batch dictation: record audio, stop, transcribe, then insert the final text. Streaming dictation can reuse the same PCM capture path later by sending chunks instead of one final buffer.
