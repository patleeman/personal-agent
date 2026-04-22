# Getting Started

This guide gets `personal-agent` into a usable state quickly.

## What you are setting up

`personal-agent` adds a durable layer around Pi:

- repo-managed defaults live in git
- portable knowledge lives in an external vault of docs and skills
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

## Understand the default paths

Portable knowledge defaults to the external vault:

```text
~/Documents/personal-agent/
├── skills/
├── instructions/
├── work/
└── references/
```

Only `skills/` is a shared folder contract.

Everything else can stay freeform.

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

If you prefer a managed git-backed KB instead of pointing at an existing local folder, set `knowledgeBaseRepoUrl` in Settings. PA will clone and sync it under `~/.local/state/personal-agent/knowledge-base/repo` and use that mirror as the indexed root.

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
npm run desktop:start -- --no-quit-confirmation
```

The desktop shell owns its own local backend while it is running. If a separate daemon is already healthy on the same machine, the desktop shell reuses it instead of failing startup. A separately managed web UI still is not reused.

## Create your first instruction file

Create a markdown doc anywhere in the vault, for example:

```text
~/Documents/personal-agent/instructions/base.md
```

Then select it through Settings or add it to `~/.local/state/personal-agent/config/config.json` under `instructionFiles`.

`AGENTS.md` is still a fine convention if you want one, but it is not the only valid instruction-file shape.

## Create durable knowledge

Use the vault directly:

- doc: `~/Documents/personal-agent/systems/runtime-model.md`
- doc package: `~/Documents/personal-agent/systems/runtime-model/INDEX.md`
- skill: `~/Documents/personal-agent/skills/agent-browser/SKILL.md`

Use [Knowledge Management System](./knowledge-system.md) and [Instruction Files, Docs, and Skills](./instructions-docs-skills.md) for the model behind those files.

## Use docs in conversations

Today you can already `@`-tag files and docs in the composer.

The next step is persistent attached docs that stay linked to a conversation across turns.

See [Conversation Context Attachments](./conversation-context.md) for the target behavior.

## Validate scheduled tasks

If you already have legacy task files, validate them through the built-in `scheduled_task` tool.

Example task files live under `docs/examples/` and runtime task files live under `~/.local/state/personal-agent/sync/{_tasks|tasks}/`.

## Good next docs

1. [Decision Guide](./decision-guide.md)
2. [How personal-agent works](./how-it-works.md)
3. [Web UI Guide](./web-ui.md)
4. [Instruction Files, Docs, and Skills](./instructions-docs-skills.md)
5. [Conversation Context Attachments](./conversation-context.md)
