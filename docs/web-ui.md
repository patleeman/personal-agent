# Web UI Guide

The web UI is the easiest way to work with `personal-agent` day to day.

It gives you one place to see:

- inbox attention
- conversations
- projects
- scheduled tasks
- gateway state
- daemon state
- memory
- profile and model settings

## Start the UI

Foreground mode:

```bash
pa ui
pa ui --open
pa ui --port 4000
pa ui --tailscale-serve
```

Managed service mode for day-to-day use:

```bash
pa ui service install [--port <port>] [--tailscale-serve|--no-tailscale-serve]
pa ui service status [--port <port>] [--tailscale-serve|--no-tailscale-serve]
pa ui service restart [--port <port>] [--tailscale-serve|--no-tailscale-serve]
```

Default address (local interface):

- `http://localhost:3741`

## Expose with Tailscale Serve

You can expose the running web UI to your Tailnet via Tailscale Serve.
The UI and `pa ui` config persist this preference in `~/.local/state/personal-agent/config/web.json` as:

```json
{
  "useTailscaleServe": true,
  "port": 3741
}
```

This means:

- web UI launch and managed service actions read the preference consistently,
- the Web UI page shows and toggles the setting,
- enabling it in the UI or via `--tailscale-serve` runs `tailscale serve --bg localhost:<port>` for you,
- disabling it via `--no-tailscale-serve` runs `tailscale serve --bg localhost:<port> off`.

If the `tailscale` CLI is unavailable (or the node is not authenticated), the toggle/flag returns an error so the mismatch is visible immediately.

Note: `tailscale serve` is tailnet-only by default. Use [Funnel](https://tailscale.com/kb/1223/funnel/) only when you explicitly want public internet access.

The web app uses the current active profile.

The managed service is the recommended way to run the UI when you want it to be your main interface.
It survives terminal closes, restarts automatically, and can be restarted by `pa update`.
When installed, updates use blue/green staging: the next release is built into the inactive slot, health-checked on a candidate port, then swapped in.

The UI also has a dedicated **Web UI** page for:

- managed service status
- active vs inactive blue/green release info
- rebuild + restart controls for the full application
- recent web UI logs

## Logs

Inspect recent managed web UI logs with:

```bash
pa ui logs
pa ui logs --tail 120
```

Default log location:

- `~/.local/state/personal-agent/web/logs/web.log`

## What the UI is for

Use the UI when you want:

- a persistent inbox
- easy conversation browsing and branching
- project management backed by `PROJECT.yaml`
- visibility into daemon and gateway state
- a visual memory browser
- live updates without polling

## Main sections

### Inbox

The Inbox page shows:

- standalone inbox activity
- archived conversations that need attention

Typical examples:

- scheduled task output
- deferred resume activity
- background failures
- conversations resurfaced by linked background work

You can:

- filter unread vs all
- mark everything read
- open individual items or conversations

See [Inbox and Activity](./inbox.md).

### Conversations

Conversations are where live work happens.

The UI supports:

- live sessions
- resumed sessions from saved history
- message streaming
- conversation forks
- branch navigation
- context usage display
- file/image input

A new draft conversation becomes a live session when you send the first prompt.

### Projects

Projects are durable cross-conversation work hubs.

From the Projects page you can:

- create a project from a short title plus a longer description
- inspect current status, blockers, optional milestones, and tasks
- edit the canonical `PROJECT.yaml`
- edit or regenerate `BRIEF.md`
- append project notes
- upload attachments and project artifacts
- see linked conversations for the project
- start a new conversation directly from the project
- view a combined project timeline

See [Projects](./projects.md).

### Scheduled

The Scheduled page is the UI for daemon tasks.

You can:

- see discovered tasks
- see current status and recent runs
- enable or disable a task
- run a task immediately

See [Scheduled Tasks](./scheduled-tasks.md).

### Gateway

The Gateway page shows Telegram state.

It surfaces:

- service status
- tracked gateway conversations
- pending durable inbound messages
- access settings
- recent logs

You can also:

- edit saved Telegram gateway settings from the UI
- store the bot token as either a plain value or an `op://...` 1Password reference
- install, start, stop, restart, or uninstall the managed gateway service

See [Gateway Guide](./gateway.md).

### Daemon

The Daemon page shows background automation status.

It surfaces:

- whether the daemon service is installed and running
- runtime connection status
- PID and uptime information
- recent logs

You can also manage the daemon service from the UI.

See [Daemon and Background Automation](./daemon.md).

### Memory

The Memory page is a user-facing browser for:

- profile `AGENTS.md`
- skills
- memory docs

It is meant to answer:

- who is this profile supposed to be?
- what reusable workflows does it have?
- what durable notes and references does it know?

See [Profiles, Memory, and Skills](./profiles-memory-skills.md).

### Tools

The Tools page is the inspection and package-install surface for agent capabilities.

You can:

- inspect the tools available to new sessions
- review tool schemas and parameters
- add Pi package sources to any profile or the local overlay
- inspect dependent CLI tools and configured MCP servers

### Settings

Settings lets you change:

- browser theme
- active profile
- default model
- default thinking level
- conversation auto-title behavior and title model
- saved UI state

Switching the active profile affects:

- inbox
- projects
- memory
- gateway state
- new live sessions

## Prompt references in conversations

The composer supports `@` references.

You can reference:

- projects
- scheduled tasks
- memory docs
- skills
- profiles

When you mention these items, the UI resolves them and injects durable context into the live session.

This makes the conversation aware of the durable objects you are pointing at, instead of copying them manually into the prompt.

## Referenced projects and working directory selection

Referenced projects matter in two ways:

1. they stay attached to the conversation as durable project context
2. if a new conversation references exactly one project with a `repoRoot`, that repo root can become the initial working directory when no explicit cwd is set

That makes project references more than just labels.

## Common conversation composer commands

The UI supports slash-style commands in the composer.

Common ones include:

- `/model` — pick a model
- `/project new <title>` — create a project quickly using the same text for both title and description
- `/project reference <id>` — reference a project in this conversation
- `/project unreference <id>` — stop referencing a project
- `/resume <delay> [prompt]` — schedule this conversation to continue later (`/defer` also works)
- `/draw` — open the Excalidraw editor and attach a drawing
- `/drawings` — attach an existing saved drawing/revision from this conversation
- `/fork` — fork a conversation branch
- `/compact` — compact context
- `/reload` — reload profile resources
- `/new` — start a new session
- `/tree` — open branch navigation

There are also convenience commands such as `/run`, `/search`, `/summarize`, and `/think`.

## Live updates

The UI uses server-sent events for snapshots and updates.

That means:

- inbox, projects, sessions, and tasks update live
- you usually do not need to refresh manually
- if the SSE connection drops, the UI will try to reconnect

If live updates are offline, refresh buttons remain available on each page.

## Relationship to the CLI and gateway

The web UI is not a separate system.

It uses the same underlying state as:

- `pa tui`
- `pa tasks`
- `pa inbox`
- `pa gateway`
- `pa daemon`

So, for example:

- a scheduled task run can create an inbox item visible in the UI
- a Telegram session can be resumed into a web conversation
- a project created in the UI is the same durable project the agent can update in a conversation

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Projects](./projects.md)
- [Inbox and Activity](./inbox.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Gateway Guide](./gateway.md)
- [Daemon and Background Automation](./daemon.md)
