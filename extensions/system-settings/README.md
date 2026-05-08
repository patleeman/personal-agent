# Settings Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/settings.md -->

# Settings

The Settings panel is the desktop UI for all configuration. Open it from the app menu, `Cmd+,`, or navigate to `/settings`.

## Sections

| Section            | What it controls                                       |
| ------------------ | ------------------------------------------------------ |
| Theme              | Light, dark, or system-follow                          |
| Keyboard Shortcuts | View, customize, and search every shortcut             |
| Providers          | API provider configuration (add, remove, edit)         |
| Models             | Default provider, default model, model selection       |
| Dictation          | Transcription provider, model selection, model install |
| Daemon             | Daemon status, keep-awake toggle                       |

## Theme

Three options:

- **Light** — light background, dark text
- **Dark** — dark background, light text (default)
- **System** — follows the OS appearance setting

## Keyboard Shortcut Editor

Every desktop menu shortcut is listed in a searchable table. Each entry shows:

- Action name
- Current keybinding
- Edit button to change

Changes auto-save immediately. If a shortcut conflicts with an existing one, the editor shows the conflict and lets you resolve it.

Search by action name (e.g., "toggle sidebar") or by key (e.g., "Cmd+\").

## Provider Configuration

The Providers section lists all configured API providers:

| Provider       | Auth type        | Status                      |
| -------------- | ---------------- | --------------------------- |
| Anthropic      | API key or OAuth | Configured / Not configured |
| OpenAI         | API key          | Configured / Not configured |
| Google         | API key          | Configured / Not configured |
| GitHub Copilot | OAuth            | Configured / Not configured |

Add a new provider by selecting the type and entering credentials. Remove or edit existing providers.

## Model Configuration

Set defaults for:

- **Default provider** — which provider to use by default
- **Default model** — which model to select in new conversations
- **Default thinking level** — off, minimal, low, medium, high, xhigh

Models are discovered from configured providers and listed automatically.

## Dictation Settings

See [Dictation](README.md) for full details.

- Provider selection (currently only `local-whisper`)
- Model selection
- Install button to preload the model
- Installation status indicator

## Daemon Controls

- **Daemon status** — running / stopped indicator
- **Keep awake** — toggle to prevent sleep during background work

---

<!-- Source: docs/providers-models.md -->

# Providers & Models

Providers connect the agent to LLM APIs. Models define which specific model to use and its capabilities (context window, reasoning, cost).

## Supported Providers

| Provider       | Auth Types                      | API Type           |
| -------------- | ------------------------------- | ------------------ |
| Anthropic      | API key, OAuth (Claude Pro/Max) | anthropic          |
| OpenAI         | API key                         | openai-completions |
| Google         | API key                         | google-ai          |
| GitHub Copilot | OAuth                           | openai-completions |
| Custom         | API key + base URL              | openai-completions |

## Authentication

Credentials are resolved in this order:

1. **Environment variables** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
2. **Auth file** — stored in `<config-root>/auth.json`, managed through Settings
3. **OAuth login** — subscription providers like Claude Pro/Max and GitHub Copilot use OAuth via `/login` in the agent

### Subscription login

Start the agent and run:

```
/login
```

Then select a provider. Built-in subscription logins include Claude Pro/Max, ChatGPT Plus/Pro (Codex), and GitHub Copilot.

### API key setup

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Or configure through Settings.

## Model Registry

Models are discovered from provider APIs and configured entries. Each model has:

| Property        | Description                                             |
| --------------- | ------------------------------------------------------- |
| `id`            | Model identifier (e.g., `claude-sonnet-4-20250514`)     |
| `provider`      | Provider name (e.g., `anthropic`)                       |
| `contextWindow` | Maximum context tokens                                  |
| `maxTokens`     | Maximum output tokens                                   |
| `reasoning`     | Whether the model supports reasoning/thinking           |
| `cost`          | Cost per token (input, output, cache read, cache write) |

## Selecting a Model

Set defaults in Settings or config.json:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium"
}
```

During a conversation, switch models using the model picker in the desktop UI. Available models are listed from all configured providers.

## Thinking Levels

| Level     | Description               |
| --------- | ------------------------- |
| `off`     | No extended thinking      |
| `minimal` | Minimum reasoning tokens  |
| `low`     | Low reasoning budget      |
| `medium`  | Moderate reasoning budget |
| `high`    | High reasoning budget     |
| `xhigh`   | Maximum reasoning budget  |

Not all models support all thinking levels. The available levels depend on the model's capabilities.

## Provider Config

Configure providers in Settings. Each provider entry specifies:

- Provider type (Anthropic, OpenAI, Google, etc.)
- API key or OAuth credentials
- Base URL (for custom OpenAI-compatible endpoints)
- Display name

---

<!-- Source: docs/dictation.md -->

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

---

<!-- Source: docs/ssh-remotes.md -->

# SSH Remotes

SSH remotes allow the daemon to connect to remote machines over SSH. This enables cross-machine sessions, remote task execution, and access to files on other systems.

## How It Works

The daemon manages SSH target configurations through the Companion API. Each SSH target specifies:

- **Label** — human-readable name for the connection
- **SSH target** — `user@host` string
- **Authentication** — key-based or other method (configured at the SSH level)

```
Desktop ──► Daemon ──► SSH ──► Remote machine
                              │
                         Run commands
                         Access files
```

## Managing SSH Targets

SSH targets are managed through the companion API:

| Method | Endpoint                        | Description                 |
| ------ | ------------------------------- | --------------------------- |
| GET    | `/companion/v1/ssh-targets`     | List all configured targets |
| POST   | `/companion/v1/ssh-targets`     | Add a new target            |
| PATCH  | `/companion/v1/ssh-targets/:id` | Update an existing target   |
| DELETE | `/companion/v1/ssh-targets/:id` | Remove a target             |

### Adding a target

```json
// POST /companion/v1/ssh-targets
{
  "label": "Build Server",
  "sshTarget": "user@build-server.example.com"
}

// Response
{
  "id": "ssh-abc123",
  "label": "Build Server",
  "sshTarget": "user@build-server.example.com",
  "createdAt": "2026-05-01T12:00:00Z"
}
```

## Configuration

SSH targets are stored in the daemon's runtime state. There is no manual config file format — manage them through the API.

SSH key management follows standard SSH conventions:

- Keys in `~/.ssh/id_rsa`, `~/.ssh/id_ed25519`, etc.
- `~/.ssh/config` for host aliases and options
- `~/.ssh/known_hosts` for host key verification

## Use Cases

- **Remote builds** — run build commands on a remote build server
- **File access** — read and edit files on a remote machine
- **Cross-machine workflows** — start a task on one machine, check results from another
- **Multi-environment testing** — run tasks in staging, production, or test environments

## Prerequisites

- SSH access configured between the local and remote machines
- Key-based authentication is recommended (password auth may not work in automated contexts)
- The remote machine must have a compatible SSH server running
- The SSH user must have the necessary permissions for the intended operations

## Security

- SSH credentials are not stored by the daemon — it relies on the system's SSH configuration
- Connections are encrypted via the SSH protocol
- Access to the daemon controls SSH target management, so daemon API security governs who can add/remove targets
