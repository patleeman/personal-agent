# personal-agent

A personal application layer over Pi that keeps:

- **product code and shared defaults in git** (`defaults/`, `extensions/`, `themes/`)
- **mutable profile skills + runtime state local** (`~/.local/state/personal-agent`)
- **web UI + daemon-backed automation** for daily use

## Features

- **Profile system** - Layered configs (shared → profile → local) with skills, extensions, themes
- **`pa tui`** - Launch Pi with layered profile resources and memory policy injection
- **Daemon** - Background processing for maintenance + scheduled tasks
- **Web UI** - Browser-based workspace, conversations, projects, and system controls
- **Extensions** - Pi extensions auto-discovered from profiles with dependency auto-install

## Packages

- `@personal-agent/core` — runtime path/bootstrap + profile data merge engine
- `@personal-agent/resources` — profile discovery/materialization + Pi resource args
- `@personal-agent/daemon` — shared background daemon (`personal-agentd`) with event bus + modules
- `@personal-agent/cli` — `pa` wrapper command
- `@personal-agent/services` — managed daemon/web UI service utilities and deployment helpers

## Documentation

Start here:

- `docs/README.md` - agent/operator docs map
- `docs/getting-started.md` - first-run setup
- `docs/decision-guide.md` - which durable surface or feature to use
- `docs/how-it-works.md` - mental model and durable surfaces
- `docs/agent-tool-map.md` - product concepts mapped to live agent tools
- `docs/conversations.md` - conversation model, wakeups, and references
- `docs/automation.md` - automation surfaces and tradeoffs
- `docs/workspace.md` - repo-aware workspace browser and editor
- `docs/artifacts.md` - conversation artifacts and project artifacts
- `docs/web-ui.md` - web UI guide
- `docs/projects.md` - durable project tracking
- `docs/profiles-memory-skills.md` - profiles, AGENTS, notes, and skills
- `docs/scheduled-tasks.md` - scheduled tasks and daemon automation
- `docs/runs.md` - durable background runs
- `docs/troubleshooting.md` - common failures and fixes

## Installation (from source)

Prerequisites:

- Node.js 20+
- npm

Pi availability options:

1. **Repo-local Pi (recommended in this repo):** `npm install` in this repo installs `@mariozechner/pi-coding-agent` under `node_modules`, and `pa` will use it automatically.
2. **Global Pi fallback:** `npm install -g @mariozechner/pi-coding-agent` (optional).

```bash
# In this repo
npm install
npm run build
npm link --workspace @personal-agent/cli
```

Verify install:

```bash
pa --help
pa doctor
```

If you prefer not to link globally, run `pa` via npm exec:

```bash
npm exec pa -- --help
```

### First run

```bash
# Show CLI help
pa

# Set your profile (e.g., datadog or keep shared)
pa profile use datadog

# Verify setup
pa doctor

# Launch Pi TUI
pa tui
```

Extensions with npm dependencies are auto-installed on first use.

## CLI Examples

### Core commands

```bash
pa                          # Show help
pa tui                      # Launch Pi TUI with default profile
pa tui --profile datadog    # One-off profile override for this launch
pa tui -p "hello"           # Launch with initial prompt
pa tui -- --model kimi-coding/k2p5    # Pass args to pi
pa doctor                   # Validate setup
pa doctor --json            # Machine-readable status
pa restart                  # Restart daemon + managed web UI
pa update                   # Pull git changes + refresh repo dependencies + sync pi to latest + rebuild packages + restart services
pa update --repo-only       # Pull git changes + skip dependency refresh + rebuild packages + restart services
```

> `pa update` runs `npm install`, syncs `@mariozechner/pi-coding-agent@latest` in the repo root, verifies repo-local Pi, and runs `npm run build`.
> If the managed web UI service is installed, `pa update` also stages and health-checks the inactive blue/green web UI slot before swapping the service to it.

### Profile management

```bash
pa profile list             # List available profiles
pa profile use datadog      # Set default profile
pa profile show             # Show current profile details
pa profile show datadog     # Show specific profile
```

### Daemon management

```bash
pa daemon                   # Show daemon command help
pa daemon status            # Check daemon status
pa daemon status --json     # Machine-readable daemon status
pa daemon start             # Start background daemon
pa daemon stop              # Stop daemon
pa daemon restart           # Restart daemon only
pa daemon logs              # View daemon log path + PID
pa daemon service install   # Install daemon as managed user service
pa restart                  # Restart daemon + managed web UI
```

### Scheduled tasks

```bash
pa tasks list
pa tasks list --status active
pa tasks list --json --status completed
pa tasks show <id>
pa tasks validate --all
pa tasks validate ~/.local/state/personal-agent/sync/tasks/example.task.md
pa tasks logs <id> --tail 120
```

### Durable background runs

```bash
pa runs start code-review -- pa tui -p "review this diff"
pa runs list
pa runs show <id>
pa runs logs <id> --tail 120
pa runs cancel <id>
```

### Automatic git sync

```bash
pa sync status
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --fresh
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --bootstrap
pa sync run
```

## Daemon

`personal-agentd` runs background modules behind a local event bus:

- **maintenance** - Periodic cleanup and retention
- **tasks** - Scheduled `*.task.md` runs with retries and logs
- **sync** - Periodic git sync for durable cross-machine state

CLI surface:

- `pa daemon` (help), `pa daemon status|start|stop|restart|logs`
- `pa daemon service install|status|uninstall|help`
- `pa tasks list|show|validate|logs`
- `pa sync status|setup|run`
- `pa restart`
- `pa update`

When daemon is unavailable, clients warn and continue (non-fatal).

## Extensions

Pi extensions are auto-discovered from repo and local overlay layers:

- `extensions/*`
- `~/.local/state/personal-agent/config/local/extensions/*`

Extensions with `package.json` dependencies are auto-installed on first use.

Built-in extensions in this repo:

- `memory` - Active-profile node policy (AGENTS.md + skills) plus shared global note-node guidance
- `at-autocomplete-performance` - Faster `@` path completion in large repos
- `deferred-resume` - Resume this same TUI session later after a delay
- `web-tools` - Web search/integration
- `daemon-run-orchestration-prompt` - System-prompt policy for daemon-backed background orchestration and status reporting

See `docs/skills-and-capabilities.md` for a user-facing overview of skills and runtime capabilities.

## Runtime notes

Optional runtime env vars:

- `PERSONAL_AGENT_PI_TIMEOUT_MS` (default: `1800000` / 30 minutes, set `0` to disable timeout)

If you use `op://...` references for secrets, ensure 1Password CLI (`op`) is installed and authenticated (service-account flow: `OP_SERVICE_ACCOUNT_TOKEN`).

TUI theme mapping is configured in profile `settings.json`:

- `themeDark` (theme name for dark mode)
- `themeLight` (theme name for light mode)
- `themeMode` (`system` | `dark` | `light`, default `system`)

When both `themeDark` and `themeLight` are set, `pa` selects one on launch and writes it to runtime `settings.json` before starting Pi.

## Profiles

Profile resources resolve from:

- `defaults/agent` for repo-managed shared default profile files
- repo built-ins from `extensions/` and `themes/`
- synced durable roots under `~/.local/state/personal-agent/sync/{profiles,agents,settings,models,skills,notes,tasks,projects}`

Optional local overlay:

- `~/.local/state/personal-agent/config/local`

See docs:

- `docs/README.md` - agent/operator docs map
- `docs/getting-started.md` - first-run setup
- `docs/decision-guide.md` - which durable surface or feature to use
- `docs/how-it-works.md` - mental model and durable surfaces
- `docs/agent-tool-map.md` - product concepts mapped to live agent tools
- `docs/conversations.md` - conversation model, wakeups, and references
- `docs/automation.md` - automation surfaces and tradeoffs
- `docs/workspace.md` - repo-aware workspace browser and editor
- `docs/artifacts.md` - conversation artifacts and project artifacts
- `docs/web-ui.md` - web UI guide
- `docs/projects.md` - durable project tracking
- `docs/profiles-memory-skills.md` - profiles, AGENTS, notes, and skills
- `docs/skills-and-capabilities.md` - skills and runtime capabilities
- `docs/daemon.md` - daemon and background automation
- `docs/scheduled-tasks.md` - scheduled tasks
- `docs/runs.md` - durable background runs
- `docs/troubleshooting.md` - debugging and recovery
