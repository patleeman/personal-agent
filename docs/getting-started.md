# Getting Started

This guide gets `personal-agent` into a usable state quickly.

## What you are setting up

`personal-agent` adds a durable layer around Pi:

- repo-managed defaults live in git
- durable knowledge lives in an external vault
- machine-local runtime state stays under `~/.local/state/personal-agent`
- the CLI, web UI, daemon, and desktop shell all sit on top of the same state model

## Prerequisites

- Node.js 20+
- npm
- a checkout of this repository

## Install from source

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

## Verify the setup

Run:

```bash
pa doctor
pa status
```

`pa doctor` should confirm that Pi, the runtime paths, and built artifacts are available.

## Choose a profile

List the available profiles:

```bash
pa profile list
```

Switch the default profile if needed:

```bash
pa profile use shared
```

The selected default profile is stored in `~/.local/state/personal-agent/config/config.json`.

## Understand the default paths

Durable knowledge defaults to the external vault:

```text
~/Documents/personal-agent/
├── _profiles/
├── _skills/
├── notes/
└── projects/
```

Machine-local runtime state defaults to:

```text
~/.local/state/personal-agent/
├── config/
├── daemon/
├── desktop/
├── web/
└── sync/
```

Scheduled task files stay under the machine-local `sync/` subtree, not in the shared vault.

## Start an interface

### TUI

```bash
pa tui
```

### Web UI

```bash
pa ui foreground --open
```

For day-to-day use as a managed service:

```bash
pa ui install
```

### Electron desktop shell

```bash
npm run desktop:start
```

The desktop shell owns its own local backend while it is running. If a daemon or web UI is already running separately on the same machine, stop those first.

## Create your first durable instructions

Edit `~/Documents/personal-agent/_profiles/<profile>/AGENTS.md` directly.

Use `AGENTS.md` for durable behavior and preferences, not for project notes. The web UI no longer has a dedicated Instructions editor.

## Create durable knowledge

Use the vault directly for now:

- note page: `~/Documents/personal-agent/notes/<id>.md`
- note package: `~/Documents/personal-agent/notes/<id>/INDEX.md`
- skill: `~/Documents/personal-agent/_skills/<skill>/SKILL.md`
- tracked page: `~/Documents/personal-agent/projects/<projectId>/project.md`

Use [Knowledge Management System](./knowledge-system.md) and [Pages](./pages.md) for the model behind those files.

## Validate scheduled tasks

If you already have legacy task files, validate them through the built-in `scheduled_task` tool.

Example task files live under `docs/examples/` and runtime task files live under `~/.local/state/personal-agent/sync/{_tasks|tasks}/`.

## Good next docs

1. [Decision Guide](./decision-guide.md)
2. [How personal-agent works](./how-it-works.md)
3. [Web UI Guide](./web-ui.md)
4. [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
5. [Tracked Pages](./projects.md)
