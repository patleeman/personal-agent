# Command-Line Guide (`pa`)

`pa` is the main command-line entry point for `personal-agent`.

It has two jobs:

1. launch Pi with the right layered profile resources
2. manage local system services and machine-level setup around Pi

Inside a live conversation, prefer the built-in runtime tools over shelling out to `pa`. Durable runs and scheduled automations are tool-first now, not public CLI workflows.

## Command map

Top-level commands:

```text
pa status
pa tui
pa install
pa profile
pa doctor
pa restart
pa update
pa daemon
pa ui
pa mcp
```

## Launch Pi

Use `pa tui` to start Pi with the resolved profile resources:

```bash
pa tui
pa tui --profile shared
pa tui -p "summarize this repo"
pa tui -- --model kimi-coding/k2p5
```

Pi passthrough is explicit now: use the `tui` subcommand.

## Inspect local status

```bash
pa status
pa doctor
```

- `pa status` gives the quick machine summary
- `pa doctor` validates the local install and runtime wiring

## Profile management

```bash
pa profile list
pa profile show
pa profile show shared
pa profile use shared
```

## Install package sources

```bash
pa install https://github.com/user/pi-extension
pa install --profile shared npm:@scope/package@1.2.3
pa install --local ./my-extension
```

This writes package sources into profile settings or the local overlay.

## Web UI

```bash
pa ui
pa ui open
pa ui foreground --open
pa ui install
pa ui start
pa ui stop
pa ui restart
pa ui logs --tail 120
pa ui pairing-code
```

Notes:

- `pa ui` with no subcommand shows status and hints
- `pa ui foreground --open` is the fastest local launch
- managed web UI service commands use launchd on macOS and systemd user services on Linux
- `pa ui pairing-code` creates a short-lived pairing code for remote browser access

## Daemon

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

Use the daemon if you rely on scheduled tasks, deferred resumes, or durable runs.

## Runs and automations

There is no public `pa runs` or `pa tasks` workflow anymore.

Use these instead:

- the built-in `run` tool for detached background work
- the built-in `scheduled_task` tool for automations and legacy task-file validation
- the web UI for automation detail, status, and owned run history

## MCP

```bash
pa mcp list
pa mcp list --probe
pa mcp info <server>
pa mcp info <server>/<tool>
pa mcp grep '*jira*'
pa mcp call <server> <tool> '{}'
pa mcp auth <server>
pa mcp logout <server>
```

## Update and restart helpers

```bash
pa restart
pa update
pa update --repo-only
```

- `pa restart` restarts the daemon and managed web UI if installed
- `pa update` pulls repo changes, refreshes dependencies, rebuilds, and restarts services

## Practical CLI flows

### Bring up the web stack

```bash
pa daemon start
pa ui foreground --open
```

### Run an investigation in the background

Use the `run` tool from a conversation, then inspect the owning thread or run detail in the web UI.

### Validate legacy task files after edits

Use the `scheduled_task` tool with `action: "validate"`.

### Inspect configured MCP servers

```bash
pa mcp list --probe -d
```

## Related docs

- [Getting Started](./getting-started.md)
- [Web UI Guide](./web-ui.md)
- [Daemon and Background Automation](./daemon.md)
- [MCP](./mcp.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
