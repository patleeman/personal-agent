# personal-agent

`personal-agent` is a durable application layer on top of Pi.

It keeps repo-managed runtime defaults in git, durable knowledge in a vault, and machine-local runtime state under `~/.local/state/personal-agent`. Conversations are where execution happens. Durable knowledge, workflows, and automation state should live somewhere more precise.

The docs in this repo are written for agents first, humans second. Start with [`docs/README.md`](docs/README.md). Use runtime tool schemas for exact arguments. Use [`internal-skills/`](internal-skills/) for built-in behavior such as runs, scheduled tasks, artifacts, reminders, and async attention.

## Quick start

```bash
npm install
npm run build
npm link --workspace @personal-agent/cli

pa doctor
pa status
pa tui
```

Useful entry points:

```bash
pa ui foreground --open
pa ui install
npm run desktop:start
```

## Mental model

- repo files define shipped defaults: `defaults/agent/`, `extensions/`, `internal-skills/`, `prompt-catalog/`
- the effective durable knowledge root is the **vault**
- machine-local runtime state lives under `~/.local/state/personal-agent`
- conversations are for active execution, not long-term storage
- choose the smallest correct durable surface: doc, skill, project, queue item, reminder, run, or automation

## Main interfaces

- `pa tui` — launch Pi with the resolved local runtime
- `pa ui` — inspect or manage the local web UI
- `npm run desktop:start` — start the Electron desktop shell
- `pa daemon ...` — manage daemon-backed background behavior
- `pa mcp ...` — inspect and call configured MCP servers

## Docs

Start here:

- [`docs/README.md`](docs/README.md) — docs map and path vocabulary
- [`docs/getting-started.md`](docs/getting-started.md) — install and first-run flow
- [`docs/decision-guide.md`](docs/decision-guide.md) — which durable surface to use
- [`docs/how-it-works.md`](docs/how-it-works.md) — state model and runtime layering
- [`docs/knowledge-system.md`](docs/knowledge-system.md) — instruction files, docs, skills, and projects
- [`docs/conversations.md`](docs/conversations.md) — live thread model
- [`docs/web-ui.md`](docs/web-ui.md) — current UI surfaces and live-update model
- [`docs/command-line.md`](docs/command-line.md) — `pa` command map
- [`docs/repo-layout.md`](docs/repo-layout.md) — where code should live

Built-in feature docs live under `internal-skills/`:

- [`internal-skills/runs/INDEX.md`](internal-skills/runs/INDEX.md)
- [`internal-skills/scheduled-tasks/INDEX.md`](internal-skills/scheduled-tasks/INDEX.md)
- [`internal-skills/async-attention/INDEX.md`](internal-skills/async-attention/INDEX.md)
- [`internal-skills/artifacts/INDEX.md`](internal-skills/artifacts/INDEX.md)
- [`internal-skills/alerts/INDEX.md`](internal-skills/alerts/INDEX.md)
- [`internal-skills/inbox/INDEX.md`](internal-skills/inbox/INDEX.md)

## Packages

- `@personal-agent/core` — path resolution, durable state helpers, knowledge/project utilities, MCP helpers, resource loading
- `@personal-agent/cli` — the `pa` command
- `@personal-agent/daemon` — durable runs, automations, wakeups, companion plumbing, service helpers
- `@personal-agent/web` — browser UI and server routes
- `@personal-agent/desktop` — Electron shell

## Repo runtime resources

- `defaults/agent/` — shipped Pi defaults
- `extensions/` — built-in runtime extensions
- `internal-skills/` — built-in feature behavior docs
- `prompt-catalog/` — reusable prompt material
- `docs/` — product docs for agents

## Release flow

Desktop releases are built, signed, notarized, and published locally.

See [`docs/release-cycle.md`](docs/release-cycle.md) for the exact flow.
