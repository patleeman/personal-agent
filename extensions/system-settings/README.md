# Settings Extension

This extension owns the Settings page shell in the desktop app. It renders
hand-built panels for app/runtime configuration, scalar settings declared by
extensions, and component-backed settings sections contributed by extensions.

---

# Settings

The Settings page is the main desktop UI for configuration, but settings are not stored in one place. Open it from the app menu, `Cmd+,`, or navigate to `/settings`. See [`docs/configuration.md`](../../docs/configuration.md) for the full map of machine config, runtime settings, extension settings, credentials, desktop preferences, and daemon state.

## Architecture

The Settings page coordinates multiple stores:

- Machine config in `<config-root>/config.json` for knowledge roots, extra instruction files, and skill folders.
- Runtime agent settings in `<state-root>/pi-agent-runtime/settings.json` for model defaults, vision model, thinking level, service tier, default cwd, and UI/runtime preferences.
- Extension scalar setting overrides in `<state-root>/settings.json`, backed by `contributes.settings` and `/api/settings`.
- Extension component panels declared with `contributes.settingsComponent` for richer first-party configuration UI.
- Provider definitions in `<config-root>/profiles/shared/models.json` and credentials in `<state-root>/pi-agent-runtime/auth.json`.

```
Extension manifests ──► Schema registry ──► Settings page extension settings
                          │
                 <state-root>/settings.json
                          │
                   Backend actions / agent
```

### Adding settings to an extension

In your `extension.json`:

```json
{
  "contributes": {
    "settings": {
      "myExt.timeout": {
        "type": "number",
        "default": 30,
        "description": "Timeout in seconds",
        "group": "My Extension",
        "order": 1
      }
    }
  }
}
```

The setting appears in the Settings page's Extension Settings section.
No React code needed.

### API

| Method | Endpoint               | Description                                      |
| ------ | ---------------------- | ------------------------------------------------ |
| GET    | `/api/settings`        | All current values (defaults + overrides merged) |
| GET    | `/api/settings/schema` | Unified schema from all extensions               |
| PATCH  | `/api/settings`        | Update one or more settings                      |

Client-side:

```ts
const values = await api.settings(); // Record<string, unknown>
const schema = await api.settingsSchema(); // ExtensionSettingsRegistration[]
await api.updateSettings({ 'myExt.timeout': 60 }); // updates + returns merged
```

## Sections

| Section      | Source                                    |
| ------------ | ----------------------------------------- |
| Appearance   | Built-in (theme picker)                   |
| Conversation | Built-in (model, thinking)                |
| Workspace    | Built-in (default working dir)            |
| Skills       | Built-in (folders, AGENTS.md)             |
| Tools        | Extension-contributed settings components |
| Providers    | Built-in (model providers, credentials)   |
| Desktop      | Built-in (updates, SSH remotes)           |
| Keyboard     | Built-in (shortcut editor)                |

Knowledge setup lives in the Knowledge extension. Manifest-declared
extension settings render in the Settings page's Extension Settings section.

## Usage

### Accessing settings from a backend action

```typescript
import { createSettingsStore } from '@personal-agent/desktop/server/settings/settingsStore.js';

const store = createSettingsStore();
const allSettings = store.read();
const timeout = allSettings['myExt.timeout'] ?? 30;
```

### Accessing settings from the frontend

```typescript
const values = await api.settings();
```

### Reading/writing settings from the agent

Settings are not tool-accessible by default (no tool registered for them).
To let the agent read/update settings, register a tool in your extension
that wraps the settings store.

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

- Provider selection (currently only `local-whisper`)
- Model selection
- Install button to preload the model
- Installation status indicator

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

Dictation now lives in the bundled `system-local-dictation` extension.

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
