# Dictation transcription

PA dictation uses an explicit transcription provider setting. There is intentionally no auto-provider resolution: if dictation is enabled, the selected provider is the one used, and failures stay visible.

## Settings

Runtime settings live in the normal web/profile `settings.json` file under `transcription`:

```json
{
  "transcription": {
    "provider": "openai-codex-realtime",
    "model": "gpt-4o-mini-transcribe"
  }
}
```

Supported provider ids:

| Provider | Status | Transports | Notes |
| --- | --- | --- | --- |
| `openai-codex-realtime` | implemented | file | Historical id. Uses configured `openai-codex` auth and the ChatGPT/Codex `/backend-api/transcribe` endpoint. |
| `openai-api` | planned | file, stream | Should adapt the official OpenAI audio/realtime APIs. Not implemented yet. |
| `whisperkit-local` | planned | file, stream | Should call a local Swift/WhisperKit helper on macOS and native WhisperKit on iOS. Not implemented yet. |

The settings API is:

```text
GET   /api/transcription/settings
PATCH /api/transcription/settings
POST  /api/transcription/transcribe-file
```

`POST /api/transcription/transcribe-file` currently accepts JSON:

```json
{
  "dataBase64": "...",
  "mimeType": "audio/webm;codecs=opus",
  "fileName": "dictation.webm",
  "language": "en"
}
```

The web composer records with `MediaRecorder` and prefers `audio/webm;codecs=opus`, matching Codex desktop’s upload-style dictation path. The server forwards the captured file as multipart form-data to the selected provider.

## Provider abstraction

Server-side providers implement `TranscriptionProvider`:

```ts
interface TranscriptionProvider {
  id: TranscriptionProviderId
  label: string
  transports: Array<'stream' | 'file'>
  isAvailable(): Promise<boolean>
  transcribeFile?(input: TranscriptionFileInput, options?: TranscriptionOptions): Promise<TranscriptionResult>
  stream?(chunks: AsyncIterable<TranscriptionAudioChunk>, options?: TranscriptionOptions): AsyncIterable<TranscriptionStreamEvent>
}
```

This keeps the composer and iOS UI dumb: record audio, pass chunks or a normalized file to the selected provider, insert returned text. New models should add a provider adapter instead of leaking backend-specific protocol into the UI.

## Codex transcribe notes

Codex desktop dictation uses an upload endpoint rather than the realtime websocket endpoint. PA mirrors that shape for the `openai-codex-realtime` provider id:

```text
POST https://chatgpt.com/backend-api/transcribe
Content-Type: multipart/form-data; boundary=...
Authorization: Bearer <openai-codex token>
originator: codex_cli_rs

file=<audio blob>
language=<optional>
```

The normal `openai-codex` provider base URL in PA is often `https://chatgpt.com/backend-api`; the adapter normalizes that to `/backend-api/transcribe`. If a custom base URL ends in `/backend-api/codex`, the adapter also normalizes it back to `/backend-api/transcribe` because this endpoint is not under the `/codex` path.

The expected response is:

```json
{ "text": "transcribed text" }
```

The Settings “model” field remains provider configuration for future adapters, but Codex’s current `/transcribe` endpoint does not expose a model parameter in the observed desktop-app request shape.
