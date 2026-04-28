# Daemon

The daemon owns unattended behavior.

If something should keep running after the current shell or conversation turn, the daemon is usually involved.

## What it owns

- durable background runs
- scheduled tasks and automations
- conversation wakeups and deferred resumes
- run logs and automation activity
- companion and pairing state for remote/native access
- cleanup and maintenance

## State layout

```text
<state-root>/daemon/
├── personal-agentd.sock
├── logs/
│   └── daemon.log
├── runtime.db
└── runs/
```

Important pieces:

- `runtime.db` — run metadata, automation definitions, scheduler state
- `runs/<run-id>/` — per-run logs and result blobs

Companion auth and host state live under `<state-root>/companion/`. Scheduled task source files default to `<state-root>/sync/tasks`, while task runtime/activity state lives in the daemon database.

## When you need it

Keep the daemon running when you use:

- `run`
- `scheduled_task`
- queued wakeups that should survive the current UI process
- remote pairing or companion behavior

You can still do direct foreground conversation work without it, but unattended behavior degrades.

## Service management

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

Managed services use `launchd` on macOS and `systemd --user` on Linux.

## Companion API

The daemon also serves the native companion API when companion support is enabled.

Defaults:

- host: `127.0.0.1`
- port: `3843`
- API root: `/companion/v1`

The iOS local-dev host uses port `3845` through repo scripts. Use Settings in the desktop app for pairing and host reachability checks.

## Desktop shell note

The desktop app can own the daemon directly instead of relying on a separately managed OS service.

The daemon package still owns the background behavior. Only the host process changes.

## What breaks when it is off

- scheduled automations do not run
- detached runs cannot be launched or inspected normally
- deferred wakeups do not fire
- remote pairing and companion APIs are unavailable

## Related docs

- [Command-Line Guide (`pa`)](./command-line.md)
- [Desktop App](./desktop-app.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
