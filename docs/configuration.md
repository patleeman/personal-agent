# Configuration

This guide documents where `pa` reads configuration from, and what wins when multiple sources are set.

## Quick precedence summary

`pa` uses different precedence stacks per subsystem.

### Profile resources (skills/extensions/themes/prompts/settings/models)

1. `profiles/shared/agent`
2. `profiles/<selected-profile>/agent`
3. local overlay (`~/.config/personal-agent/local` by default)

Higher layers override lower layers (for mergeable files) or append (for layered directories).

See [Profile Schema](./profile-schema.md) for merge semantics.

### Profile selection

1. `--profile <name>` passed to `pa tui ...` / `pa <pi args>`
2. `defaultProfile` in `~/.config/personal-agent/config.json`
3. fallback: `shared`

### Gateway runtime config (per provider)

1. Environment variables (for token, allowlist, cwd, queue size, profile)
2. `~/.config/personal-agent/gateway.json`
3. hardcoded defaults (for example profile=`shared`)

### Daemon config

1. defaults in code
2. `~/.config/personal-agent/daemon.json` (or `PERSONAL_AGENT_DAEMON_CONFIG`)

`PERSONAL_AGENT_DAEMON_SOCKET_PATH` seeds the default socket path, but `daemon.json` can still override it.

---

## Config files

### `~/.config/personal-agent/config.json`

Used by `pa profile use/show/list` and default profile resolution.

Example:

```json
{
  "defaultProfile": "datadog"
}
```

Override file location with:

- `PERSONAL_AGENT_CONFIG_FILE`

### `~/.config/personal-agent/daemon.json`

Configures daemon queue, socket, and modules.

Example:

```json
{
  "logLevel": "info",
  "queue": { "maxDepth": 1000 },
  "modules": {
    "maintenance": { "enabled": true, "cleanupIntervalMinutes": 60 },
    "tasks": {
      "enabled": true,
      "taskDir": "~/.config/personal-agent/tasks",
      "tickIntervalSeconds": 30,
      "maxRetries": 3,
      "reapAfterDays": 7,
      "defaultTimeoutSeconds": 1800
    }
  }
}
```

Override file location with:

- `PERSONAL_AGENT_DAEMON_CONFIG`

### `~/.config/personal-agent/gateway.json`

Stores setup-generated Telegram/Discord gateway values.

Created/updated by:

- `pa gateway setup telegram`
- `pa gateway setup discord`

Override file location with:

- `PERSONAL_AGENT_GATEWAY_CONFIG_FILE`

---

## Runtime state paths

Default runtime root:

- `~/.local/state/personal-agent`

Resolution:

1. `PERSONAL_AGENT_STATE_ROOT`
2. else `XDG_STATE_HOME/personal-agent`
3. else `~/.local/state/personal-agent`

Subpaths (overrideable):

- auth: `PERSONAL_AGENT_AUTH_PATH`
- session: `PERSONAL_AGENT_SESSION_PATH`
- cache: `PERSONAL_AGENT_CACHE_PATH`

`pa` validates runtime paths are **outside the repository**.

---

## Profile layer path controls

- `PERSONAL_AGENT_REPO_ROOT` — override repository root for profile discovery
- `PERSONAL_AGENT_LOCAL_PROFILE_DIR` — override local overlay root (default `~/.config/personal-agent/local`)

---

## Gateway environment variables

Shared:

- `PERSONAL_AGENT_PROFILE` (default `shared`)
- `PERSONAL_AGENT_PI_TIMEOUT_MS` (default `1800000`; set `0` to disable timeout)

Telegram:

- `TELEGRAM_BOT_TOKEN`
- `PERSONAL_AGENT_TELEGRAM_ALLOWLIST`
- `PERSONAL_AGENT_TELEGRAM_CWD`
- `PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT` (default `20`)
- `PERSONAL_AGENT_TELEGRAM_RETRY_ATTEMPTS` (default `3`)
- `PERSONAL_AGENT_TELEGRAM_RETRY_BASE_DELAY_MS` (default `300`)
- `PERSONAL_AGENT_TELEGRAM_TOOL_ACTIVITY_STREAM` (default `false`)

Discord:

- `DISCORD_BOT_TOKEN`
- `PERSONAL_AGENT_DISCORD_ALLOWLIST`
- `PERSONAL_AGENT_DISCORD_CWD`
- `PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL` (default `20`)

---

## 1Password integration variables

When config values are `op://...` references:

- `PERSONAL_AGENT_OP_BIN` (default `op`)
- `PERSONAL_AGENT_OP_READ_TIMEOUT_MS` (default `15000`)
- `OP_SERVICE_ACCOUNT_TOKEN` (for service-account auth)

---

## CLI/daemon behavior toggles

- `PERSONAL_AGENT_PLAIN_OUTPUT=1` or `NO_COLOR=1` — disable rich ANSI UI
- `PERSONAL_AGENT_NO_DAEMON_PROMPT=1` — skip interactive “start daemon?” prompt in CLI
- `PERSONAL_AGENT_DISABLE_DAEMON_EVENTS=1` — disable daemon event emission and gateway daemon auto-start

---

## Related docs

- [CLI Guide](./cli.md)
- [Profile Schema](./profile-schema.md)
- [Gateway Guide](./gateway.md)
- [Scheduled Tasks](./tasks.md)
- [Troubleshooting](./troubleshooting.md)
