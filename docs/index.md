# Personal Agent Documentation

Personal Agent is a durable AI agent runtime with a desktop app, background automation, and knowledge management. It wraps an LLM with persistent state, tools, and async workflows.

## Quick start

```bash
npm install
npm run build
npm run desktop:start
```

See [Getting Started](getting-started.md) for the full setup.

## Start here

- [Views](views.md) — Conversation, Workbench, Zen layouts
- [Conversations](conversations.md) — live threads, branching, async follow-through
- [Desktop App](desktop-app.md) — Electron shell, shortcuts, settings
- [Knowledge System](knowledge-system.md) — vault, docs, skills, instruction files
- [Configuration](configuration.md) — file-based config, env vars
- [Daemon](daemon.md) — background process, runs, automations, companion

## Sections

**View Modes** — Conversation, Workbench, and Zen views, plus conversation context attachments.

**Core Product Model** — conversations, checkpoints, diffs, artifacts, git integration, projects, knowledge system, and KB sync.

**Desktop App** — Electron shell, settings UI, file explorer, and automations management.

**Browser** — embedded webview with CDP, snapshot, screenshot tools, and browser comments.

**Background Runtime** — daemon, runs, scheduled tasks, reminders, and auto mode.

**Agent Tools** — web search & fetch, apply patch, image generation, ask user question, change working directory, and conversation inspect.

**Voice** — local Whisper dictation.

**Providers & Models** — API provider config, OAuth, keys, and model registry.

**Connectivity** — iOS companion, MCP servers, and SSH remotes.

**Operations** — configuration file format and release cycle.
