# Personal Agent

**Desktop AI agent with durable state, conversations, knowledge management, and automations.** Ships an Electron desktop app, a background daemon, and an iOS companion.

[Download the latest release](https://github.com/patleeman/personal-agent/releases/latest) — macOS arm64 only.

---

## Quick start

### Download and install

1. Download the latest macOS `.zip` from [GitHub Releases](https://github.com/patleeman/personal-agent/releases/latest)
2. Unzip and drag `Personal Agent.app` to Applications
3. Open the app — the daemon starts automatically

That's it. No Node.js, no npm, no build step needed for the desktop app.

### First run

- Open a **Conversation** to start chatting with the agent
- Browse **Knowledge** to see the durable vault
- Open **Automations** to inspect or schedule background work
- Visit **Settings** to configure providers, models, instruction files, and more

---

## What is Personal Agent?

Personal Agent is a native macOS app that runs a capable AI agent with durable memory, background automation, and a full tool ecosystem.

Core design principle: **separate shipped code from durable knowledge from machine-local state** cleanly.

| Layer                           | What lives there                          | Example                                       |
| ------------------------------- | ----------------------------------------- | --------------------------------------------- |
| **Repo-managed defaults**       | Shipped code, config schemas, prompts     | This repo                                     |
| **Durable knowledge vault**     | Docs, skills, projects, instruction files | `~/Documents/personal-agent` or git-backed KB |
| **Machine-local runtime state** | Conversations, logs, daemon state         | `~/.local/state/personal-agent`               |

The durable rule: use a **conversation** when work is happening now, use the **vault** when knowledge should outlive the thread, and use daemon-backed surfaces for **runs**, **automations**, **queues**, and **reminders**.

### What it ships

- **Electron desktop app** — primary UI for conversations, knowledge, automations, and settings
- **Background daemon** — runs, scheduled tasks, wakeups, reminders, companion pairing
- **Knowledge system** — docs, instruction files, skills, and projects
- **MCP integration** — external tool server support
- **iOS companion app** — native phone client for chat, knowledge, and automations

---

## Features

| Category                | Highlights                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------- |
| **Agent conversations** | Live sessions with tools, context attachments, streaming, checkpoints, artifacts        |
| **Knowledge vault**     | Browse/edit durable docs, URL import, git-synced across machines                        |
| **Automations**         | Scheduled recurring or one-time tasks, durable background runs, reminders               |
| **Desktop UI**          | Workbench layout with rails for knowledge, files, diffs, artifacts, and browser         |
| **Background daemon**   | Runs, scheduled tasks, wakeups, reminders, companion API, SSH remote connections        |
| **iOS companion**       | Native phone client paired via QR code — chat, knowledge, share extension               |
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
- [iOS Companion](docs/ios-companion.md)
- [Repo Layout](docs/repo-layout.md) — where code lives
- [Release Cycle](docs/release-cycle.md)

Built-in runtime behavior is documented in [`internal-skills/`](internal-skills/):

- [Runs](internal-skills/runs/INDEX.md)
- [Scheduled Tasks](internal-skills/scheduled-tasks/INDEX.md)
- [Auto Mode](internal-skills/auto-mode/INDEX.md)
- [Artifacts](internal-skills/artifacts/INDEX.md)
- [Reminders and Alerts](internal-skills/alerts/INDEX.md)
- [Skills and Capabilities](internal-skills/skills-and-capabilities/INDEX.md)

---

## Development

For contributors building from source:

```bash
npm install
npm run build
npm test
npm run lint
```

Useful dev commands:

```bash
npm run desktop:start      # launch the Electron app
npm run desktop:dev        # same dev launcher
npm run ios:dev            # iOS companion against local dev host
```

Platform prerequisites:

- **macOS arm64** (the desktop app targets macOS; no Windows or Linux build)
- **Node.js 20+** and **npm 11+** recommended
- **Xcode** (only needed for iOS companion development)

Set `CSC_IDENTITY_AUTO_DISCOVERY=false` to skip code signing for local Electron builds.

See [CONTRIBUTING.md](CONTRIBUTING.md) for PR policy and issue guidelines.

---

## Release flow

Desktop releases are built, signed, notarized, and published to GitHub Releases locally.

```bash
npm run release:desktop:patch
npm run release:desktop:minor
npm run release:desktop:major
```

See [`docs/release-cycle.md`](docs/release-cycle.md) for the full details.

---

## License

[MIT](LICENSE)
