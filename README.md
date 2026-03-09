# personal-agent

A personal application layer over Pi that keeps:

- **profiles/resources in git** (`profiles/*`)
- **runtime state local** (`~/.local/state/personal-agent`)
- **chat gateways** (Telegram + Discord)

## Features

- **Profile system** - Layered configs (shared → profile → local) with skills, extensions, themes
- **`pa tui`** - Launch Pi with layered profile resources and memory policy injection
- **Daemon** - Background processing for maintenance + scheduled tasks
- **Gateways** - Telegram and Discord bot integration with per-chat sessions
- **Extensions** - Pi extensions auto-discovered from profiles with dependency auto-install

## Packages

- `@personal-agent/core` — runtime path/bootstrap + profile data merge engine
- `@personal-agent/resources` — profile discovery/materialization + Pi resource args
- `@personal-agent/daemon` — shared background daemon (`personal-agentd`) with event bus + modules
- `@personal-agent/cli` — `pa` wrapper command
- `@personal-agent/gateway` — Telegram + Discord gateways (registered as `pa gateway` command)

## Documentation

Start here:

- `docs/README.md` - full docs map
- `docs/cli.md` - CLI usage and command reference
- `docs/configuration.md` - config files, env vars, and precedence
- `docs/tasks.md` - scheduled task schema + behavior
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
pa restart                  # Restart daemon + managed gateways
pa update                   # Pull git changes + refresh repo dependencies + sync pi to latest + rebuild packages + restart services
pa update --repo-only       # Pull git changes + skip dependency refresh + rebuild packages + restart services
```

> `pa update` runs `npm install`, syncs `@mariozechner/pi-coding-agent@latest` in repo root + gateway workspace, verifies repo-local Pi, and runs `npm run build`.

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
pa restart                  # Restart daemon + managed gateways
```

### Scheduled tasks

```bash
pa tasks list
pa tasks list --status active
pa tasks list --json --status completed
pa tasks show <id>
pa tasks validate --all
pa tasks validate ~/.config/personal-agent/tasks/example.task.md
pa tasks logs <id> --tail 120
```

### Agent-managed tmux sessions

```bash
pa tmux list
pa tmux inspect <session>
pa tmux logs <session> --tail 120
pa tmux stop <session>
pa tmux clean --dry-run
pa tmux run code-review -- pa -p "review this diff"
```

### Gateway (Telegram/Discord)

```bash
# Setup and run Telegram gateway
pa gateway setup telegram
pa gateway telegram start
pa gateway service install telegram

# Setup and run Discord gateway
pa gateway setup discord
pa gateway discord start
pa gateway service install discord

# Service management
pa gateway service status telegram
pa gateway service uninstall telegram
```

`pa gateway service install ...` also provisions `personal-agentd` as a managed user service so gateway background events stay enabled.

## Daemon

`personal-agentd` runs background modules behind a local event bus:

- **maintenance** - Periodic cleanup and retention
- **tasks** - Scheduled `*.task.md` execution with retries, logs, and gateway output routing

CLI surface:

- `pa daemon` (help), `pa daemon status|start|stop|restart|logs`
- `pa daemon service install|status|uninstall|help`
- `pa tasks list|show|validate|logs`
- `pa restart`
- `pa update`

When daemon is unavailable, clients warn and continue (non-fatal).

## Extensions

Pi extensions are auto-discovered from profile layers:

- `profiles/shared/agent/extensions/*`
- `profiles/<profile>/agent/extensions/*`
- `~/.config/personal-agent/local/extensions/*`

Extensions with `package.json` dependencies are auto-installed on first use.

Built-in extensions in this repo:

- `memory` - Active-profile memory policy (AGENTS.md + skills)
- `context-bar` - Session context display
- `pa-header` - Startup header/profile provenance
- `at-autocomplete-performance` - Faster `@` path completion in large repos
- `deferred-resume` - Resume this same TUI session later after a delay
- `web-tools` - Web search/integration
- `tmux-manager` - `/tmux` command + footer status for agent-managed tmux sessions only
- `tmux-orchestration-prompt` - System-prompt policy for tmux-based background orchestration and status reporting

See `docs/extensions.md` for authoring guide.

## Messaging gateways

Gateway sessions automatically append a gateway-specific runtime block to the system prompt so the agent is aware of chat-gateway constraints, commands, provider capabilities, and concise chat-style response rules.

Shared optional env vars:

- `PERSONAL_AGENT_PROFILE` (default: `shared`)
- `PERSONAL_AGENT_PI_TIMEOUT_MS` (default: `1800000` / 30 minutes, set `0` to disable timeout)

If you use `op://...` references for secrets, ensure 1Password CLI (`op`) is installed and authenticated (service-account flow: `OP_SERVICE_ACCOUNT_TOKEN`).

TUI theme mapping is configured in profile `settings.json`:

- `themeDark` (theme name for dark mode)
- `themeLight` (theme name for light mode)
- `themeMode` (`system` | `dark` | `light`, default `system`)

When both `themeDark` and `themeLight` are set, `pa` selects one on launch and writes it to runtime `settings.json` before starting Pi.

### Telegram

Required configuration (via setup or env vars):

- `TELEGRAM_BOT_TOKEN`
- `PERSONAL_AGENT_TELEGRAM_ALLOWLIST` (comma-separated chat IDs)

`TELEGRAM_BOT_TOKEN` and allowlist values may be plain strings or `op://...` 1Password references.

Optional:

- `PERSONAL_AGENT_TELEGRAM_CWD` (working directory for Pi calls)
- `PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT` (default: `20`)
- `PERSONAL_AGENT_TELEGRAM_RETRY_ATTEMPTS` (default: `3`)
- `PERSONAL_AGENT_TELEGRAM_RETRY_BASE_DELAY_MS` (default: `300`)
- `PERSONAL_AGENT_TELEGRAM_CLEAR_RECENT_MESSAGES_ON_NEW` (default: `true`)

Telegram gateway supports:

- inbound text + document + photo + voice-note messages
- rich formatted output (HTML rendering for code blocks/headings/links)
- live streaming via message edits
- long-output `.txt` file fallback
- inline action buttons (Stop, New, Regenerate, Follow up)

Run bridge:

```bash
pa gateway telegram setup
pa gateway telegram start
# or run as background service (recommended for long-running use)
pa gateway service install telegram
```

Foreground gateway starts (`pa gateway ... start`) auto-start `personal-agentd` if needed.

### Discord

Required configuration (via setup or env vars):

- `DISCORD_BOT_TOKEN`
- `PERSONAL_AGENT_DISCORD_ALLOWLIST` (comma-separated channel IDs)

`DISCORD_BOT_TOKEN` and allowlist values may be plain strings or `op://...` 1Password references.

Optional:

- `PERSONAL_AGENT_DISCORD_CWD` (working directory for Pi calls)
- `PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL` (default: `20`)

Run bridge:

```bash
pa gateway discord setup
pa gateway discord start
# or run as background service (recommended for long-running use)
pa gateway service install discord
```

Gateway slash commands include:

- `/status`, `/new` (resets session; on Telegram, optionally best-effort clears recent tracked messages), `/commands`
- `/skills` (compatibility alias; Telegram menu hides it), `/skill <name>` (and `/skill:<name>`)
- Telegram slash menu auto-registers `/skill_*` shortcuts for discovered profile skills (mapped to `/skill:<skill-name>`)
- `/tasks [status]`
- `/model` / `/models`
- `/stop`, `/followup <text>`, `/cancel`
- `/compact` (guidance only in gateway mode)
- `/resume` (auto-resume behavior info)

## Profiles

Profiles live in:

- `profiles/shared/agent`
- `profiles/datadog/agent`

Optional local overlay:

- `~/.config/personal-agent/local`

See docs:

- `docs/README.md` - docs map
- `docs/cli.md` - CLI usage and command reference
- `docs/configuration.md` - config files, env vars, precedence
- `docs/profile-schema.md` - profile layer semantics
- `docs/extensions.md` - extension authoring guide
- `docs/daemon-architecture.md` - daemon design and event system
- `docs/tasks.md` - scheduled task schema + runtime behavior
- `docs/gateway.md` - Telegram/Discord gateway setup
- `docs/troubleshooting.md` - debugging and incident playbooks
