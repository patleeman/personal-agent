# Daemon and Background Automation

`personal-agentd` is the shared background runtime behind unattended behavior.

If you care about scheduled tasks / automations, deferred resumes, or daemon-backed durable runs, you usually want the daemon running.

In the desktop app, the daemon can be owned directly by the Electron runtime instead of being managed as a separate OS service. The same daemon package still owns the background logic; only the host process changes.

## What the daemon does

The daemon owns background automation such as:

- scheduled tasks / automations
- deferred resume wakeups
- durable background runs
- maintenance and cleanup

It gives the CLI, web UI, and desktop shell one place to hand off long-lived work.

## On-disk state

By default, daemon state lives under:

```text
~/.local/state/personal-agent/daemon/
├── personal-agentd.sock
├── logs/
│   └── daemon.log
├── runtime.db
└── runs/
```

Important pieces:

- `runtime.db` stores daemon-backed runtime state, including durable run metadata and task scheduler state
- `runs/<run-id>/` stores per-run logs and results

## When you need it

Keep the daemon on if you use:

- scheduled tasks / automations
- deferred resumes
- durable runs
- unattended background workflows that should survive the current shell

You can still use `pa tui` and much of the web UI without it, but background behavior becomes limited.

## Built-in modules

### Maintenance

Periodic housekeeping for daemon runtime files.

### Tasks

Loads scheduled task files, keeps runtime state in SQLite, runs due work, and tracks retries/status.

### Deferred resume

Wakes saved conversations back up when deferred work becomes due.

## Service management

The CLI service commands matter for headless / CLI-managed daemon usage.

When the packaged desktop app owns the daemon directly, desktop lifecycle controls are the source of truth instead and launchd/systemd service actions are intentionally not the normal control path.

CLI surface:

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

Managed services use:

- `launchd` on macOS
- `systemd --user` on Linux

## What happens if the daemon is off

When the daemon is unavailable:

- direct live conversation work can still continue
- scheduled tasks / automations do not run
- deferred resumes do not fire
- daemon-backed runs cannot be managed normally
- some surfaces fall back to degraded behavior instead of hard-failing

## Related docs

- [Command-Line Guide (`pa`)](./command-line.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
