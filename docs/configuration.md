# Configuration

This page explains the user-facing configuration model for `personal-agent`.

The guiding principle is:

- keep durable defaults in files
- use environment variables mainly for runtime overrides and secrets

## The main config files

### `~/.config/personal-agent/config.json`

This stores the default profile.

Example:

```json
{
  "defaultProfile": "assistant"
}
```

Useful command:

```bash
pa profile use assistant
```

### `~/.config/personal-agent/daemon.json`

This configures the background daemon.

Common reasons to edit it:

- change task discovery path
- change timeouts or retry behavior
- change socket or queue settings

Example:

```json
{
  "logLevel": "info",
  "modules": {
    "tasks": {
      "enabled": true,
      "taskDir": "/path/to/personal-agent/profiles/assistant/agent/tasks",
      "tickIntervalSeconds": 30,
      "maxRetries": 3,
      "defaultTimeoutSeconds": 1800,
      "runTasksInTmux": false
    }
  }
}
```

See [Daemon and Background Automation](./daemon.md) and [Scheduled Tasks](./scheduled-tasks.md).

### `~/.config/personal-agent/gateway.json`

This stores gateway setup, typically written by:

```bash
pa gateway setup telegram
```

Use it for:

- Telegram token
- allowlisted chats
- allowed user ids
- gateway cwd and queue limits

See [Gateway Guide](./gateway.md).

## Profile resource configuration

Profile defaults live in the repo under `profiles/**/agent`.

Common files:

- `settings.json`
- `models.json`
- `AGENTS.md`
- `skills/`
- `memory/`
- `tasks/`
- `projects/`
- `themes/`
- `extensions/`

See [Profiles, Memory, and Skills](./profiles-memory-skills.md).

## Layering and precedence

Profile resources resolve in this order:

1. `profiles/shared/agent`
2. `profiles/<selected-profile>/agent`
3. local overlay (`~/.config/personal-agent/local` by default)

Higher layers override lower layers where that makes sense.

A simple way to think about it:

- `shared` = common defaults
- profile = persona or context-specific overrides
- local overlay = machine-local additions

## Runtime state location

Mutable runtime state is kept outside the repo.

Default root:

- `~/.local/state/personal-agent`

This includes:

- auth
- live/saved session state
- daemon state and logs
- gateway spools and logs
- conversation-local bindings

Do not point runtime state inside the git repo.

## Important environment variables

### Profile and repo selection

- `PERSONAL_AGENT_REPO_ROOT` — override the repo root
- `PERSONAL_AGENT_LOCAL_PROFILE_DIR` — override the local overlay dir
- `PERSONAL_AGENT_PROFILE` — override the active profile for some runtime surfaces, especially gateway and daemon contexts

### Runtime state

- `PERSONAL_AGENT_STATE_ROOT` — override the runtime state root
- `PERSONAL_AGENT_AUTH_PATH`
- `PERSONAL_AGENT_SESSION_PATH`
- `PERSONAL_AGENT_CACHE_PATH`

### Daemon

- `PERSONAL_AGENT_DAEMON_CONFIG` — alternate daemon config file
- `PERSONAL_AGENT_DAEMON_SOCKET_PATH` — default daemon socket path
- `PERSONAL_AGENT_DISABLE_DAEMON_EVENTS=1` — disable daemon integration explicitly

### Gateway

- `PERSONAL_AGENT_GATEWAY_CONFIG_FILE` — alternate gateway config file
- `TELEGRAM_BOT_TOKEN`
- `PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS`
- `PERSONAL_AGENT_TELEGRAM_ALLOWLIST`

### 1Password secrets

If you store secrets as `op://...` references:

- `PERSONAL_AGENT_OP_BIN` (default `op`)
- `PERSONAL_AGENT_OP_READ_TIMEOUT_MS`
- `OP_SERVICE_ACCOUNT_TOKEN` if using a 1Password service account

## Model and theme defaults

The agent's default model, thinking level, and theme mapping usually belong in profile `settings.json`.

Example:

```json
{
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.4",
  "defaultThinkingLevel": "xhigh",
  "themeDark": "cobalt2",
  "themeLight": "cobalt2-light",
  "themeMode": "system"
}
```

These defaults are used when a run does not explicitly override them.

You can also adjust model and theme settings from the web UI Settings page.

## Recommended approach

For most setups:

1. set the default profile with `pa profile use <name>`
2. keep profile behavior and durable knowledge in `profiles/**/agent`
3. keep daemon behavior in `daemon.json`
4. use `pa gateway setup telegram` for gateway config
5. keep secrets in 1Password or env vars, not directly in repo files

## Related docs

- [Getting Started](./getting-started.md)
- [Profiles, Memory, and Skills](./profiles-memory-skills.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Gateway Guide](./gateway.md)
- [Troubleshooting](./troubleshooting.md)
