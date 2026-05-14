# Personal Agent Documentation

Personal Agent is a durable AI agent runtime with a desktop app, background automation, and knowledge management. It wraps an LLM with persistent state, tools, and async workflows.

## Quick start

```bash
pnpm install
pnpm run setup:hooks   # optional: enable the tracked pre-commit hook
pnpm run build
pnpm run desktop:start
```

The repo intentionally avoids a root `postinstall`; third-party build scripts are allowlisted in `pnpm-workspace.yaml`, and anything new shows up in `pnpm ignored-builds`.

See [Getting Started](getting-started.md) for the full setup.

## Start here

- [Views](views.md) — Conversation, Workbench layouts
- [Conversations](conversations.md) — live threads, branching, async follow-through
- [Desktop App](desktop-app.md) — Electron shell, shortcuts, and app chrome
- [Knowledge](../extensions/system-knowledge/README.md) — vault, docs, skills, instruction files, and managed sync
- [Knowledge base sync](knowledge-base.md) — git-backed knowledge base setup, local paths, and sync behavior
- [Configuration](configuration.md) — file-based config, env vars
- [Daemon](daemon.md) — background process and runtime lifecycle
- [Sandboxing](sandboxing.md) — shared process execution launcher, wrapper extensions, and direct process API policy
- [Activity tree](activity-tree.md) — shared model for conversations, runs, and future sidebar sub-items
- [Performance diagnostics](performance-diagnostics.md) — renderer timing tripwires for conversation load and API latency
- [Telemetry](telemetry.md) — local JSONL telemetry logs, SQLite observability indexes, exports, and runtime producers
- [Extension authoring](extensions.md) — build native extensions with manifests, frontend/backend entries, tools, skills, agent hooks, event bus, notifications, stable SDK imports, and integration testing
- [Extension API types](../packages/extensions/README.md) — SDK package with exported types for frontend and backend code
- [System extensions](../extensions) — feature-owned docs and implementation packages
- [Experimental extensions](../experimental-extensions) — rough user extensions that are not bundled with the app

## Extension docs

Personal Agent product features live in extensions. Agents should use this index as the map: read the owning extension's `README.md` before changing feature behavior, and read [Extension authoring](extensions.md) plus [Extension API types](../packages/extensions/README.md) before changing extension APIs.

System extensions are bundled under `extensions/system-*`. Experimental extensions are bundled under `experimental-extensions/extensions/*`, are loaded by the registry, and should set `defaultEnabled: false`. User extensions live under `<state-root>/extensions/{extension-id}` by default and follow the same package contract.

Feature-specific documentation lives beside the owning extension package:

- [Artifacts](../extensions/system-artifacts/README.md)
- [Auto Mode](../extensions/system-auto-mode/README.md)
- [Automations](../extensions/system-automations/README.md)
- [Browser](../extensions/system-browser/README.md)
- [Codex Protocol for Companion App](../experimental-extensions/extensions/system-codex/README.md)
- [Conversation Tools](../extensions/system-conversation-tools/README.md)
- [Diffs](../extensions/system-diffs/README.md)
- [Extension Manager](../extensions/system-extension-manager/README.md)
- [File Explorer](../extensions/system-files/README.md)
- [Gateways](../extensions/system-gateways/README.md)
- [Images](../extensions/system-images/README.md)
- [Knowledge](../extensions/system-knowledge/README.md)
- [Local Dictation](../extensions/system-local-dictation/README.md)
- [MCP](../extensions/system-mcp/README.md)
- [Onboarding](../extensions/system-onboarding/README.md) — first-run onboarding bootstrap and conversation flow
- [OpenAI Native Compaction](../extensions/system-openai-native-compaction/README.md)
- [Runs](../extensions/system-runs/README.md)
- [Session Exchange](../experimental-extensions/extensions/system-session-exchange/README.md)
- [Settings](../extensions/system-settings/README.md)
- [Telemetry extension](../extensions/system-telemetry/README.md)
- [Web Tools](../extensions/system-web-tools/README.md)

## Sections

**View Modes** — Conversation and Workbench views, plus conversation context attachments.

**Core Product Model** — conversations and projects. Core stays a small stable platform; product features should live in system or user extensions.

**Desktop App** — Electron shell and app-level behavior.

**Background Runtime** — daemon lifecycle and runtime operations.

**Connectivity** — iOS companion and runtime connectivity architecture.

**Operations** — configuration file format and release cycle.
