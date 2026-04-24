# personal-agent

`personal-agent` is a durable runtime around Pi for running a personal agent with real state.

It separates three things cleanly:

- **repo-managed defaults** live in git
- **durable knowledge** lives in a vault
- **machine-local runtime state** lives under `~/.local/state/personal-agent`

Conversations are for live execution. Reusable knowledge, workflows, reminders, runs, and automations should live in explicit durable surfaces instead of getting buried in chat history.

## What this repo contains

`personal-agent` currently ships:

- a **CLI** (`pa`) for launching Pi and managing the local runtime
- a **desktop app** for conversations, knowledge, automations, and settings
- a **daemon** for runs, scheduled tasks, wakeups, and reminders
- a **knowledge system** built around docs, instruction files, skills, and projects
- **MCP integration** for external tool servers
- built-in **extensions**, **internal skills**, and a **prompt catalog**
- an **iOS companion app** under `apps/ios/`

## Quick start

### Prerequisites

- Node.js **20+**
- npm **11+** recommended

### Install from source

```bash
npm install
npm run build
npm link --workspace @personal-agent/cli
```

If you do not want a global `pa` symlink:

```bash
node packages/cli/dist/index.js --help
```

### Verify the install

```bash
pa doctor
pa status
```

### Start an interface

```bash
pa tui
npm run desktop:start
```

Electron serves the renderer through `personal-agent://app/`; there is no standalone browser UI service.

## Core mental model

There are three important roots:

- **`<repo-root>`** — shipped defaults and code in this repo
- **`<vault-root>`** — durable knowledge: docs, skills, projects, instruction files
- **`<state-root>`** — machine-local runtime state, usually `~/.local/state/personal-agent`

The durable rule is simple:

- use a **conversation** when work is happening now
- use the **vault** when knowledge should outlive the thread
- use daemon-backed surfaces for **runs**, **automations**, **queues**, and **reminders**

If something should still matter next week, do not leave the only copy in a conversation.

## Common commands

```bash
# health / setup
pa doctor
pa status
pa profile list

# interfaces
pa tui
npm run desktop:start

# background runtime
pa daemon status
pa daemon logs

# MCP
pa mcp list --probe
pa mcp info <server>/<tool>
```

Use `pa help <command>` for exact flags.

## Repo layout

### Workspace packages

- `packages/core` — path resolution, durable state helpers, knowledge/project utilities, MCP helpers, resource loading
- `packages/daemon` — runs, automations, wakeups, daemon runtime
- `packages/cli` — `pa`
- `packages/web` — React renderer and local API modules used by Electron
- `packages/desktop` — Electron app shell

### Shipped runtime resources

- `defaults/agent/` — repo-managed Pi defaults
- `extensions/` — built-in runtime extensions
- `internal-skills/` — built-in feature behavior docs
- `prompt-catalog/` — prompt text owned by this repo
- `docs/` — product semantics and current behavior
- `apps/ios/` — iOS companion app

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

Useful dev entry points:

```bash
npm run desktop:start
npm run ab:run -- --session smoke-check --command "ab open personal-agent://app/ && ab wait 1000 && ab snapshot -i"
```

Notes:

- Use the repo `agent-browser` wrapper via `npm run ab:run` instead of raw `agent-browser`.
- If you change product behavior, update the relevant docs in `docs/` or `internal-skills/`.
- Exact tool arguments come from runtime tool schemas, not from README prose.

## Release flow

Desktop releases are built, signed, notarized, and published locally.

```bash
npm run release:desktop:patch
npm run release:desktop:minor
npm run release:desktop:major
```

If the version bump already happened and you just need to retry publish:

```bash
npm run release:publish
```

See [`docs/release-cycle.md`](docs/release-cycle.md) for the real details.

## Documentation map

The docs in this repo are written for agents first, humans second.

Start here:

- [`docs/README.md`](docs/README.md) — docs map and path vocabulary
- [`docs/getting-started.md`](docs/getting-started.md) — install and first-run flow
- [`docs/decision-guide.md`](docs/decision-guide.md) — pick the right durable surface
- [`docs/how-it-works.md`](docs/how-it-works.md) — state model and runtime layering
- [`docs/knowledge-system.md`](docs/knowledge-system.md) — docs, instruction files, skills, and projects
- [`docs/conversations.md`](docs/conversations.md) — conversation model, auto mode, async follow-through
- [`docs/desktop-app.md`](docs/desktop-app.md) — desktop app runtime and UI surface
- [`docs/command-line.md`](docs/command-line.md) — `pa` command map
- [`docs/repo-layout.md`](docs/repo-layout.md) — where code should live
- [`internal-skills/README.md`](internal-skills/README.md) — built-in runtime feature docs

For built-in feature behavior, read the matching internal skill:

- [`internal-skills/runs/INDEX.md`](internal-skills/runs/INDEX.md)
- [`internal-skills/scheduled-tasks/INDEX.md`](internal-skills/scheduled-tasks/INDEX.md)
- [`internal-skills/async-attention/INDEX.md`](internal-skills/async-attention/INDEX.md)
- [`internal-skills/artifacts/INDEX.md`](internal-skills/artifacts/INDEX.md)
- [`internal-skills/alerts/INDEX.md`](internal-skills/alerts/INDEX.md)
- [`internal-skills/skills-and-capabilities/INDEX.md`](internal-skills/skills-and-capabilities/INDEX.md)
