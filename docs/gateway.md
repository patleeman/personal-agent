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

Setup writes provider token/allowlist/allowed-user-ids/blocked-user-ids/cwd/max-pending values to `gateway.json`.

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

Strongly recommended:

- `PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS` (comma-separated Telegram user IDs allowed to control the bot)

Optional:

- `PERSONAL_AGENT_TELEGRAM_ALLOWLIST` (comma-separated chat IDs)
- `PERSONAL_AGENT_TELEGRAM_BLOCKED_USER_IDS` (comma-separated Telegram user IDs)
- `PERSONAL_AGENT_TELEGRAM_CWD`
- `PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT` (default `20`)
- `PERSONAL_AGENT_TELEGRAM_RETRY_ATTEMPTS` (default `3`)
- `PERSONAL_AGENT_TELEGRAM_RETRY_BASE_DELAY_MS` (default `300`)
- `PERSONAL_AGENT_TELEGRAM_TOOL_ACTIVITY_STREAM` (default `false`) — stream temporary tool-call/result status while a run is active

Run:

```bash
pa gateway telegram setup
pa gateway telegram start
```

Foreground mode stays attached to terminal (`Ctrl+C` to stop).

Telegram behavior highlights:

- Inbound support: text, documents, photos, and voice notes
- Image attachments are passed to Pi as native image inputs
- Rich HTML formatting for code blocks/headings/links in bot replies
- Streaming uses message edits (live-updating response)
- Optional tool activity stream can show temporary tool-call/result updates, then remove/collapse when the assistant reply completes
- Very long outputs are sent as `.txt` document attachments
- Inline action buttons on replies: Stop, New, Regenerate, Follow up

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

- Install validates provider token + access settings first
- Installing gateway service also provisions managed `personal-agentd`
- macOS logs: `~/.local/state/personal-agent/gateway/logs/<provider>.log`
- Linux logs: `journalctl --user -u personal-agent-gateway-<provider>.service -f`
- Telegram durable inbox path: `~/.local/state/personal-agent/gateway/pending/telegram`

---

## Chat/session behavior

Each chat/channel has its own persisted Pi session file. Telegram forum topics/threads are isolated per `chat_id + message_thread_id`.

Gateway runs append a gateway-specific system-prompt block before each turn so the model knows:

- it is operating in chat-gateway mode (not TUI)
- which gateway/provider is active (Telegram or Discord)
- what gateway features and commands are available
- how media/file delivery behaves
- chat-style response rules (concise by default; no code snippets/file paths unless asked)

Telegram additionally durably spools inbound messages before processing; pending messages are replayed after restart/crash.

When a new message arrives while a run is active in the same conversation:

- normal message → steer (interrupt-style)
- `/followup <text>` → queued follow-up delivered after current response
- `/followup` (no args) → puts chat into one-shot follow-up capture mode (next message is treated as follow-up)

---

## Gateway slash commands

- `/status`
- `/new`
- `/commands`
- `/skills`
- `/skill <name>`
- `/tasks [status]` (`all|running|active|completed|disabled|pending|error`)
- `/room [help|pending|approve <chatId>|deny <chatId>|blocked]` (Telegram room authorization admin)
- `/tmux [help|list|inspect|logs|stop|send|run|clean]` (Telegram managed tmux command helper)
- `/model` / `/models`
- `/stop`
- `/followup <text>` (or `/followup` for one-shot follow-up capture mode)
- `/regenerate`
- `/cancel`
- `/compact [instructions]` (runs native Pi compaction)
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

- Discord: channel allowlist is mandatory.
- Telegram: chat allowlist is optional (you can start empty and approve rooms as the bot is added).
- Telegram `allowedUserIds` can restrict bot control to specific Telegram user IDs.
- Telegram `blockedUserIds` are silently ignored.

Telegram room authorization flow:

- When the bot is added to a non-private chat, it can DM allowed users with approve/deny buttons.
- Approve adds the room to the Telegram allowlist.
- Deny removes the room, leaves the chat, and adds the inviter to blocked user IDs (with best-effort in-chat ban when permissions allow).

---

## Troubleshooting

### Missing token/allowlist/allowed users

Run setup:

```bash
pa gateway setup telegram
pa gateway setup discord
```

### Service install says token/access settings missing

Provider setup must be completed first. Telegram service install requires either a chat allowlist or allowed user IDs.

### Gateway feels backlogged

Increase pending limits only if needed:

- `PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT`
- `PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL`

For broader incident playbooks, see [Troubleshooting](./troubleshooting.md).
