# Configuration and Settings

Personal Agent has several configuration stores. Do not treat `config.json` as the whole settings system: machine config, runtime agent settings, extension settings, provider definitions, credentials, desktop preferences, and browser-local UI state each have different owners.

## Path roots

| Root                | Default                                                             | Override                           | Purpose                                                                         |
| ------------------- | ------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| `<state-root>`      | `~/.local/state/personal-agent` or `$XDG_STATE_HOME/personal-agent` | `PERSONAL_AGENT_STATE_ROOT`        | Runtime state, daemon DBs, extension installs, active agent files               |
| `<config-root>`     | `<state-root>/config`                                               | `PERSONAL_AGENT_CONFIG_ROOT`       | Machine-local durable config and profiles                                       |
| Machine config file | `<config-root>/config.json`                                         | `PERSONAL_AGENT_CONFIG_FILE`       | Knowledge root/sync, extra instruction files, skill folders, daemon/ui sections |
| Local profile dir   | `<config-root>/local`                                               | `PERSONAL_AGENT_LOCAL_PROFILE_DIR` | Local profile settings mirrored into active runtime settings                    |

## Machine config

`<config-root>/config.json` is machine-local configuration. It is not a layered settings file and there is no active `<config-root>/local/config.json` overlay.

Current machine config keys:

| Key                    | Type     | Used for                                                            |
| ---------------------- | -------- | ------------------------------------------------------------------- |
| `vaultRoot`            | string   | Legacy explicit knowledge vault root                                |
| `knowledgeBaseRepoUrl` | string   | Managed git-backed knowledge base repo                              |
| `knowledgeBaseBranch`  | string   | Managed knowledge base branch, default `main`                       |
| `instructionFiles`     | string[] | Extra AGENTS.md-style files appended to runtime instructions        |
| `skillDirs`            | string[] | Extra skill directories loaded alongside the vault skills directory |
| `daemon`               | object   | Daemon machine config section                                       |
| `ui`                   | object   | UI machine config section, including fallback resume prompt         |

Example:

```json
{
  "knowledgeBaseRepoUrl": "git@github.com:user/personal-agent-kb.git",
  "knowledgeBaseBranch": "main",
  "instructionFiles": ["/Users/me/agent/extra-AGENTS.md"],
  "skillDirs": ["/Users/me/agent/skills"]
}
```

## Runtime agent settings

The active agent/runtime settings file is:

```text
<state-root>/pi-agent-runtime/settings.json
```

This file is materialized from resolved runtime resources and is also where app-level runtime preferences are written. The desktop Settings page writes through APIs that preserve existing settings and mirror writes to the local profile where needed.

Common runtime settings include:

| Key                                           | Purpose                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `defaultProvider`, `defaultModel`             | Default model for new conversations and runs                       |
| `defaultVisionProvider`, `defaultVisionModel` | Vision model used by `probe_image` for text-only models            |
| `defaultThinkingLevel`                        | Default reasoning level                                            |
| `defaultServiceTier`                          | Optional model service tier, e.g. fast/priority mode               |
| `defaultCwd`                                  | Default working directory for new chats and web actions            |
| `ui.*`                                        | Conversation list/layout preferences and conversation plan presets |
| `lastChangelogVersion`                        | Runtime UI bookkeeping                                             |

Do not put arbitrary product feature state here. Product features should own state through their extension storage, daemon/runtime DB tables, or a deliberate extension API.

## Extension settings

Extensions have two settings mechanisms:

1. **Scalar settings** declared in `extension.json` under `contributes.settings`. These are exposed through `/api/settings`, merged with manifest defaults, and persisted as overrides in:

   ```text
   <state-root>/settings.json
   ```

2. **Component-backed settings UI** declared by an extension as `contributes.settingsComponent`. The component renders inside the Settings page and should read/write through extension backend actions or stable SDK APIs.

The Settings page has an **Extension Settings** section for scalar manifest settings. Rich first-party panels, such as Dictation or Knowledge, should live in their owning system extension and use stable extension APIs rather than app-shell special cases.

## Models, providers, and credentials

Model/provider configuration is split on purpose:

| Store                         | Default path                                                  | Purpose                                                                        |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Provider/model definitions    | `<config-root>/profiles/shared/models.json`                   | Custom providers, model overrides, context windows, costs, compatibility flags |
| Active runtime model registry | `<state-root>/pi-agent-runtime/models.json`                   | Materialized model definitions read by the runtime                             |
| Legacy provider credentials   | `<state-root>/pi-agent-runtime/auth.json`                     | Existing API keys and OAuth tokens managed through Settings                    |
| Extension secrets             | macOS Keychain, `<state-root>/secrets.json`, or env-only      | Extension-declared secrets such as integration API keys                        |
| Environment credentials       | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, etc. | Runtime-only credential source; not persisted                                  |

Provider credentials should be managed through Settings. Manual edits to `auth.json` are possible but discouraged. New extension secrets should use `contributes.secrets`; the active backend is configured by `secrets.provider` (`keychain`, `file`, or `env-only`). Environment variables declared by the extension take precedence over stored values.

## Knowledge vault resolution

The effective knowledge vault root resolves in this order:

1. `PERSONAL_AGENT_VAULT_ROOT`
2. Managed knowledge-base mirror at `<state-root>/knowledge-base/repo` when `knowledgeBaseRepoUrl` is configured
3. Legacy `vaultRoot` from machine config
4. `~/Documents/personal-agent`

Knowledge UI and sync behavior live in the Knowledge system extension. Machine config only stores the machine-level root/sync inputs.

## Desktop, daemon, and local UI state

Not every Settings-page control writes to the same JSON file:

| Area                                                    | Source of truth                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| Appearance theme picker                                 | Browser/Electron `localStorage` plus contributed extension themes   |
| Conversation defaults                                   | `<state-root>/pi-agent-runtime/settings.json`                       |
| Workspace default cwd                                   | `<state-root>/pi-agent-runtime/settings.json`                       |
| Skills and extra instruction files                      | `<config-root>/config.json`                                         |
| Provider/model definitions                              | `<config-root>/profiles/shared/models.json`                         |
| Provider credentials                                    | `<state-root>/pi-agent-runtime/auth.json` and environment variables |
| Extension secrets                                       | macOS Keychain, `<state-root>/secrets.json`, or environment only    |
| Desktop update/startup/keyboard preferences             | `<state-root>/desktop/config.json`                                  |
| Extension enablement and extension keybinding overrides | `<state-root>/extensions/registry.json`                             |
| Extension scalar settings                               | `<state-root>/settings.json`                                        |
| SSH remotes                                             | Daemon/companion runtime state                                      |
| Automations, reminders, durable runs                    | Daemon runtime database                                             |

## Rule of thumb

Use machine config for machine-wide roots and discovery inputs. Use runtime settings for active agent defaults. Use extension settings/storage for product features. If an extension needs a new kind of configuration, add a reusable extension API instead of hiding feature-specific config in core.
