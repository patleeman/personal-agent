# Gateway Guide (`pa gateway`)

The gateway lets you talk to the same `personal-agent` through chat.

Current provider:

- Telegram

The gateway is not a separate profile, but it now runs as a lightweight coordinator lane.

It uses the same profile, memory, tasks, and durable state model, while delegating substantive work to background agent runs instead of doing heavy work inline.

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

## Send a one-off Telegram message from CLI

You can push a one-off message to Telegram without starting a foreground gateway loop:

```bash
pa gateway send "Your message here"
```

Optional explicit targets:

```bash
pa gateway send "Your message here" --chat-id 123456789
pa gateway telegram send "Your message here" --chat-ids 123456789,-100987654321
```

Target resolution order:

1. explicit `--chat-id` / `--chat-ids`
2. `gateway.json.telegram.allowedUserIds`
3. `gateway.json.telegram.allowlist`

## Configuration model

Gateway config file:

- `~/.local/state/personal-agent/config/gateway.json`

Saved gateway settings live in `gateway.json`.

Examples:

- profile: `gateway.json.profile` → `shared`
- default model: `gateway.json.defaultModel` → profile default model
- Telegram token: `gateway.json.telegram.token`

## Required Telegram setup

Save these fields in `gateway.json` with `pa gateway setup telegram` or from the web UI Gateway page.

Required:

- `gateway.json.telegram.token`
- at least one of:
  - `gateway.json.telegram.allowedUserIds`
  - `gateway.json.telegram.allowlist`

Optional:

- `gateway.json.profile`
- `gateway.json.defaultModel`
- `gateway.json.telegram.blockedUserIds`
- `gateway.json.telegram.workingDirectory`
- `gateway.json.telegram.maxPendingPerChat`
- `gateway.json.telegram.toolActivityStream`
- `gateway.json.telegram.clearRecentMessagesOnNew`

If you use `op://...` values, make sure the 1Password CLI is installed and authenticated. The web UI Gateway page can save these references into `gateway.json` for the Telegram bot token and supported Telegram list fields.

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

## Coordinator mode

The gateway agent is intentionally lightweight.

Practical behavior:

- it defaults to a gateway-specific model when configured
- it keeps direct inline work short
- it delegates substantive work to durable background agent runs
- it exposes only coordinator-style tools to the model: delegate, scheduled tasks, and deferred resume

This keeps Telegram responsive while heavier work happens in separate worker runs.

## What the gateway can do

Telegram supports:

- text messages
- documents
- photos
- voice notes
- typing indicators while generating
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
- `/run ...`
- `/fork [topic name]`
- `/room ...`

## Which mechanism should I use?

### `/resume`

Use `/resume` when you want to switch this chat to an existing saved conversation immediately.

### `/run ...`

Use `/run` when you want to launch or inspect a detached daemon-backed background run.

Good examples:

- training jobs
- scripts
- long test runs
- scrapers

Examples:

```text
/run code-review -- npm test
/run list
/run show <id>
/run logs <id> tail=120
/run cancel <id>
```

### Scheduled tasks (`*.task.md`)

Use scheduled tasks when you want daemon-managed automation on a calendar or one-time schedule, even if nobody is chatting.

Quick rule:

- switch this chat to another session now → `/resume`
- launch a long detached shell job → `/run`
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

It can also:

- edit the saved gateway profile, default model, and Telegram access settings
- save the Telegram bot token directly in `gateway.json`
- save `op://...` 1Password references for the bot token and supported Telegram list settings
- open a gateway-backed conversation into the normal web conversation view

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
