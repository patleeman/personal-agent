# personal-agent

`personal-agent` is a durable application layer over Pi.

It keeps repo-managed defaults in git, portable knowledge in an external vault, and machine-local runtime state under `~/.local/state/personal-agent`. The result is one system that can be used from the CLI, the web UI, or the Electron desktop shell without turning conversations into your long-term storage layer.

## Current feature set

- `pa` CLI for launching Pi and managing local services
- external durable vault at `~/Documents/personal-agent` for markdown docs/packages plus shared skills
- local instruction-file selection through machine config / Settings instead of a vault profile hierarchy
- daemon-backed runs, scheduled tasks, deferred resumes, reminders, and wakeups
- web UI for conversations, automations, checkpoint review, tools, and settings
- optional remote browser access over Tailscale Serve when the web UI is exposed on the tailnet
- Electron desktop shell that owns a local backend and can connect to saved web or SSH hosts
- MCP inspection/calls plus package-source installs for extending Pi, including skill-bundled `mcp.json` manifests

## Packages

- `@personal-agent/core` — path resolution, durable state helpers, knowledge/project utilities, MCP helpers
- `@personal-agent/resources` — resource resolution, layered materialization, Pi resource args
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
- `docs/knowledge-system.md` — KB model
- `docs/conversation-context.md` — target model for attached conversation docs
- `docs/web-ui.md` — desktop web UI, remote browser pairing, and live updates
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
pa status
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
pa ui
pa daemon status
pa mcp list --probe
```

A few higher-signal flows:

```bash
pa ui pairing-code
pa install https://github.com/user/pi-extension
pa mcp list --probe
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

Portable knowledge defaults to the external vault:

- `~/Documents/personal-agent/**/*.md`
- `~/Documents/personal-agent/**/INDEX.md`
- `~/Documents/personal-agent/skills/<skill>/SKILL.md`

Machine-local runtime state defaults to:

- `~/.local/state/personal-agent/config/config.json`
- `~/.local/state/personal-agent/daemon/**`
- `~/.local/state/personal-agent/web/**`
- `~/.local/state/personal-agent/desktop/**`
- `~/.local/state/personal-agent/sync/{_tasks|tasks}/**`

## Repo extensions

The repo currently ships these built-in Pi extensions:

- `note-policy` — injects selected instruction files, vault context, and available docs/skills/internal skills into the runtime prompt
- `web-tools` — `web_search` and `web_fetch`
- `daemon-run-orchestration-prompt` — extra system-prompt guidance for durable background orchestration
- `openai-native-compaction` — uses Codex/OpenAI compaction replay for direct Responses API sessions while preserving Pi's normal portable text summary

## Release flow

Desktop releases are tag-driven:

```bash
npm run release:patch   # or release:minor / release:major
git push --follow-tags
```

That pushes a `v*` tag, triggers `.github/workflows/release.yml`, builds the macOS desktop app, and publishes `.dmg` and `.zip` artifacts to GitHub Releases.
