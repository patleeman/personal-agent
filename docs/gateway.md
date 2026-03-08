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

Setup writes provider token/allowlist/allowed-user-ids/blocked-user-ids/cwd/max-pending/tool-activity/clear-on-new values to `gateway.json`.

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
- `PERSONAL_AGENT_TELEGRAM_TOOL_ACTIVITY_STREAM` (default `false`) — show a temporary tool-running acknowledgement while a run is active (deleted when reply completes)
- `PERSONAL_AGENT_TELEGRAM_CLEAR_RECENT_MESSAGES_ON_NEW` (default `true`) — best-effort clear recent tracked Telegram messages when `/new` is used

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
- Streaming uses message edits in private chats; group/supergroup chats use chunked message streaming to reduce edit-rate limits
- Optional tool activity indicator can show a temporary “running tools” acknowledgement, then delete it when the assistant reply completes
- Very long outputs are sent as `.txt` document attachments
- Inline action buttons on replies: Stop, New, Regenerate, Follow up
- Telegram slash menu auto-registers `/skill_*` shortcuts for discovered profile skills (mapped to `/skill:<skill-name>`)

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

Telegram persists conversation→session bindings (used by `/fork`) and source-conversation→work-topic bindings (used by `/tmux run ... fork=auto`) under the gateway state directory so branch routing survives restarts.

`/new` resets the Pi session file and (when enabled) attempts to delete recent tracked Telegram messages in that same chat/topic (best-effort, permission/age limits apply). Configure via `PERSONAL_AGENT_TELEGRAM_CLEAR_RECENT_MESSAGES_ON_NEW` or `gateway.telegram.clearRecentMessagesOnNew`.

`/clear` (Telegram) keeps the current session and best-effort clears recent messages in the current chat/topic. In forum topics, it clears tracked messages for that topic to avoid deleting other topics. Use `/clear all` for a deeper non-topic sweep.

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
- the agent may also call the `deferred_resume` tool to schedule this same durable conversation/session to wake back up later
  - deferred resumes are daemon-backed background wake-ups
  - when due and the conversation is still active, the prompt queues as a normal follow-up
  - when due and the conversation is idle, gateway starts a new run on the same session file

---

## Gateway slash commands

- `/status`
- `/chatid` (show current room/chat ID; includes topic thread ID in Telegram forums)
- `/new` (start a fresh session and, when enabled, best-effort clear recent tracked messages in the current chat/topic)
- `/clear` (Telegram only; best-effort clear recent messages in the current chat/topic without resetting the session; supports `/clear all` for deeper non-topic sweeps)
- `/commands`
- `/skills` (compatibility alias; Telegram slash menu hides this)
- `/skill <name>` (and `/skill:<name>`)
- `/tasks [status]` (`all|running|active|completed|disabled|pending|error`)
- `/room [help|pending|approve <chatId>|deny <chatId>|blocked]` (Telegram room authorization admin)
- `/tmux [help|list|inspect|logs|stop|send|run|clean]` (Telegram managed tmux command helper)
  - `/tmux run <task> [fork=none|auto|new-topic|reuse-topic] [notify=none|message|resume] [group=<id>|auto] [topic=<name>|auto] -- <command>`
- `/model` / `/models`
- `/stop`
- `/followup <text>` (or `/followup` for one-shot follow-up capture mode)
- `/deferred` (show queued deferred resumes)
- `/regenerate`
- `/cancel`
- `/compact [instructions]` (runs native Pi compaction)
- `/fork [topic name]` (Telegram only; by default creates a new forum topic and forks Pi into that topic branch. `/fork` auto-generates a topic name, `/fork <topic name>` uses your name.)
- `/resume [index|conversation-id|file]` (list saved conversations and switch this chat/channel to one)

Telegram registers slash commands via Bot API on startup.

`/tmux run` orchestration notes:
- `fork=auto` creates one work topic per source conversation (first run) and then reuses it.
- `group=auto` groups parallel runs targeting the same source+work conversation while active.
- `notify=resume` posts completion summary and injects a single follow-up continuation prompt in the work topic when the whole run group finishes.

## Which mechanism should I use?

### `deferred_resume` tool

Use the `deferred_resume` tool when the **agent itself** should wake this same Telegram/Discord conversation later.

Behavior:

- schedules a daemon-backed delayed resume for the **current durable conversation/session**
- meant for agent-controlled “pause now, continue later” behavior
- best for waiting on time to pass or for background work to make progress
- not a user slash command; the assistant should call it directly when appropriate

### `/deferred`

Use `/deferred` when you want to **inspect whether deferred resumes are queued**.

Behavior:

- read-only visibility into queued deferred resumes
- does not schedule anything
- useful for checking whether the agent already queued a wake-up

### `/resume`

Use `/resume` when you want to **switch this chat/channel to an existing saved conversation immediately**.

Examples:

```text
/resume
/resume 2
/resume some-session.jsonl
```

Behavior:

- does **not** wait for a timer
- changes which persisted session file this chat/channel is bound to
- is for session selection/switching, not delayed wake-up

### `/tmux run ...`

Use `/tmux run` when you want to launch a **detached shell job** (training run, scraper, test suite, long script).

Example:

```text
/tmux run train notify=resume -- python scripts/train.py
```

Behavior:

- starts a managed tmux session in the background
- the work happens in tmux, not inside the chat request itself
- logs are attached to the tmux session
- `notify=resume` is only a **completion hook**: when the tmux run group finishes, gateway posts a summary and injects one continuation follow-up into the target conversation
- `notify=resume` is not a general timer/scheduler; `deferred_resume` is the delayed same-conversation wake-up mechanism

### Scheduled tasks (`*.task.md`)

Use scheduled tasks when you want **daemon-managed automation on cron/at schedules**, even if no one is currently chatting.

Behavior:

- independent of the current live conversation flow
- best for recurring reminders, reports, or unattended automation
- can send output to gateway chats/channels, but they are daemon jobs, not “pause this exact conversation and resume it later” semantics

Quick rule of thumb:

- **Agent should resume this same conversation later** → `deferred_resume` tool
- **Check whether deferred resumes are queued** → `/deferred`
- **Switch this chat to another saved conversation now** → `/resume`
- **Run a long background shell command** → `/tmux run`
- **Run something on a calendar/schedule** → scheduled task

In Pi TUI sessions, the footer/status bar also shows a `resume:` indicator for queued deferred resumes. A trailing `*` means the current session has at least one queued deferred resume.

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
- Direct messages from `allowedUserIds` work even if their DM chat ID is not pre-allowlisted.
- Non-private chats added by an `allowedUserIds` user are auto-authorized and persisted.
- Telegram `blockedUserIds` are silently ignored.

Telegram room authorization flow:

- When the bot is added to a non-private chat by someone outside `allowedUserIds`, it can DM allowed users with approve/deny buttons.
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
