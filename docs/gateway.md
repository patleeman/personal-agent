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
pa gateway telegram [setup|start|help]
pa gateway discord [setup|start|help]
```

Behavior defaults:

- `pa gateway` -> show gateway help
- `pa gateway setup` -> interactive setup (asks provider)
- `pa gateway start` -> start Telegram
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
- `PERSONAL_AGENT_PI_MAX_OUTPUT_BYTES` (default: `200000`)

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

## Message/session behavior

Each chat/channel gets its own Pi session file.

Gateway commands inside chat:

- `/status` -> profile, agentDir, session file info
- `/new` -> delete chat/channel session file and start a fresh conversation
- `/commands` -> list available slash commands

Telegram also registers slash commands via Bot API on startup (`setMyCommands`).

All non-gateway commands are passed through to Pi in print mode with that chat's session.
For Telegram menu compatibility, `/skill <name>` is translated to `/skill:<name>` before sending to Pi.

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

### Messages are queued slowly
Increase:

- `PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT`
- `PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL`

only if you actually need higher throughput.
