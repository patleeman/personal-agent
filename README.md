# personal-agent

A personal application layer over Pi that keeps:

- **profiles/resources in git** (`profiles/*`)
- **runtime state local** (`~/.local/state/personal-agent`)

## Packages

- `@personal-agent/core` — runtime path/bootstrap + profile data merge engine
- `@personal-agent/resources` — profile discovery/materialization + Pi resource args
- `@personal-agent/daemon` — shared background daemon (`personal-agentd`) with event bus + modules
- `@personal-agent/cli` — `pa` wrapper command
- `@personal-agent/gateway` — Telegram + Discord gateways (registered as `pa gateway` command)

## Quickstart

```bash
npm install
npm run lint
npm run build
npm run test
```

Run Pi through `pa`:

```bash
# show CLI help
pa

# start Pi TUI with configured/default profile
pa run

# configure profile (infrequent)
pa profile use datadog
```

If a profile contains extension packages with dependencies, `pa` installs missing extension dependencies automatically at runtime.

After packaging/installing CLI binary:

```bash
pa
pa run -p "hello"
pa profile list
pa profile use datadog
pa doctor
pa gateway setup telegram
pa gateway telegram start
pa gateway setup discord
pa gateway discord start
pa daemon start
pa daemon status
```

## Daemon

`personal-agentd` runs background modules (memory, maintenance) behind a local event bus.

CLI surface:

- `pa daemon start`
- `pa daemon stop`
- `pa daemon status`
- `pa daemon restart`
- `pa daemon logs`

When daemon is unavailable, clients warn and continue (non-fatal).

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
```

Gateway commands:

- `/status`
- `/new`

## Profiles

Profiles live in:

- `profiles/shared/agent`
- `profiles/datadog/agent`

Optional local overlay:

- `~/.config/personal-agent/local`

See docs:

- `docs/cli.md`
- `docs/gateway.md`
- `docs/architecture.md`
- `docs/daemon-architecture.md`
- `docs/memory.md`
- `docs/profile-schema.md`
- `docs/migration-strategy.md`
