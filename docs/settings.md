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

See [Dictation](dictation.md) for full details.

- Provider selection (currently only `local-whisper`)
- Model selection
- Install button to preload the model
- Installation status indicator

## Daemon Controls

- **Daemon status** — running / stopped indicator
- **Keep awake** — toggle to prevent sleep during background work
