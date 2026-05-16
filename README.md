# Personal Agent

**My desktop harness for running agents that can modify their own tools, workflows, and UI.**

[Download the latest release](https://github.com/patleeman/personal-agent/releases/latest) — macOS arm64 only.

---

## What is this?

Personal Agent is a desktop agent harness built on top of [Pi](https://pi.dev).

Pi gives it the core agent layer: tools, sessions, context files, provider support, and no model lock-in. Personal Agent adds the desktop layer I wanted around that core: conversations, background runs, automations, extensions, skills, knowledge, browser tools, artifacts, diffs, and all the other stuff that starts to matter once you use agents for more than one-off chats.

The main idea is simple:

I want the agent to be able to improve its own harness.

If it needs a new workflow, it can write a skill.
If it needs a new tool, it can add one.
If it needs a new UI surface, it can build an extension.
If it needs to keep working while I'm away, it can run in the background.

Most AI apps are closed boxes. You use whatever workflow the vendor shipped.

Personal Agent goes the other direction. The harness is part of the agent loop.

---

## Why I built this

Terminal agents are great until they aren't.

A terminal UI is fine for quick coding tasks, but once you have multiple conversations, long-running work, screenshots, browser state, knowledge files, artifacts, diffs, reminders, and extension surfaces, the terminal starts turning into a hacked together tmux shrine.

I wanted something closer to the desktop harnesses from the big labs, but without the big lab lock-in.

With Pi underneath, I can use different providers and models. With Personal Agent on top, I can shape the workspace around how I actually work.

---

## The important bits

### Self-extensible

This is the main point.

Personal Agent has an extension system, but the interesting part is not that a developer can write extensions.

The interesting part is that the agent can.

Extensions can add UI, tools, workflow surfaces, and integrations. Skills can teach the agent reusable procedures. Instructions can tune behavior. MCP can connect outside systems.

The agent can inspect those surfaces, edit files, build the extension, validate it, reload it, and then use the thing it just made.

That's the loop I care about.

### Built on Pi

Personal Agent uses Pi as the core agent layer.

That means provider flexibility, real tool execution, sessions, context files, and the ability to swap models without turning the whole product into a hostage negotiation.

The desktop app is the workbench. Pi is the engine.

### Runs in the background

Chat should not be the lifecycle of the work.

Personal Agent has a daemon for background runs, scheduled tasks, follow-ups, and long-running agent loops. You can give the agent work, walk away, and come back later.

This is useful for the obvious stuff: coding tasks, research, cleanup, reminders, recurring checks, and anything else where sitting there watching tokens stream is not a good use of your limited time on earth.

### Desktop UI

I like terminals, but I do not want my entire agent workflow trapped in one.

Personal Agent gives the agent a real workspace: conversations, files, diffs, artifacts, browser state, knowledge, automations, settings, and extension-provided views.

The goal is not to make chat prettier. The goal is to give agent work a place to live.

### Knowledge

The knowledge system is intentionally boring.

It's markdown files, skills, instructions, notes, and project docs. No magic RAG shrine required.

The agent can read it, edit it, and use it as context. You can also tag files into conversations when you know exactly what matters.

---

## Quick start

### Download and install

1. Download the latest macOS `.dmg` from [GitHub Releases](https://github.com/patleeman/personal-agent/releases/latest)
2. Open the DMG and drag `Personal Agent.app` to Applications
3. Open the app — the daemon starts automatically

### First run

- Go to **Settings** to configure a provider, model, and other preferences
- Open a **Conversation** to start chatting with the agent
- Browse **Knowledge** to see the vault
- Open **Automations** to inspect scheduled tasks and background work

---

## What it ships

- **Electron desktop app** — conversations, knowledge, automations, settings, rails, and workbench UI
- **Pi agent core** — provider/model flexibility, sessions, tools, context files, and agent execution
- **Extension system** — local extensions for tools, UI surfaces, workflow features, and integrations
- **Background daemon** — runs, scheduled tasks, wakeups, reminders, and follow-ups
- **Knowledge system** — markdown docs, instruction files, skills, notes, and projects
- **MCP integration** — external tool server support
- **Browser and artifact tools** — browser context, screenshots, rendered artifacts, and files the agent can work with

See the [full feature catalog](docs/features.md) for the complete list organized by surface.

---

## Documentation

All docs are in the [`docs/`](docs/) folder. They are written for agents first, humans second.

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
