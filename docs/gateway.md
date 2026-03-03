# Gateway Guide (`pa gateway`)

## Overview

`@personal-agent/gateway` runs Pi through chat platforms.

Current providers:

- Telegram
- Discord

The command is registered into `pa` at startup:

```bash
pa gateway ...
```

---

## Command surface

```bash
pa gateway
pa gateway help
pa gateway setup [telegram|discord]
pa gateway start [telegram|discord]
pa gateway service [install|status|uninstall|help] [telegram|discord]
pa gateway telegram [setup|start|help]
pa gateway discord [setup|start|help]
```

Defaults:

- `pa gateway` → help
- `pa gateway setup` → interactive provider prompt
- `pa gateway start` → starts Telegram in foreground
- `pa gateway service install` → installs Telegram managed service

---

## Configuration model

Gateway config file:

- `~/.config/personal-agent/gateway.json`
- override path: `PERSONAL_AGENT_GATEWAY_CONFIG_FILE`

Precedence per provider setting:

1. environment variable
2. gateway config file value
3. built-in default

Examples:

- profile: `PERSONAL_AGENT_PROFILE` > `gateway.json.profile` > `shared`
- Telegram token: `TELEGRAM_BOT_TOKEN` > `gateway.json.telegram.token`

---

## Setup walkthrough

Use setup instead of manual env export when possible:

```bash
pa gateway setup telegram
pa gateway setup discord
```

Setup writes provider token/allowlist/cwd/max-pending values to `gateway.json`.

---

## Shared environment variables

- `PERSONAL_AGENT_PROFILE` (default `shared`)
- `PERSONAL_AGENT_PI_TIMEOUT_MS` (default `1800000` / 30 minutes; set `0` to disable timeout)

If using `op://...` references, ensure 1Password CLI (`op`) is installed/authenticated.

Optional 1Password overrides:

- `PERSONAL_AGENT_OP_BIN` (default `op`)
- `PERSONAL_AGENT_OP_READ_TIMEOUT_MS` (default `15000`)

---

## Telegram

Required (setup or env):

- `TELEGRAM_BOT_TOKEN`
- `PERSONAL_AGENT_TELEGRAM_ALLOWLIST` (comma-separated chat IDs)

Optional:

- `PERSONAL_AGENT_TELEGRAM_CWD`
- `PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT` (default `20`)
- `PERSONAL_AGENT_TELEGRAM_RETRY_ATTEMPTS` (default `3`)
- `PERSONAL_AGENT_TELEGRAM_RETRY_BASE_DELAY_MS` (default `300`)

Run:

```bash
pa gateway telegram setup
pa gateway telegram start
```

Foreground mode stays attached to terminal (`Ctrl+C` to stop).

---

## Discord

Required (setup or env):

- `DISCORD_BOT_TOKEN`
- `PERSONAL_AGENT_DISCORD_ALLOWLIST` (comma-separated channel IDs)

Optional:

- `PERSONAL_AGENT_DISCORD_CWD`
- `PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL` (default `20`)

Run:

```bash
pa gateway discord setup
pa gateway discord start
```

Foreground mode stays attached to terminal (`Ctrl+C` to stop).

---

## Background service mode (recommended for 24/7)

Supported platforms:

- macOS (`launchd` user agents)
- Linux (`systemd --user` units)

Commands:

```bash
pa gateway service install [telegram|discord]
pa gateway service status [telegram|discord]
pa gateway service uninstall [telegram|discord]
```

Notes:

- Install validates provider token + allowlist first
- Installing gateway service also provisions managed `personal-agentd`
- macOS logs: `~/.local/state/personal-agent/gateway/logs/<provider>.log`
- Linux logs: `journalctl --user -u personal-agent-gateway-<provider>.service -f`
- Telegram durable inbox path: `~/.local/state/personal-agent/gateway/pending/telegram`

---

## Chat/session behavior

Each chat/channel has its own persisted Pi session file.

Telegram additionally durably spools inbound messages before processing; pending messages are replayed after restart/crash.

When a new message arrives while a run is active in the same conversation:

- normal message → steer (interrupt-style)
- `/followup <text>` → queued follow-up delivered after current response

---

## Gateway slash commands

- `/status`
- `/new`
- `/commands`
- `/skills`
- `/skill <name>`
- `/tasks [status]` (`all|running|active|completed|disabled|pending|error`)
- `/model` / `/models`
- `/stop`
- `/followup <text>`
- `/cancel`
- `/compact` (guidance only; manual compaction is in Pi TUI)
- `/resume` (gateway auto-resumes per chat/channel)

Telegram registers slash commands via Bot API on startup.

---

## Daemon integration

Gateway emits non-fatal daemon events:

- `session.updated`
- `session.closed`
- `session.processing.failed`

Gateway also pulls daemon notifications (`notifications.pull`) and delivers:

- Telegram notifications
- Discord notifications

This powers scheduled task output routing (`output.targets`).

If daemon is unavailable, gateway continues processing requests.

Disable daemon integration explicitly with:

- `PERSONAL_AGENT_DISABLE_DAEMON_EVENTS=1`

---

## Access control

Provider allowlist is mandatory.

Messages from non-allowlisted chat/channel IDs are rejected.

---

## Troubleshooting

### Missing token/allowlist

Run setup:

```bash
pa gateway setup telegram
pa gateway setup discord
```

### Service install says token/allowlist missing

Provider setup must be completed first.

### Gateway feels backlogged

Increase pending limits only if needed:

- `PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT`
- `PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL`

For broader incident playbooks, see [Troubleshooting](./troubleshooting.md).
