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

- `pa install ...`
- `pa profile ...`
- `pa doctor`
- `pa daemon ...`
- `pa tasks ...`
- `pa inbox ...`
- `pa ui ...`
- `pa memory ...`
- `pa sync ...`
- `pa gateway ...`
- `pa restart`
- `pa update`

## Most useful commands

### Setup and health

```bash
pa doctor
pa install https://github.com/davebcn87/pi-autoresearch
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
pa sync status
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
pa gateway send "Ping from CLI"
pa gateway service install telegram
```

## Top-level command reference

### `pa tui [args...]`

Launch Pi with the resolved active profile.

### `pa install <source> [--profile <name> | -l | --local]`

Add a Pi package source to durable `pa` settings.

By default this writes to the active profile's mutable `settings.json` in the configured profiles root.
Use `--local` to write to the machine-local overlay instead.

Examples:

```bash
pa install https://github.com/davebcn87/pi-autoresearch
pa install npm:@scope/package@1.2.3
pa install ./my-package
pa install --profile assistant https://github.com/user/repo
pa install --local ./my-package
```

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

### `pa ui [--open] [--port <port>] [--tailscale-serve|--no-tailscale-serve]`

Start the web UI in the foreground.

Examples:

```bash
pa ui
pa ui --open
pa ui --port 4000
pa ui --tailscale-serve
```

`--tailscale-serve` and `--no-tailscale-serve` apply the Tailscale Serve change immediately by invoking the `tailscale` CLI for `localhost:<port>`.

Useful related commands:

```bash
pa ui logs --tail 120
pa ui service install --port 3741 [--tailscale-serve|--no-tailscale-serve]
pa ui service status [--port <port>] [--tailscale-serve|--no-tailscale-serve]
pa ui service restart [--port <port>] [--tailscale-serve|--no-tailscale-serve]
```

See [Web UI Guide](./web-ui.md).

### `pa memory [list|find|show|new|lint]`

Work with the shared global memory docs store.

Examples:

```bash
pa memory list
pa memory find --tag notes
pa memory show quick-note
pa memory new quick-note --title "Quick note" --summary "Why this exists" --tags notes
pa memory lint
```

See [Profiles, Memory, and Skills](./profiles-memory-skills.md).

### `pa runs [list|show|logs|start|cancel|help]`

Inspect and manage durable daemon-backed background runs.

Examples:

```bash
pa runs list
pa runs show <id>
pa runs logs <id> --tail 120
pa runs start code-review -- pa -p "review this diff"
pa runs cancel <id>
```

Use this as the main control surface for detached local background work.

### `pa sync [status|run|setup|help]`

Configure and trigger automatic git sync for durable state.

Examples:

```bash
pa sync status
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --fresh
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --bootstrap
pa sync setup --repo <git-url> --branch main --repo-dir ~/.local/state/personal-agent/sync
pa sync run
```

Use `--fresh` for first-time setup into a new/empty remote. Use `--bootstrap` on additional devices (or existing remotes with history).

The setup command moves syncable state under `<stateRoot>/sync`, configures the daemon sync module, and enables periodic background git sync.

Synced roots include:

- `profiles/**`
- `pi-agent/**` (durable sessions/state only)
- `config/**` (setup seeds `config/config.json`; daemon/gateway/web config stay machine-local)

Machine-local runtime files such as auth, settings, generated prompt materialization, and `bin/**` live under `pi-agent-runtime/**` and are not synced.

See [Sync Guide](./sync.md).

### `pa gateway ...`

Manage the Telegram gateway.

See [Gateway Guide](./gateway.md).

### `pa restart [--rebuild]`

Restart the daemon, managed web UI service, and any installed gateway services.
Use `--rebuild` to rebuild repo packages first and blue/green redeploy the managed web UI, similar to the restart phase of `pa update` without pulling git changes.

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

### Configure sync on another device

```bash
git pull
pa restart --rebuild
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --bootstrap
pa sync run
pa sync status
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
pa runs list --json
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
- [Sync Guide](./sync.md)
- [Configuration](./configuration.md)
- [Troubleshooting](./troubleshooting.md)
