# Configuration

This page explains the current configuration model for `personal-agent`.

The main principle is:

- keep shared defaults in repo files
- keep durable knowledge in the external vault
- keep machine-local behavior in machine config and local overlays
- use environment variables mostly for machine bootstrap and secret resolution

## Machine config

The main machine-local config file is:

```text
~/.local/state/personal-agent/config/config.json
```

Common top-level keys:

- `defaultProfile`
- `vaultRoot`
- `instructionFiles`
- `skillDirs`
- `daemon`
- `webUi`

Example:

```json
{
  "defaultProfile": "shared",
  "vaultRoot": "~/Documents/personal-agent",
  "instructionFiles": [
    "~/Documents/shared-agent-prompts/AGENTS.md"
  ],
  "skillDirs": [
    "~/Documents/personal-agent/skills",
    "~/Documents/shared-agent-skills"
  ],
  "daemon": {
    "logLevel": "info",
    "modules": {
      "tasks": {
        "enabled": true,
        "taskDir": "~/.local/state/personal-agent/sync/_tasks",
        "tickIntervalSeconds": 30,
        "maxRetries": 3,
        "reapAfterDays": 7,
        "defaultTimeoutSeconds": 1800
      }
    }
  },
  "webUi": {
    "port": 3741,
    "useTailscaleServe": false,
    "resumeFallbackPrompt": "Continue from where you left off."
  }
}
```

Existing installs may still use `.../sync/tasks` instead of `.../sync/_tasks`; the runtime honors either.

## Durable vault root

The default durable vault root is:

```text
~/Documents/personal-agent
```

That vault holds:

```text
~/Documents/personal-agent/
├── AGENTS.md
├── skills/
├── notes/
└── projects/
```

You can override it with either:

- `vaultRoot` in machine config
- `PERSONAL_AGENT_VAULT_ROOT`

The environment variable wins.

## Durable instruction files

The canonical shared instruction file now lives at:

- `AGENTS.md`

The Settings page can also append extra machine-local AGENTS files through `config.json` → `instructionFiles`.

Legacy `_profiles/` content may still be read when it exists, but new setups should use the root `AGENTS.md` plus local instruction-file selection instead.

## Extra skill folders

The canonical shared skills live under the vault `skills/` directory.

If you want to load additional machine-local skill folders, add them in Settings or write them directly to `config.json` → `skillDirs`.

## Local overlay

The machine-local overlay defaults to:

```text
~/.local/state/personal-agent/config/local
```

Use it for local-only overrides that should not be shared through the vault.

## Runtime state roots

Machine-local runtime state defaults to:

```text
~/.local/state/personal-agent/
├── config/
├── daemon/
├── desktop/
├── web/
└── sync/
```

Important subtrees:

- `daemon/` — socket, logs, `runtime.db`, durable runs
- `desktop/` — desktop config and logs
- `web/` — remote browser pairing state and web runtime state
- `sync/{_tasks|tasks}/` — scheduled task files

## Desktop config

The Electron desktop shell stores its own machine-local state in:

```text
~/.local/state/personal-agent/desktop/config.json
```

That file holds:

- saved host records
- default host selection
- main window bounds
- desktop open-on-launch preference

## Environment variables

The most useful overrides are:

- `PERSONAL_AGENT_STATE_ROOT` — override the machine-local state root
- `PERSONAL_AGENT_CONFIG_ROOT` — override the config directory
- `PERSONAL_AGENT_CONFIG_FILE` — override the machine config file path
- `PERSONAL_AGENT_VAULT_ROOT` — override the durable vault root
- `PERSONAL_AGENT_PROFILES_ROOT` — override the legacy profiles root directly
- `PERSONAL_AGENT_LOCAL_PROFILE_DIR` — override the local overlay directory
- `PERSONAL_AGENT_DAEMON_SOCKET_PATH` — override daemon socket path
- `PERSONAL_AGENT_WEB_TAILSCALE_SERVE` — force Tailscale Serve on/off for the web UI
- `PERSONAL_AGENT_PI_TIMEOUT_MS` — Pi execution timeout
- `PI_OPENAI_NATIVE_COMPACTION=0` — disable the built-in OpenAI/Codex native compaction replay extension
- `PI_OPENAI_NATIVE_COMPACTION_NOTIFY=1` — show UI notices when native compaction replay activates or falls back
- `PERSONAL_AGENT_OP_BIN` and `OP_SERVICE_ACCOUNT_TOKEN` — 1Password CLI secret resolution

The OpenAI native compaction extension only applies to direct OpenAI Responses and ChatGPT/Codex responses models; other providers keep Pi's default compaction behavior.

Older single-section overrides like `PERSONAL_AGENT_DAEMON_CONFIG` and `PERSONAL_AGENT_WEB_CONFIG_FILE` are still honored for compatibility.

## What belongs where

| Setting type | Best home |
| --- | --- |
| shared product defaults | repo files |
| durable behavior | vault `AGENTS.md` + machine `instructionFiles` |
| runtime defaults | local `settings.json` |
| model provider defs | local `models.json` |
| portable knowledge | vault `notes/`, `skills/`, `projects/` |
| machine-local extra skills | machine `skillDirs` |
| machine-local deployment settings | machine `config.json` |
| machine-local one-off tweaks | local overlay |

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Web UI Guide](./web-ui.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
