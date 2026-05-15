# Personal Agent

**Desktop AI agent with durable state, conversations, knowledge management, and automations.** Ships an Electron desktop app and a background daemon.

[Download the latest release](https://github.com/patleeman/personal-agent/releases/latest) — macOS arm64 only.

---

## Quick start

### Download and install

1. Download the latest macOS `.dmg` from [GitHub Releases](https://github.com/patleeman/personal-agent/releases/latest)
2. Open the DMG and drag `Personal Agent.app` to Applications
3. Open the app — the daemon starts automatically

### First run

- Go to **Settings** to configure a provider, model, and other preferences
- Open a **Conversation** to start chatting with the agent
- Browse **Knowledge** to see the durable vault
- Open **Automations** to inspect or schedule background work

---

## What is Personal Agent?

Personal Agent is a native macOS app that runs a capable AI agent with durable memory, background automation, and a full tool ecosystem.

### What it ships

- **Electron desktop app** — primary UI for conversations, knowledge, automations, and settings
- **Background daemon** — runs, scheduled tasks, wakeups, and reminders
- **Knowledge system** — docs, instruction files, skills, and projects
- **MCP integration** — external tool server support

---

## Features

| Category                | Highlights                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------- |
| **Agent conversations** | Live sessions with tools, context attachments, streaming, checkpoints, artifacts        |
| **Knowledge vault**     | Browse/edit durable docs, URL import, git-synced across machines                        |
| **Automations**         | Scheduled recurring or one-time tasks, durable background runs, reminders               |
| **Desktop UI**          | Workbench layout with rails for knowledge, files, diffs, artifacts, and browser         |
| **Background daemon**   | Runs, scheduled tasks, wakeups, and reminders                                           |
| **Agent tools**         | Web search, web fetch, apply patch, conversation inspection, checkpoints, browser tools |
| **Skills system**       | Reusable agent workflow packages stored in the vault                                    |
| **Model providers**     | OpenAI, Anthropic, Google — configurable API types, keys, base URLs                     |
| **MCP**                 | Model Context Protocol servers for external tools                                       |
| **Dictation**           | Local Whisper or cloud transcription for voice input                                    |

See the [full feature catalog](docs/features.md) for the complete list organized by surface.

---

## Documentation

All docs are in the [`docs/`](docs/) folder — written for agents first, humans second.

### Start here

- [Getting Started](docs/getting-started.md) — install, first-run flow, vault setup
- [How personal-agent works](docs/how-it-works.md) — state model and runtime layering
- [Decision Guide](docs/decision-guide.md) — pick the right durable surface
- [Features](docs/features.md) — complete feature catalog

### Key references

- [Desktop App](docs/desktop-app.md) — runtime and UI surface
- [Knowledge System](docs/knowledge-system.md) — docs, instruction files, skills, projects
- [Conversations](docs/conversations.md) — conversation model, auto mode, async follow-through
- [Configuration](docs/configuration.md) — file-based config, env vars, Settings UI
- [Repo Layout](docs/repo-layout.md) — where code lives
- [Release Cycle](docs/release-cycle.md)

Built-in runtime behavior is packaged as system extensions under [`extensions/`](extensions/). Agent-facing workflow guidance lives in each extension's `skills/<skill>/SKILL.md` and is registered through `contributes.skills`.

---

## Development

For contributors building from source:

```bash
pnpm install
pnpm run setup:hooks   # optional: enable the tracked pre-commit hook
pnpm run build
pnpm test
pnpm run lint
```

This repo intentionally has no first-party `postinstall`. Third-party build scripts are allowlisted in `pnpm-workspace.yaml`; review anything newly blocked with `pnpm ignored-builds`. ESLint is configured for actionable errors; dynamic extension/API boundary code may use `any` where stricter typing would add noise.

Useful dev commands:

```bash
pnpm run desktop:start      # launch the Electron app
pnpm run desktop:dev        # same dev launcher

# Extension integration validation (run before starting the app)
pnpm run check:extensions        # full suite (~30s, includes module runtime checks)
pnpm run check:extensions:quick  # quick check (~5s, skips slow dynamic import)
```

Platform prerequisites:

- **macOS arm64** (the desktop app targets macOS; no Windows or Linux build)
- **Node.js 20+** and **pnpm 11+** recommended

Set `CSC_IDENTITY_AUTO_DISCOVERY=false` to skip code signing for local Electron builds.

See [CONTRIBUTING.md](CONTRIBUTING.md) for PR policy and issue guidelines.

---

## Release flow

Desktop releases are built, signed, notarized, and published to GitHub Releases locally.

```bash
pnpm run release:desktop:patch
pnpm run release:desktop:minor
pnpm run release:desktop:major
```

See [`docs/release-cycle.md`](docs/release-cycle.md) for the full details.

---

## License

[MIT](LICENSE)
