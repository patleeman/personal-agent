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

## Environment variables worth knowing

- `PERSONAL_AGENT_STATE_ROOT`
- `PERSONAL_AGENT_CONFIG_ROOT`
- `PERSONAL_AGENT_CONFIG_FILE`
- `PERSONAL_AGENT_VAULT_ROOT`
- `PERSONAL_AGENT_DAEMON_SOCKET_PATH`
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
| default model/provider/ui overrides | `<config-root>/local/` |
| machine-local one-off overrides | environment variables |

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Knowledge System](./knowledge-system.md)
- [Desktop App](./desktop-app.md)
