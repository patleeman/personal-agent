# personal-agent

`personal-agent` is an **Electron desktop app** for running a personal AI agent with durable state, conversations, knowledge management, and automations. It also ships an **iOS companion app** for phone access.

Core design: separate shipped code from durable knowledge from machine-local state cleanly.

- **repo-managed defaults** live in git
- **durable knowledge** lives in a vault
- **machine-local runtime state** lives under `~/.local/state/personal-agent`

Conversations are for live execution. Reusable knowledge, workflows, reminders, runs, and automations live in explicit durable surfaces instead of getting buried in chat history.

## What this repo contains

`personal-agent` ships:

- an **Electron desktop app** — the primary operator UI for conversations, knowledge, automations, and settings
- an **iOS companion app** — native phone client for host APIs (chat, knowledge, automations, and more)
- a **CLI** (`pa`) — launching the agent, managing the daemon, inspecting MCP, health checks
- a **daemon** — runs, scheduled tasks, wakeups, reminders, companion pairing
- a **knowledge system** — docs, instruction files, skills, and projects
- **MCP integration** — external tool server support
- built-in **extensions**, **internal skills**, and a **prompt catalog**

## Quick start

### Prerequisites

- **macOS** (the desktop app targets macOS arm64; no Windows or Linux build currently)
- Node.js **20+**
- npm **11+** recommended
- Xcode (only needed for iOS companion development in the simulator)
- macOS (the desktop app is macOS-only; the iOS companion requires Xcode for simulator builds)

### Install from source

```bash
npm install
npm run build
npm run build
```

### Verify the install

The desktop app manages the local daemon runtime automatically. Start the Personal Agent desktop app from the build output or from the installed `.app` bundle.

### Start the desktop app

```bash
npm run desktop:start
```

This builds the Electron shell and opens the app. Electron serves the renderer through `personal-agent://app/`; there is no general-purpose local web UI server to open in a browser.

### Start the TUI (terminal)

```bash
pa tui
```

The TUI is useful for quick terminal-based sessions. For the full experience, use the desktop app.

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

## The desktop-first experience

The Electron desktop app is the primary way to use personal-agent. It serves the React UI through a custom `personal-agent://app/` protocol and provides:

- **Conversations** — live AI agent sessions with streaming, tools, artifacts, and checkpoints
- **Knowledge** — browse and edit the durable knowledge vault, import URLs, manage docs
- **Automations** — scheduled tasks and durable runs
- **Settings** — model config, instruction files, MCP servers, companion pairing

The desktop app runs the daemon in-process by default, so background behavior (runs, automations, reminders) stays active as long as the app is open.

## The iOS companion

The iOS companion app (under `apps/ios/PersonalAgentCompanion/`) is a native phone client that pairs with a running daemon companion API. It provides:

- conversation browsing, prompt sending, and live transcript streaming
- knowledge vault browsing and editing with markdown tools
- automation inspection
- share extension for saving URLs and images into the vault
- native drawing with PencilKit and Excalidraw-compatible export

See [iOS Companion](docs/ios-companion.md) for build and test instructions.

## Common commands

```bash
# start the desktop app (the primary UI)
npm run desktop:start

# health / setup
pa doctor
pa status
pa help

# terminal interface
pa tui

# background runtime
pa daemon status
pa daemon logs

# MCP
pa mcp list --probe
pa mcp info <server>/<tool>
```

Use `pa help <command>` for exact flags.

There are intentionally no top-level `pa runs`, `pa tasks`, `pa profile`, `pa note`, or `pa node` commands. Runs and automations are managed through the desktop app, daemon APIs, or the runtime tools exposed inside conversations.

## Repo layout

### Workspace packages

- `packages/desktop` — **Electron app shell** (the primary UI surface)
- `packages/web` — React renderer and local API modules used by Electron
- `packages/daemon` — runs, automations, wakeups, daemon runtime
- `packages/cli` — `pa` command-line tool
- `packages/core` — path resolution, durable state helpers, knowledge/project utilities, MCP helpers, resource loading

### Shipped resources and clients

- `apps/ios/PersonalAgentCompanion/` — **native iOS companion app**
- `defaults/agent/` — repo-managed Pi defaults
- `extensions/` — built-in runtime extensions
- `internal-skills/` — built-in feature behavior docs
- `prompt-catalog/` — prompt text owned by this repo
- `docs/` — product semantics and current behavior

## Dependencies

The core AI runtime comes from `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`, both published on the public npm registry. They install automatically with `npm install`.

## Platform notes

- **Desktop app**: macOS arm64 only. Signed release builds require an Apple Developer ID certificate. Local dev (`npm run desktop:start`) skips signing.
- **iOS companion**: Xcode required. Simulator is free; device builds need an Apple Developer account.

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

Useful dev entry points:

```bash
npm run desktop:start     # launch the Electron app
npm run desktop:dev       # same dev launcher
npm run ios:dev           # iOS companion against local dev host
npm run ab:run -- --session smoke-check --command "ab open personal-agent://app/ && ab wait 1000 && ab snapshot -i"
```

To skip code signing for local Electron builds:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run desktop:start
```

Notes:

- Use the repo `agent-browser` wrapper via `npm run ab:run` instead of raw `agent-browser`.
- The iOS companion app requires Xcode and can be tested in the simulator.
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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, PR workflow, and local dev tips.

## License

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See the [LICENSE](LICENSE) file for details.

If you need a commercial license for proprietary use, contact Patrick Lee.

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
- [`docs/ios-companion.md`](docs/ios-companion.md) — native iOS companion app and host API model
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
