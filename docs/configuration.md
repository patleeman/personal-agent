# Configuration

This page explains the user-facing configuration model for `personal-agent`.

The guiding principle is:

- keep durable defaults in files
- use environment variables mainly for runtime overrides and secrets

## The main config files

### `~/.local/state/personal-agent/config/config.json`

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

If git sync is set up, this file is typically a symlink into `~/.local/state/personal-agent/sync/config/config.json` so the default profile can sync across machines.

### `~/.local/state/personal-agent/config/daemon.json`

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
      "defaultTimeoutSeconds": 1800
    }
  }
}
```

See [Daemon and Background Automation](./daemon.md) and [Scheduled Tasks](./scheduled-tasks.md).

### `~/.local/state/personal-agent/config/gateway.json`

This stores gateway setup, typically written by:

```bash
pa gateway setup telegram
```

Use it for:

- Telegram token
- allowlisted chats
- allowed user ids
- gateway cwd and queue limits

You can write this file either with `pa gateway setup telegram` or from the web UI Gateway page. The web UI also supports saving `op://...` 1Password references for supported gateway values.

See [Gateway Guide](./gateway.md).

## Profile resource configuration

Profile resources resolve from two homes:

- shared defaults from repo `profiles/shared/agent`
- mutable profile resources from `~/.local/state/personal-agent/profiles/<profile>/agent`

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

1. repo `profiles/shared/agent`
2. mutable profiles root `~/.local/state/personal-agent/profiles/<selected-profile>/agent`
3. local overlay (`~/.local/state/personal-agent/config/local` by default)

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

For one-time migration from legacy `~/.config/personal-agent` and `~/.pi/agent` locations,
run `./scripts/migrate-state-home.sh` from the repo root.

Canonical state-home layout:

```text
~/.local/state/personal-agent/
├── sync/                      # git-synced durable state
│   ├── profiles/
│   │   └── <profile>/agent/
│   │       ├── projects/
│   │       ├── memory/
│   │       ├── tasks/
│   │       └── activity/
│   ├── pi-agent/
│   │   ├── sessions/
│   │   └── state/
│   └── config/
│       └── config.json
├── profiles -> sync/profiles          # compatibility symlink
├── pi-agent -> sync/pi-agent          # compatibility symlink
├── config/
│   ├── config.json -> ../sync/config/config.json   # after sync setup
│   ├── daemon.json
│   ├── gateway.json
│   └── web.json
├── daemon/
├── gateway/
├── web/
└── logs/
```

Note: legacy top-level `tmux/` and `tmux-logs/` are intentionally not part of the canonical layout.

For git-based automatic cross-machine sync, use:

- `pa sync setup --repo <git-url> --fresh` (first machine / new remote)
- `pa sync setup --repo <git-url> --bootstrap` (additional machines / existing remote history)

You can do the same setup from the Web UI **Sync** tab.

Setup enables the daemon sync module and schedules periodic background sync.

By default, sync tracks:

- `profiles/**`
- `pi-agent/**` (with machine-local auth/settings/bin/index exclusions)
- `config/**` (setup seeds `config/config.json`; `daemon.json`, `gateway.json`, and `web.json` stay machine-local by default)

See [Sync Guide](./sync.md).

## Important environment variables

### Profile and repo selection

- `PERSONAL_AGENT_REPO_ROOT` — override the repo root (shared defaults)
- `PERSONAL_AGENT_PROFILES_ROOT` — override the mutable profiles root
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

### Web UI

- `PERSONAL_AGENT_WEB_CONFIG_FILE` — override `~/.local/state/personal-agent/config/web.json`
- `PERSONAL_AGENT_WEB_TAILSCALE_SERVE` — runtime override (`true`/`false`) for `pa ui` foreground launches

### 1Password secrets

If you store secrets as `op://...` references:

- `PERSONAL_AGENT_OP_BIN` (default `op`)
- `PERSONAL_AGENT_OP_READ_TIMEOUT_MS`
- `OP_SERVICE_ACCOUNT_TOKEN` if using a 1Password service account

## Model, theme, and web UI defaults

The agent's default model, thinking level, theme mapping, and some web UI behavior usually belong in profile `settings.json`.

Example:

```json
{
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.4",
  "defaultThinkingLevel": "xhigh",
  "themeDark": "cobalt2",
  "themeLight": "cobalt2-light",
  "themeMode": "system",
  "webUi": {
    "conversationTitles": {
      "enabled": true,
      "model": "openai-codex/gpt-5.1-codex-mini"
    }
  }
}
```

These defaults are used when a run does not explicitly override them.

`webUi.conversationTitles.model` is optional. If omitted, conversation auto-titles fall back to the saved runtime default model.

### Web UI runtime config

`pa ui` and the managed web UI service use `~/.local/state/personal-agent/config/web.json`:

```json
{
  "port": 3741,
  "useTailscaleServe": false
}
```

This file persists the web UI port and whether `tailscale serve` should be enabled for the web UI. It is managed by the CLI and editable if needed.
When that setting is toggled via `pa ui` or the Web UI page, `personal-agent` also runs the matching `tailscale serve` command for `localhost:<port>`.

You can also adjust model, theme, and conversation title settings from the web UI Settings page.

## Recommended approach

For most setups:

1. set the default profile with `pa profile use <name>`
2. keep profile behavior and durable knowledge in `~/.local/state/personal-agent/profiles/**/agent` (with shared defaults in repo `profiles/shared/agent`)
3. keep daemon behavior in `daemon.json`
4. use `pa gateway setup telegram` for gateway config
5. keep secrets in 1Password or env vars, not directly in repo files

## Related docs

- [Getting Started](./getting-started.md)
- [Profiles, Memory, and Skills](./profiles-memory-skills.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Sync Guide](./sync.md)
- [Gateway Guide](./gateway.md)
- [Troubleshooting](./troubleshooting.md)
