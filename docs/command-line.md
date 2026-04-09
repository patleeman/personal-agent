# Command-Line Guide (`pa`)

`pa` is the main command-line entry point for `personal-agent`.

It has two jobs:

1. launch Pi with the right layered profile resources
2. manage the durable surfaces around Pi

Inside a live conversation, prefer the built-in runtime tools over shelling out to `pa`. Use the CLI when you are operating the local system directly.

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
pa tasks
pa inbox
pa ui
pa mcp
pa runs
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
- `pa ui pairing-code` creates a short-lived pairing code for remote desktop or companion access

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

## Inbox

```bash
pa inbox list
pa inbox show <selector>
pa inbox read <selector>
pa inbox unread <selector>
pa inbox delete <activity-id>
pa inbox create "Summary" --details "Body"
```

The inbox mixes activity records and conversation attention.

## Scheduled tasks

```bash
pa tasks list
pa tasks list --status active
pa tasks show <id>
pa tasks validate --all
pa tasks validate ~/.local/state/personal-agent/sync/_tasks/example.task.md
pa tasks logs <id> --tail 120
```

`pa tasks` inspects the daemon-backed task registry and still validates legacy markdown task files.

## Durable runs

```bash
pa runs list
pa runs show <id>
pa runs logs <id> --tail 120
pa runs start docs-refresh -- bash -lc 'npm test'
pa runs start-agent code-review --prompt "review the current diff"
pa runs rerun <id>
pa runs follow-up <id> --prompt "continue from the last checkpoint"
pa runs cancel <id>
```

Use runs for detached work that starts now.

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

```bash
pa runs start-agent repo-audit --prompt "audit the repo for stale docs and summarize fixes"
pa runs logs <run-id>
```

### Validate task files after edits

```bash
pa tasks validate --all
pa tasks list --status error
```

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
