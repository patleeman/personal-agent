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
- [Desktop App](desktop-app.md) — Electron shell, shortcuts, and app chrome
- [Knowledge](../extensions/system-knowledge/README.md) — vault, docs, skills, instruction files, and managed sync
- [Configuration](configuration.md) — file-based config, env vars
- [Daemon](daemon.md) — background process and runtime lifecycle
- [Extension authoring](../packages/extensions/README.md) — build native extensions with manifests, frontend/backend entries, tools, skills, and stable SDK imports
- [System extensions](../extensions) — feature-owned docs and implementation packages

## System extension docs

Feature-specific documentation lives beside the owning extension package:

- [Artifacts](../extensions/system-artifacts/README.md)
- [Auto Mode](../extensions/system-auto-mode/README.md)
- [Automations](../extensions/system-automations/README.md)
- [Browser](../extensions/system-browser/README.md)
- [Conversation Tools](../extensions/system-conversation-tools/README.md)
- [Diffs](../extensions/system-diffs/README.md)
- [Extension Manager](../extensions/system-extension-manager/README.md)
- [File Explorer](../extensions/system-files/README.md)
- [Gateways](../extensions/system-gateways/README.md)
- [Images](../extensions/system-images/README.md)
- [Knowledge](../extensions/system-knowledge/README.md)
- [MCP](../extensions/system-mcp/README.md)
- [OpenAI Native Compaction](../extensions/system-openai-native-compaction/README.md)
- [Runs](../extensions/system-runs/README.md)
- [Settings](../extensions/system-settings/README.md)
- [Telemetry](../extensions/system-telemetry/README.md)
- [Web Tools](../extensions/system-web-tools/README.md)

## Sections

**View Modes** — Conversation, Workbench, and Zen views, plus conversation context attachments.

**Core Product Model** — conversations and projects. Feature packages own their own docs.

**Desktop App** — Electron shell and app-level behavior.

**Background Runtime** — daemon lifecycle and runtime operations.

**Connectivity** — iOS companion and runtime connectivity architecture.

**Operations** — configuration file format and release cycle.
