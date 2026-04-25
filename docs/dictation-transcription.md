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
| `openai-codex-realtime` | implemented | stream, file | Uses configured `openai-codex` auth and the ChatGPT/Codex realtime transcription path. |
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
  "mimeType": "audio/pcm",
  "fileName": "dictation.pcm",
  "language": "en"
}
```

For Codex realtime, file transcription is implemented by sending the PCM bytes through the streaming provider and collecting transcript events. The first implementation expects 24 kHz 16-bit PCM audio. The UI layer should normalize recorder output before calling this endpoint.

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

## Codex realtime notes

The Codex provider uses `openai-codex` model auth from the existing model registry, then opens a realtime websocket using the Codex realtime model. PA keeps two models separate:

- websocket/session model: `gpt-realtime-1.5`
- transcription model from Settings: usually `gpt-4o-mini-transcribe`

Default target:

```text
wss://chatgpt.com/backend-api/codex?model=gpt-realtime-1.5
```

The normal `openai-codex` provider base URL in PA is often `https://chatgpt.com/backend-api`; the adapter normalizes that to `/backend-api/codex` before converting it to `wss://`. It also sends bearer auth, `originator: codex_cli_rs`, and an `x-session-id` header, matching the Codex realtime websocket handshake shape.

Session setup mirrors Codex transcription mode:

```json
{
  "type": "session.update",
  "session": {
    "type": "transcription",
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transcription": { "model": "gpt-4o-mini-transcribe" }
      }
    }
  }
}
```

Transcript events are normalized from `conversation.item.input_audio_transcription.delta` and `conversation.item.input_audio_transcription.completed` into PA's provider-neutral event/result shape.
