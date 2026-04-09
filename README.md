# personal-agent

`personal-agent` is a durable application layer over Pi.

It keeps repo-managed defaults in git, durable knowledge in an external vault, and machine-local runtime state under `~/.local/state/personal-agent`. The result is one system that can be used from the CLI, the web UI, or the Electron desktop shell without turning conversations into your long-term storage layer.

## Current feature set

- profile-aware `pa` CLI for launching Pi and managing local services
- external durable vault at `~/Documents/personal-agent` for `_profiles`, `_skills`, `notes`, and `projects`
- daemon-backed runs, scheduled tasks, deferred resumes, reminders, inbox delivery, and wakeups
- web UI for conversations, notifications, automations, tools, instructions, and settings
- paired companion/mobile surface under `/app` when the web UI is exposed through Tailscale Serve
- Electron desktop shell that owns a local backend and can connect to saved web or SSH hosts
- MCP inspection/calls plus package-source installs for extending Pi

## Packages

- `@personal-agent/core` — path resolution, durable state helpers, knowledge/project utilities, MCP helpers
- `@personal-agent/resources` — profile resolution, layered resource materialization, Pi resource args
- `@personal-agent/cli` — `pa` command
- `@personal-agent/daemon` — background daemon, scheduled tasks, durable runs, deferred resumes
- `@personal-agent/services` — launchd/systemd helpers for daemon and web UI
- `@personal-agent/web` — web UI client and server
- `@personal-agent/desktop` — Electron desktop shell

## Documentation

Start with:

- `docs/README.md` — docs map
- `docs/getting-started.md` — install and first-run flow
- `docs/decision-guide.md` — which surface to use
- `docs/how-it-works.md` — durable-state mental model
- `docs/web-ui.md` — desktop web UI, companion, pairing, and live updates
- `docs/electron-desktop-app-plan.md` — current desktop-shell overview
- `docs/command-line.md` — `pa` command guide

Built-in runtime feature guides live under `internal-skills/`:

- `internal-skills/runs/INDEX.md`
- `internal-skills/scheduled-tasks/INDEX.md`
- `internal-skills/async-attention/INDEX.md`
- `internal-skills/artifacts/INDEX.md`
- `internal-skills/inbox/INDEX.md`
- `internal-skills/alerts/INDEX.md`

## Install from source

Prerequisites:

- Node.js 20+
- npm

From the repo root:

```bash
npm install
npm run build
npm link --workspace @personal-agent/cli
```

If you do not want to link the CLI globally:

```bash
npm exec pa -- --help
```

## First run

```bash
pa doctor
pa profile list
pa profile use shared
pa tui
```

Other useful entry points:

```bash
pa ui foreground --open      # desktop web UI
pa ui install                # managed web UI service
npm run desktop:start        # Electron desktop shell
```

## Common commands

```bash
pa status
pa doctor
pa profile show
pa ui
pa daemon status
pa inbox list
pa tasks list
pa runs list
pa mcp list --probe
```

A few higher-signal flows:

```bash
pa ui pairing-code
pa runs start-agent docs-refresh --prompt "refresh the docs"
pa install --profile shared https://github.com/user/pi-extension
pa restart
pa update --repo-only
```

## State layout

Shared defaults stay in the repo:

- `defaults/agent`
- `extensions/`
- `internal-skills/`
- `prompt-catalog/`
- `themes/`

Durable portable knowledge defaults to the external vault:

- `~/Documents/personal-agent/_profiles/<profile>/AGENTS.md`
- `~/Documents/personal-agent/_profiles/<profile>/{settings.json,models.json}`
- `~/Documents/personal-agent/{_skills,notes,projects}/**`

Machine-local runtime state defaults to:

- `~/.local/state/personal-agent/config/config.json`
- `~/.local/state/personal-agent/daemon/**`
- `~/.local/state/personal-agent/web/**`
- `~/.local/state/personal-agent/desktop/**`
- `~/.local/state/personal-agent/sync/{_tasks|tasks}/**`

## Repo extensions

The repo currently ships these built-in Pi extensions:

- `note-policy` — injects profile/vault context and available notes/skills/internal skills into the runtime prompt
- `web-tools` — `web_search` and `web_fetch`
- `daemon-run-orchestration-prompt` — extra system-prompt guidance for durable background orchestration

## Release flow

Desktop releases are tag-driven:

```bash
npm run release:patch   # or release:minor / release:major
git push --follow-tags
```

That pushes a `v*` tag, triggers `.github/workflows/release.yml`, builds the macOS desktop app, and publishes `.dmg` and `.zip` artifacts to GitHub Releases.
