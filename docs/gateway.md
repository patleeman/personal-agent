# Gateway Guide (`pa gateway`)

The gateway lets you talk to the same `personal-agent` through chat.

Current provider:

- Telegram

The gateway is not a separate agent. It uses the same profile, memory, projects, daemon integration, and durable state model.

## Why use the gateway

Use the gateway when you want to:

- interact with the agent from Telegram
- receive scheduled task output in chat
- keep conversation threads outside the local UI
- resume or continue work remotely

## Basic setup

Interactive setup:

```bash
pa gateway setup telegram
```

Foreground run:

```bash
pa gateway telegram start
```

Recommended for 24/7 use:

```bash
pa gateway service install telegram
```

Installing the gateway service also provisions the managed daemon so background events stay enabled.

## Configuration model

Gateway config file:

- `~/.config/personal-agent/gateway.json`

Per-setting precedence:

1. environment variable
2. `gateway.json`
3. built-in default

Examples:

- profile: `PERSONAL_AGENT_PROFILE` → `gateway.json.profile` → `shared`
- Telegram token: `TELEGRAM_BOT_TOKEN` → `gateway.json.telegram.token`

## Required Telegram setup

Required:

- `TELEGRAM_BOT_TOKEN`

Strongly recommended:

- `PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS`

Optional:

- `PERSONAL_AGENT_TELEGRAM_ALLOWLIST`
- `PERSONAL_AGENT_TELEGRAM_BLOCKED_USER_IDS`
- `PERSONAL_AGENT_TELEGRAM_CWD`
- `PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT`
- `PERSONAL_AGENT_TELEGRAM_TOOL_ACTIVITY_STREAM`
- `PERSONAL_AGENT_TELEGRAM_CLEAR_RECENT_MESSAGES_ON_NEW`

If you use `op://...` values, make sure the 1Password CLI is installed and authenticated.

## Access control

Telegram access control is built around:

- allowed user ids
- optional chat allowlist
- optional blocked user ids

Practical rules:

- direct messages from allowed users work even if the DM chat id is not pre-allowlisted
- non-private chats can be auto-authorized when added by an allowed user
- blocked users are ignored

## Session model

Each Telegram chat has its own persisted Pi session.

For Telegram forum topics, the unit is:

- `chat_id + message_thread_id`

Useful consequences:

- each room or topic can have its own ongoing conversation
- `/new` resets the current session binding
- `/resume` can switch the chat to a saved conversation
- forked work can be routed into separate topics

## What the gateway can do

Telegram supports:

- text messages
- documents
- photos
- voice notes
- streaming replies
- inline action buttons on replies
- long-output `.txt` attachment fallback
- pending message replay after restart or crash

This makes it useful for both quick chats and long-running remote workflows.

## Common slash commands

### Session control

- `/status`
- `/new`
- `/clear`
- `/resume`
- `/stop`
- `/regenerate`
- `/cancel`
- `/followup`

### Skills and models

- `/commands`
- `/skills`
- `/skill <name>`
- `/skill:<name>`
- `/model`
- `/models`
- `/compact`

### Background and orchestration

- `/tasks [status]`
- `/tmux ...`
- `/fork [topic name]`
- `/room ...`

## Which mechanism should I use?

### `/resume`

Use `/resume` when you want to switch this chat to an existing saved conversation immediately.

### `/tmux run ...`

Use `/tmux run` when you want to launch a detached shell job.

Good examples:

- training jobs
- scripts
- long test runs
- scrapers

### Scheduled tasks (`*.task.md`)

Use scheduled tasks when you want daemon-managed automation on a calendar or one-time schedule, even if nobody is chatting.

Quick rule:

- switch this chat to another session now → `/resume`
- launch a long detached shell job → `/tmux run`
- run automation on a schedule → scheduled task

## Relationship to the daemon

The gateway works best with the daemon running.

Daemon integration is what powers things like:

- scheduled task output routing to Telegram
- background notifications
- durable pending message handling around restarts

If the daemon is unavailable, gateway request handling can still continue, but background integration is reduced.

## Service mode

Recommended for daily use:

```bash
pa gateway service install telegram
pa gateway service status telegram
```

Foreground mode is fine for testing, but service mode is the right default for always-on chat access.

## Web UI integration

The web UI has a Gateway page that shows:

- service status
- tracked gateway conversations
- pending durable inbound messages
- access lists
- recent logs

It can also open a gateway-backed conversation into the normal web conversation view.

See [Web UI Guide](./web-ui.md).

## Scheduled task output routing

A scheduled task can target Telegram in its `output` section.

Example:

```yaml
output:
  when: failure
  targets:
    - gateway: telegram
      chatId: "123456789"
```

This is the main path for unattended automation to message you later.

## Troubleshooting quick hits

### Missing token or access settings

Run:

```bash
pa gateway setup telegram
```

### Service installs but nothing seems to happen

Check:

```bash
pa gateway service status telegram
pa daemon status
```

### Need logs

- macOS: `~/.local/state/personal-agent/gateway/logs/telegram.log`
- Linux: `journalctl --user -u personal-agent-gateway-telegram.service -f`

For broader debugging, see [Troubleshooting](./troubleshooting.md).

## Related docs

- [Daemon and Background Automation](./daemon.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Web UI Guide](./web-ui.md)
- [Configuration](./configuration.md)
