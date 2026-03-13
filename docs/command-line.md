# Command-Line Guide (`pa`)

`pa` is the main command-line entry point for `personal-agent`.

It has two jobs:

1. launch Pi with the right profile resources
2. manage the durable features around Pi

## Command model

### 1. Run Pi with profile resources

Use:

```bash
pa tui
pa tui --profile assistant
pa -p "hello"
pa --profile assistant -p "hello"
```

If `pa` sees an unknown top-level argument, it treats the command as Pi passthrough.

Example:

```bash
pa -p "summarize this repo"
```

### 2. Manage durable features

These commands are handled by `personal-agent` itself:

- `pa profile ...`
- `pa doctor`
- `pa daemon ...`
- `pa tasks ...`
- `pa inbox ...`
- `pa ui ...`
- `pa memory ...`
- `pa tmux ...`
- `pa gateway ...`
- `pa restart`
- `pa update`

## Most useful commands

### Setup and health

```bash
pa doctor
pa profile list
pa profile use <name>
pa daemon status
```

### Daily use

```bash
pa ui --open
pa tui
pa -p "hello"
pa inbox list
pa memory list
pa tasks list
```

### Background automation

```bash
pa daemon start
pa daemon service install
pa tasks validate --all
pa tasks logs <id>
```

### Gateway

```bash
pa gateway setup telegram
pa gateway telegram start
pa gateway service install telegram
```

## Top-level command reference

### `pa tui [args...]`

Launch Pi with the resolved active profile.

### `pa profile [list|show|use]`

Manage the active profile.

Examples:

```bash
pa profile list
pa profile show
pa profile use assistant
```

### `pa doctor [--json]`

Run setup checks.

### `pa daemon [status|start|stop|restart|logs|service|help]`

Manage the background daemon.

Examples:

```bash
pa daemon status
pa daemon start
pa daemon service install
```

### `pa tasks [list|show|validate|logs]`

Inspect scheduled daemon tasks.

Examples:

```bash
pa tasks list
pa tasks show <id>
pa tasks validate --all
pa tasks logs <id> --tail 120
```

See [Scheduled Tasks](./scheduled-tasks.md).

### `pa inbox [list|show|create|read|unread|delete]`

Inspect and manage surfaced inbox items.

Examples:

```bash
pa inbox list
pa inbox list --conversations
pa inbox show activity:nightly-review
pa inbox show conversation:conv-123
pa inbox create "Nightly review finished" --kind note
pa inbox read conversation:conv-123
```

See [Inbox and Activity](./inbox.md).

### `pa ui [--open] [--port <port>]`

Start the web UI in the foreground.

Examples:

```bash
pa ui
pa ui --open
pa ui --port 4000
```

Useful related commands:

```bash
pa ui logs --tail 120
pa ui service install --port 3741
pa ui service status
pa ui service restart
```

See [Web UI Guide](./web-ui.md).

### `pa memory [list|find|show|new|lint]`

Work with profile memory docs.

Examples:

```bash
pa memory list
pa memory find --tag notes
pa memory show quick-note
pa memory new quick-note --title "Quick note" --summary "Why this exists" --tags notes
pa memory lint
```

See [Profiles, Memory, and Skills](./profiles-memory-skills.md).

### `pa runs [list|show|logs|help]`

Inspect durable daemon-backed background runs.

Examples:

```bash
pa runs list
pa runs show <id>
pa runs logs <id> --tail 120
```

Use this as the main inspection surface for durable background work.

### `pa tmux [list|inspect|logs|stop|send|run|clean|help]`

Manage agent-owned tmux sessions.

This is still available for legacy/manual tmux workflows, but durable daemon-backed work should prefer `pa runs`.

### `pa gateway ...`

Manage the Telegram gateway.

See [Gateway Guide](./gateway.md).

### `pa restart`

Restart the daemon, managed web UI service, and any installed gateway services.

### `pa update [--repo-only]`

Pull latest changes, refresh dependencies, rebuild packages, and restart background services.
If the managed web UI service is installed, `pa update` stages the next web UI release into the inactive blue/green slot, health-checks it on a candidate port, then swaps the service to the new slot.

## Common workflows

### Run one prompt with the active profile

```bash
pa -p "Summarize the latest inbox items"
```

### Open the UI and inspect background state

```bash
pa ui --open
pa daemon status
pa tasks list
pa runs list
pa inbox list --unread
```

### Create and validate a memory note

```bash
pa memory new repo-notes \
  --title "Repo Notes" \
  --summary "Useful notes about this repo" \
  --tags repo,notes
pa memory lint
```

### Debug a scheduled task

```bash
pa tasks show morning-report
pa tasks logs morning-report --tail 120
pa tasks validate --all
```

## JSON output

Machine-readable output is available for the main inspection commands.

Examples:

```bash
pa doctor --json
pa daemon status --json
pa tasks list --json
pa tasks show <id> --json
pa memory list --json
pa inbox list --json
pa tmux list --json
```

## Plain output

If you want simpler terminal output:

```bash
pa --plain ...
```

Or set:

- `PERSONAL_AGENT_PLAIN_OUTPUT=1`
- `NO_COLOR=1`

## Related docs

- [Getting Started](./getting-started.md)
- [How personal-agent works](./how-it-works.md)
- [Web UI Guide](./web-ui.md)
- [Configuration](./configuration.md)
- [Troubleshooting](./troubleshooting.md)
