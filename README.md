# personal-agent

A personal application layer over Pi that keeps:

- **profiles/resources in git** (`profiles/*`)
- **runtime state local** (`~/.local/state/personal-agent`)
- **cross-session memory** (summaries + structured cards for retrieval)
- **chat gateways** (Telegram + Discord)

## Features

- **Profile system** - Layered configs (shared → profile → local) with skills, extensions, themes
- **pa tui** - Launch Pi with profile resources and memory injection
- **Memory system** - Automatic session summarization + structured memory cards with runtime retrieval
- **Daemon** - Background processing for memory indexing and maintenance
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
pa tui                      # Launch Pi TUI with profile
pa tui -p "hello"           # Launch with initial prompt
pa tui -- --model kimi-coding/k2p5    # Pass args to pi
pa doctor                   # Validate setup
pa doctor --json            # Machine-readable status
```

### Profile management

```bash
pa profile list             # List available profiles
pa profile use datadog      # Set default profile
pa profile show             # Show current profile details
pa profile show datadog     # Show specific profile
```

### Memory commands

```bash
pa memory status            # Show memory system status
pa memory status --json     # Machine-readable status
pa memory head 5            # Show 5 latest summaries
pa memory cards head 5      # Show 5 latest memory cards
pa memory open <sessionId>  # Open summary by ID
pa memory open <id> --card  # Open card JSON by ID
pa memory query "auth flow" # Search summaries with qmd
pa memory search "pattern"  # Full-text search
```

### Daemon management

```bash
pa daemon start             # Start background daemon
pa daemon stop              # Stop daemon
pa daemon status            # Check daemon status
pa daemon restart           # Restart daemon
pa daemon logs              # View daemon logs
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

## Daemon

`personal-agentd` runs background modules behind a local event bus:

- **memory** - Session summarization, card generation, qmd indexing
- **maintenance** - Periodic cleanup and retention

CLI surface:

- `pa daemon start|stop|restart|status|logs`

When daemon is unavailable, clients warn and continue (non-fatal).

## Memory System

Two-layer memory for cross-session context:

1. **Summaries** (`~/.local/state/personal-agent/memory/conversations/`)  
   Human-readable markdown summaries of concluded sessions

2. **Memory Cards** (`~/.local/state/personal-agent/memory/cards/`)  
   Structured JSON with topics, decisions, invariants, pitfalls  
   Injected into Pi prompts via `memory-cards` extension

Retention: 90 days. Cards are globally retrieved and score-ranked at query time.

## Extensions

Pi extensions auto-discovered from profile layers:

- `profiles/shared/agent/extensions/*`  
- `profiles/<profile>/agent/extensions/*`
- `~/.config/personal-agent/local/extensions/*`

Extensions with `package.json` dependencies are auto-installed on first use.

Built-in extensions:
- `memory-cards` - Runtime memory injection
- `context-bar` - Session context display
- `web-tools` - Web search/integration
- `update` - Self-update commands
- `background-bash` - Background task execution

See `docs/extensions.md` for authoring guide.

## Messaging gateways

Shared optional env vars:

- `PERSONAL_AGENT_PROFILE` (default: `shared`)
- `PERSONAL_AGENT_PI_TIMEOUT_MS` (default: `180000`)
- `PERSONAL_AGENT_PI_MAX_OUTPUT_BYTES` (default: `200000`)

### Telegram

Required configuration (via setup or env vars):

- `TELEGRAM_BOT_TOKEN`
- `PERSONAL_AGENT_TELEGRAM_ALLOWLIST` (comma-separated chat IDs)

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

### Discord

Required configuration (via setup or env vars):

- `DISCORD_BOT_TOKEN`
- `PERSONAL_AGENT_DISCORD_ALLOWLIST` (comma-separated channel IDs)

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
- `/model` (picker + per-chat/per-channel model override; Telegram includes inline buttons)
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
- `docs/memory.md` - Memory module (summaries + cards)
- `docs/gateway.md` - Telegram/Discord gateway setup
- `docs/profile-schema.md` - Profile layer semantics
- `docs/extensions.md` - Extension authoring guide
