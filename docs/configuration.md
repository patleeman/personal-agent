# Configuration

Use this doc for configuration surfaces: file-based config, environment variables, and the Settings UI.

## Main config file

Primary machine-config file:

```text
<config-root>/config.json
```

Common top-level keys:

- `knowledgeBaseRepoUrl` — git URL for managed knowledge base sync
- `knowledgeBaseBranch` — branch for the managed KB mirror (default: `main`)
- `instructionFiles` — array of paths to selected instruction files
- `skillDirs` — array of paths to skill directories
- `daemon` — daemon-specific settings
- `ui` — UI defaults like `resumeFallbackPrompt`

Example:

```json
{
  "knowledgeBaseRepoUrl": "https://github.com/you/knowledge-base.git",
  "knowledgeBaseBranch": "main",
  "instructionFiles": [
    "~/Documents/personal-agent/instructions/base.md"
  ],
  "skillDirs": [
    "~/Documents/personal-agent/skills"
  ],
  "ui": {
    "resumeFallbackPrompt": "Continue from where you left off."
  }
}
```

## Other important config locations

- `<config-root>/local/` — machine-local overlay for model/provider/ui overrides
- `<config-root>/profiles/<profile>/settings.json` — profile-scoped runtime settings (transcription, title generation, etc.)
- `<config-root>/profiles/<profile>/models.json` — profile-scoped model and provider config
- `<state-root>/desktop/config.json` — desktop-specific state

## The Settings UI

The desktop app exposes a Settings page at `/settings` with these sections:

### Appearance

Theme selection: **Light**, **Dark**, or **System** (matches the OS appearance preference).

### Keyboard

Every desktop menu keyboard shortcut is configurable. Each shortcut auto-saves immediately when changed. Defaults can be reset from the section.

Notable defaults:

| Action | Default |
|---|---|
| Show Personal Agent | `⌘/Ctrl+Shift+A` |
| New conversation | `⌘/Ctrl+N` |
| Focus composer | `⌘/Ctrl+L` |
| Conversation mode | F1 |
| Workbench mode | F2 |
| Zen mode | F3 |
| Toggle sidebar | `⌘/Ctrl+/` |
| Toggle right rail | `⌘/Ctrl+\` |
| Settings | `⌘/Ctrl+,` |

Duplicate shortcuts are flagged inline.

### General

- **Resume fallback prompt** — default text injected when resuming a conversation without an explicit prompt (e.g. `"Continue from where you left off."`)
- **Knowledge base repo URL and branch** — configure git-backed KB sync
- **Instruction files** — select which instruction files shape agent behavior
- **Skill directories** — select which directories contain workflow skills
- **Auto-install updates** — toggle automatic download and install of desktop app updates

### Dictation

Transcription provider and model for voice input:

| Provider | Models |
|---|---|
| `local-whisper` | `tiny.en`, `base.en`, `small.en`, `medium.en` |
| Cloud (OpenAI) | `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1` |

Settings also surface the download status of local models and allow installing/uninstalling them.

See [Dictation Transcription](./dictation-transcription.md) for the full provider interface and API.

### Skills

- **Skill wrappers** — toggle whether skills inject their instructions before or after the main system prompt
- **Disable skill auto-loading** — toggle whether skills are discovered and injected automatically

### Providers

The provider section manages model providers, model definitions, and credentials.

**Provider-level fields:**

- Provider ID (e.g. `openai`, `anthropic`, `google`)
- API type — selects the backend protocol:
  - `openai-completions` — OpenAI Completions API
  - `openai-responses` — OpenAI Responses API (default for OpenAI)
  - `anthropic-messages` — Anthropic Messages API
  - `google-generative-ai` — Google Generative AI API
- API key / auth token
- Base URL override (for custom or proxied endpoints)
- Model list — each model has:
  - Model ID (e.g. `gpt-5.4`, `claude-sonnet-4-20250514`)
  - Display name
  - Context window (in tokens)
  - Reasoning capabilities flag
  - Supported input types (text, image, etc.)
  - Supported service tiers

Each provider has an entry in the auth store under its provider ID. Credentials can be stored in `auth.json` via the UI or configured through environment variables.

**Provider auth types:**

| Auth type | How credentials are provided |
|---|---|
| `api_key` | API key stored in auth.json or environment |
| `oauth` | OAuth tokens stored in auth.json |
| `environment` | Credentials resolved from environment variables or external config |

### Daemon

- **Keep Mac awake** — prevents idle system sleep while the daemon is running so automations and background runs continue. Display sleep is still allowed. Only supported on macOS.

### Desktop

- **Start on system start** — launch Personal Agent in the background when signing in to the Mac (packaged builds only)
- **Auto-install updates** — automatically download and install desktop app updates
- **SSH remotes** — manage remote host connections for running the agent against a remote daemon. Each remote has an ID, label, and SSH target string. Connections can be tested inline.

### Interface

- **Reset layout + reload** — clears saved workbench layout preferences and reloads the app
- **Reset conversation UI state** — clears stored conversation-scoped UI state

## Provider and model config schema

Model and provider definitions live in `<config-root>/profiles/<profile>/models.json`.

The schema has two top-level arrays:

### `providers[]`

```json
{
  "id": "openai",
  "api": "openai-responses",
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1",
  "models": [
    {
      "id": "gpt-5.4",
      "name": "GPT 5.4",
      "contextWindow": 128000,
      "reasoning": true,
      "input": ["text", "image"],
      "serviceTiers": ["auto", "default", "high"]
    }
  ]
}
```

### Default UI model

```json
{
  "defaultUiModel": "openai/gpt-5.4"
}
```

Models can also be configured inline in `settings.json` through the default UI model reference.

## Knowledge base sync

See [Knowledge Base Sync](./knowledge-base-sync.md) for the full git-backed sync model.

## Path precedence

### Config root

1. `PERSONAL_AGENT_CONFIG_FILE` for the exact file
2. `PERSONAL_AGENT_CONFIG_ROOT`
3. default `<state-root>/config`

### State root

1. `PERSONAL_AGENT_STATE_ROOT`
2. default `~/.local/state/personal-agent`

### Profiles root

1. `PERSONAL_AGENT_PROFILES_ROOT`
2. default `<config-root>/profiles`

### Vault root

1. `PERSONAL_AGENT_VAULT_ROOT`
2. managed KB mirror when `knowledgeBaseRepoUrl` is configured
3. legacy `vaultRoot` from `config.json`
4. default `~/Documents/personal-agent`

## Environment variables worth knowing

- `PERSONAL_AGENT_STATE_ROOT`
- `PERSONAL_AGENT_CONFIG_ROOT`
- `PERSONAL_AGENT_CONFIG_FILE`
- `PERSONAL_AGENT_VAULT_ROOT`
- `PERSONAL_AGENT_DAEMON_SOCKET_PATH`
- `PERSONAL_AGENT_DAEMON_CONFIG`
- `PERSONAL_AGENT_PROFILES_ROOT`
- `PERSONAL_AGENT_LOCAL_PROFILE_DIR`
- `PERSONAL_AGENT_COMPANION_ENABLED`
- `PERSONAL_AGENT_COMPANION_HOST`
- `PERSONAL_AGENT_COMPANION_PORT`
- `PERSONAL_AGENT_PI_TIMEOUT_MS`
- `PI_OPENAI_NATIVE_COMPACTION`
- `PI_OPENAI_NATIVE_COMPACTION_NOTIFY`

## Daemon and companion config

Daemon config is read from the `daemon` section in `<config-root>/config.json`, unless `PERSONAL_AGENT_DAEMON_CONFIG` points at another file.

Defaults:

- daemon socket: `<state-root>/daemon/personal-agentd.sock`, or `PERSONAL_AGENT_DAEMON_SOCKET_PATH`
- companion host: `127.0.0.1`
- companion port: `3843`
- scheduled task directory: `<state-root>/sync/tasks`

The companion HTTP/WebSocket API lives under `/companion/v1` on the configured companion host/port. The desktop app proxies companion paths through `personal-agent://app/companion/...` when it can.

## What belongs where

| Setting type | Best home |
|---|---|
| shipped defaults | repo files |
| standing behavior | selected instruction files |
| durable knowledge | docs, skills, and projects in `<vault-root>` |
| machine-local runtime settings | `<config-root>/config.json` |
| profile model/provider/settings | `<config-root>/profiles/<profile>/` |
| default model/provider/ui overrides | `<config-root>/local/` |
| machine-local one-off overrides | environment variables |

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Knowledge System](./knowledge-system.md)
- [Knowledge Base Sync](./knowledge-base-sync.md)
- [Models and Providers](./models-and-providers.md)
- [Desktop App](./desktop-app.md)
- [Dictation Transcription](./dictation-transcription.md)
