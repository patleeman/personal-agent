# personal-agent

A personal application layer over Pi that keeps:

- **profiles/resources in git** (`profiles/*`)
- **runtime state local** (`~/.local/state/personal-agent`)
- **chat gateways** (Telegram + Discord)

## Features

- **Profile system** - Layered configs (shared → profile → local) with skills, extensions, themes
- **pa tui** - Launch Pi with layered profile resources and memory policy injection
- **Daemon** - Background processing for scheduled tasks and maintenance
- **Gateways** - Telegram and Discord bot integration with per-chat sessions
- **Extensions** - Pi extensions auto-discovered from profiles with dependency auto-install

## Packages

- `@personal-agent/core` — runtime path/bootstrap + profile data merge engine
- `@personal-agent/resources` — profile discovery/materialization + Pi resource args
- `@personal-agent/daemon` — shared background daemon (`personal-agentd`) with event bus + modules
- `@personal-agent/cli` — `pa` wrapper command
- `@personal-agent/gateway` — Telegram + Discord gateways (registered as `pa gateway` command)

## Installation (from source)

Prerequisites:

- Node.js 20+
- npm
- Pi CLI (`pi` command)

```bash
# Required once (pa wraps the pi CLI)
npm install -g @mariozechner/pi-coding-agent

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
pa update                   # Update pi package + pull git changes, then restart services
pa update --repo-only       # Pull git changes only, then restart services
```

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
pa daemon start             # Start background daemon
pa daemon stop              # Stop daemon
pa daemon restart           # Restart daemon only
pa daemon logs              # View daemon logs
pa daemon service install   # Install daemon as managed user service
pa restart                  # Restart daemon + managed gateways
pa update                   # Update pi package + pull latest git changes and restart
pa update --repo-only       # Pull latest git changes only and restart
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

CLI surface:

- `pa daemon` (help), `pa daemon status|start|stop|restart|logs`
- `pa daemon service install|status|uninstall|help`
- `pa restart`
- `pa update`

When daemon is unavailable, clients warn and continue (non-fatal).

## Extensions

Pi extensions auto-discovered from profile layers:

- `profiles/shared/agent/extensions/*`  
- `profiles/<profile>/agent/extensions/*`
- `~/.config/personal-agent/local/extensions/*`

Extensions with `package.json` dependencies are auto-installed on first use.

Built-in extensions:
- `memory` - Active-profile memory policy (AGENTS.md + skills)
- `context-bar` - Session context display
- `web-tools` - Web search/integration
- `update` - Self-update commands
- `background-bash` - Background task execution

See `docs/extensions.md` for authoring guide.

## Messaging gateways

Shared optional env vars:

- `PERSONAL_AGENT_PROFILE` (default: `shared`)
- `PERSONAL_AGENT_PI_TIMEOUT_MS` (default: `180000`)

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

Gateway commands:

- `/status`
- `/new`
- `/commands`
- `/skills`
- `/skill <name>`
- `/model` or `/models` (picker + per-chat/per-channel model override; Telegram includes inline buttons)
- `/stop` (stop active request)
- `/cancel` (cancel active model selection)
- `/compact` (guidance only in gateway mode; use Pi TUI for manual compaction)
- `/resume` (gateway auto-resumes per chat/channel)

## Profiles

Profiles live in:

- `profiles/shared/agent`
- `profiles/datadog/agent`

Optional local overlay:

- `~/.config/personal-agent/local`

See docs:

- `docs/cli.md` - CLI usage and command reference
- `docs/architecture.md` - Package architecture and data flow
- `docs/daemon-architecture.md` - Daemon design and event system
- `docs/gateway.md` - Telegram/Discord gateway setup
- `docs/profile-schema.md` - Profile layer semantics
- `docs/extensions.md` - Extension authoring guide
