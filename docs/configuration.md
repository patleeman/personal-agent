# Configuration

Use this doc for the machine-local config model and path precedence.

## Main config file

Primary machine config:

```text
<config-root>/config.json
```

Common top-level keys:

- `knowledgeBaseRepoUrl`
- `knowledgeBaseBranch`
- `instructionFiles`
- `skillDirs`
- `daemon`
- `ui`

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

If `knowledgeBaseRepoUrl` is set, the effective `<vault-root>` is the managed mirror at `<state-root>/knowledge-base/repo` unless `PERSONAL_AGENT_VAULT_ROOT` overrides it. Older configs may still contain `vaultRoot`; treat that as legacy fallback, not a user-facing setting.

## Other important config locations

- `<config-root>/local/` — machine-local overlay
- `<config-root>/profiles/<profile>/settings.json` — profile-scoped runtime settings
- `<config-root>/profiles/<profile>/models.json` — profile-scoped model/provider config
- `<state-root>/desktop/config.json` — desktop-specific state

## Path precedence

### Vault root

Resolution order:

1. `PERSONAL_AGENT_VAULT_ROOT`
2. managed KB mirror when `knowledgeBaseRepoUrl` is configured
3. legacy `vaultRoot` from `config.json`
4. default `~/Documents/personal-agent`

### Config root

Resolution order:

1. `PERSONAL_AGENT_CONFIG_FILE` for the exact file
2. `PERSONAL_AGENT_CONFIG_ROOT`
3. default `<state-root>/config`

### State root

Resolution order:

1. `PERSONAL_AGENT_STATE_ROOT`
2. default `~/.local/state/personal-agent`

### Profiles root

Resolution order:

1. `PERSONAL_AGENT_PROFILES_ROOT`
2. default `<config-root>/profiles`

Profiles are machine-local. Durable reusable knowledge still belongs in `<vault-root>`.

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

## What belongs where

| Setting type | Best home |
| --- | --- |
| shipped defaults | repo files |
| standing behavior | selected instruction files |
| durable knowledge | docs, skills, and projects in `<vault-root>` |
| machine-local runtime settings | `<config-root>/config.json` |
| profile model/provider/settings | `<config-root>/profiles/<profile>/` |
| default model/provider/ui overrides | `<config-root>/local/` |
| machine-local one-off overrides | environment variables |

## Daemon and companion config

Daemon config is read from the `daemon` section in `<config-root>/config.json`, unless `PERSONAL_AGENT_DAEMON_CONFIG` points at another file.

Defaults worth knowing:

- daemon socket: `<state-root>/daemon/personal-agentd.sock`, unless `PERSONAL_AGENT_DAEMON_SOCKET_PATH` overrides it
- companion host: `127.0.0.1`
- companion port: `3843`
- scheduled task directory: `<state-root>/sync/tasks`

The companion HTTP/WebSocket API lives under `/companion/v1` on the configured companion host/port. The desktop app proxies companion paths through `personal-agent://app/companion/...` when it can.

## Feature settings

Some UI settings are stored in the active profile settings file under `<config-root>/profiles/<profile>/settings.json`, including transcription provider settings and conversation-title generation settings. The web routes expose these through `/api/transcription/settings` and `/api/conversation-titles/settings`; prefer the Settings UI unless you are debugging.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Knowledge System](./knowledge-system.md)
- [Desktop App](./desktop-app.md)
