# Daemon and Background Automation

`personal-agentd` is the shared background process behind unattended behavior.

If you care about scheduled tasks, deferred work, or durable gateway notifications, you usually want the daemon running.

## What the daemon does

The daemon is responsible for background automation such as:

- scheduled tasks
- deferred resume handling
- git-backed durable-state sync
- background maintenance
- routing task notifications to the gateway

It lets the CLI, web UI, and gateway stay relatively thin while one process handles long-lived background work.

## When you need it

You should keep the daemon on if you use:

- scheduled tasks
- Telegram task output routing
- deferred resume
- git-backed cross-machine sync
- always-on background workflows

You can still use `pa tui`, the web UI, and many direct features without it, but background behavior becomes limited.

## What happens if the daemon is off

When the daemon is unavailable:

- direct CLI and web conversation work can still continue
- scheduled tasks do not run
- daemon-backed background events are disabled
- some integrations fall back to degraded behavior instead of hard-failing

## Built-in modules

### Maintenance

Handles periodic housekeeping such as log cleanup.

### Tasks

Discovers and runs `*.task.md` files.

This module is what powers scheduled task runs, retries, logs, and gateway output routing.

See [Scheduled Tasks](./scheduled-tasks.md).

### Deferred resume

Tracks due deferred work and surfaces it back into durable state when the time arrives.

### Sync

Handles git-backed durable-state sync when configured via `pa sync setup` (or the Web UI Sync page).

This module:

- commits local sync-repo changes when needed
- fetches/merges/pushes against the configured remote branch
- records sync/conflict/error status for CLI and web UI inspection
- can trigger resolver tasks for conflicts and sync errors

See [Sync Guide](./sync.md).

## Recommended ways to run it

### Recommended: managed service

```bash
pa daemon service install
```

Supported platforms:

- macOS (`launchd`)
- Linux (`systemd --user`)

### Foreground mode

Useful for testing:

```bash
pa daemon start
```

## Basic commands

```bash
pa daemon status
pa daemon start
pa daemon stop
pa daemon restart
pa daemon logs
pa daemon service install
pa daemon service status
pa daemon service uninstall
```

## Status and logs

Check current status:

```bash
pa daemon status
pa daemon status --json
```

Show log location and PID:

```bash
pa daemon logs
```

## Where daemon state lives

Default root:

- `~/.local/state/personal-agent/daemon`

Common files:

- socket: `personal-agentd.sock`
- pid: `personal-agentd.pid`
- log: `logs/daemon.log`
- task runtime state: `task-state.json`
- task run logs: `task-runs/**`

## Relationship to other features

### Scheduled tasks

The daemon discovers task files and executes them.

Without the daemon, scheduled tasks do not run.

### Gateway

The gateway can pull daemon-backed notifications and surface background results into Telegram.

Installing the gateway managed service also provisions the daemon.

### Inbox

Scheduled task and deferred-resume events can create durable local inbox activity.

## Configuration

Main config file:

- `~/.local/state/personal-agent/config/daemon.json`

Use it to control:

- task discovery path
- retry behavior
- tick interval
- default timeout
- socket path and queue settings

See [Configuration](./configuration.md).

## A practical mental model

Think of the daemon as the system's background engine:

- conversations are foreground work
- the daemon is background work
- the inbox is where important async outcomes surface later

## Related docs

- [Scheduled Tasks](./scheduled-tasks.md)
- [Sync Guide](./sync.md)
- [Inbox and Activity](./inbox.md)
- [Gateway Guide](./gateway.md)
- [Configuration](./configuration.md)
