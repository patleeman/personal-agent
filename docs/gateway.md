# Gateway Guide (`pa gateway`)

## Overview

`@personal-agent/gateway` lets `personal-agent` run Pi through chat platforms.

Current providers:

- Telegram
- Discord

The gateway command is registered into `pa` at startup, so you use it as:

```bash
pa gateway ...
```

## Command behavior

```bash
pa gateway
pa gateway help
pa gateway setup [telegram|discord]
pa gateway start [telegram|discord]
pa gateway service [install|status|uninstall|help] [telegram|discord]
pa gateway telegram [setup|start|help]
pa gateway discord [setup|start|help]
```

Behavior defaults:

- `pa gateway` -> show gateway help
- `pa gateway setup` -> interactive setup (asks provider)
- `pa gateway start` -> start Telegram in foreground
- `pa gateway service install` -> install Telegram as background service
- `pa gateway telegram` -> show Telegram-specific help
- `pa gateway discord` -> show Discord-specific help

## Setup walkthrough

Use interactive setup instead of manually exporting env vars:

```bash
pa gateway setup telegram
pa gateway setup discord
```

This writes local config to:

- `~/.config/personal-agent/gateway.json`

You can override config file location with:

- `PERSONAL_AGENT_GATEWAY_CONFIG_FILE`

## Shared environment variables

Used by both providers:

- `PERSONAL_AGENT_PROFILE` (default: `shared`)
- `PERSONAL_AGENT_PI_TIMEOUT_MS` (default: `180000`)

## Telegram

Required configuration (via setup or env):

- `TELEGRAM_BOT_TOKEN`
- `PERSONAL_AGENT_TELEGRAM_ALLOWLIST` (comma-separated chat IDs)

Optional:

- `PERSONAL_AGENT_TELEGRAM_CWD` (working directory for Pi calls)
- `PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT` (default: `20`)

Run:

```bash
pa gateway telegram setup
pa gateway telegram start
```

`start` runs in the foreground. Keep that terminal open and press `Ctrl+C` to stop.
It also auto-starts `personal-agentd` if needed (unless daemon events are explicitly disabled).

## Discord

Required configuration (via setup or env):

- `DISCORD_BOT_TOKEN`
- `PERSONAL_AGENT_DISCORD_ALLOWLIST` (comma-separated channel IDs)

Optional:

- `PERSONAL_AGENT_DISCORD_CWD` (working directory for Pi calls)
- `PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL` (default: `20`)

Run:

```bash
pa gateway discord setup
pa gateway discord start
```

`start` runs in the foreground. Keep that terminal open and press `Ctrl+C` to stop.
It also auto-starts `personal-agentd` if needed (unless daemon events are explicitly disabled).

## Background service mode (recommended for 24/7)

Use service mode if you want gateway to stay up after terminal close and auto-restart on failure.

Supported platforms:

- macOS (`launchd` user agent)
- Linux (`systemd --user` unit)

Commands:

```bash
# Install + start in background (default provider: telegram)
pa gateway service install [telegram|discord]

# Check state
pa gateway service status [telegram|discord]

# Stop + remove service
pa gateway service uninstall [telegram|discord]
```

Notes:

- Run provider setup first (`pa gateway <provider> setup`).
- `service install` validates provider token + allowlist in gateway config.
- `service install` also installs/starts `personal-agentd` as a managed user service.
- macOS logs are written to `~/.local/state/personal-agent/gateway/logs/<provider>.log`.
- Linux logs are available via `journalctl --user -u personal-agent-gateway-<provider>.service -f`.

## Message/session behavior

Each chat/channel gets its own Pi session file.

Gateway commands inside chat:

- `/status` -> profile, agentDir, session file info, active model
- `/new` -> delete chat/channel session file and start a fresh conversation
- `/commands` -> list available slash commands
- `/skills` -> list available skills for the current profile

Common Pi slash commands exposed in gateway command lists:

- `/skill <name>` (translated to `/skill:<name>` for Telegram menu compatibility)
- `/model` or `/models` -> opens a model picker in chat (Telegram includes inline buttons); reply with a number or `/model <provider/model>`
- `/stop` -> stop active request
- `/followup <text>` -> queue a follow-up while current response is running
- `/cancel` -> cancel active model selection
- `/compact` -> currently returns guidance (manual compaction requires Pi TUI)
- `/resume` -> gateway sessions already auto-resume per chat/channel; use `/new` for a fresh one

Telegram also registers slash commands via Bot API on startup (`setMyCommands`).

All non-gateway commands are executed through the Pi SDK with that chat's session file.

When a new message arrives while the agent is already streaming in that conversation, gateway sends it as a **steer** (interrupt-style) instruction instead of starting an independent second run. This avoids double-reply behavior for rapid follow-ups.

## Daemon integration

Gateway emits non-fatal events to `personal-agentd`:

- `session.updated`
- `session.closed`
- `session.processing.failed`

If daemon is unavailable, gateway still continues handling chat requests.

## Access control

Access is allowlist-only.

If a chat/channel ID is not in the provider allowlist env var, requests are rejected.

## Troubleshooting

### `TELEGRAM_BOT_TOKEN is required` / `DISCORD_BOT_TOKEN is required`
Run setup (`pa gateway setup <provider>`) or set provider token env var.

### `...ALLOWLIST is required`
Run setup (`pa gateway setup <provider>`) or set allowlist env var with comma-separated chat/channel IDs.

### `Gateway <provider> token missing` / `allowlist missing` during `service install`
Run `pa gateway <provider> setup` first so token/allowlist are saved in gateway config.

### Messages are queued slowly
Increase:

- `PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT`
- `PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL`

only if you actually need higher throughput.
