# personal-agent

A personal application layer over Pi that keeps:

- **profiles/resources in git** (`profiles/*`)
- **runtime state local** (`~/.local/state/personal-agent`)

## Packages

- `@personal-agent/core` — runtime path/bootstrap + profile data merge engine
- `@personal-agent/resources` — profile discovery/materialization + Pi resource args
- `@personal-agent/cli` — `personal-agent` wrapper command
- `@personal-agent/bridge-telegram` — Telegram daemon (`personal-agent-telegram`)

## Quickstart

```bash
npm install
npm run lint
npm run build
npm run test
```

Run Pi through personal-agent:

```bash
# default profile (shared)
node packages/cli/dist/index.js run

# choose profile explicitly
node packages/cli/dist/index.js run --profile datadog
```

After packaging/installing CLI binary:

```bash
personal-agent run
personal-agent profile list
personal-agent profile use datadog
personal-agent doctor
```

## Telegram bridge

Required env vars:

- `TELEGRAM_BOT_TOKEN`
- `PERSONAL_AGENT_TELEGRAM_ALLOWLIST` (comma-separated chat IDs)

Optional:

- `PERSONAL_AGENT_PROFILE` (default: `shared`)
- `PERSONAL_AGENT_TELEGRAM_CWD` (working directory for Pi calls)

Run bridge:

```bash
personal-agent-telegram
```

Telegram commands:

- `/status`
- `/new`

## Profiles

Profiles live in:

- `profiles/shared/agent`
- `profiles/datadog/agent`

Optional local overlay:

- `~/.config/personal-agent/local`

See docs:

- `docs/architecture.md`
- `docs/profile-schema.md`
- `docs/migration-strategy.md`
