# Features

A catalog of every product feature and where to find more detail.

## Desktop UI

| Feature            | What it does                                                                              | More                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Conversations      | Live agent chat sessions with tools, context, and async follow-through                    | [Conversations](./conversations.md)                                                        |
| Knowledge          | Browse, edit, and organize the durable vault — file tree, editor, URL import              | [Knowledge System](./knowledge-system.md), [Knowledge Base Sync](./knowledge-base-sync.md) |
| Automations        | View and manage scheduled background tasks                                                | [Daemon](./daemon.md), [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)      |
| Settings           | Configure theme, keyboard shortcuts, providers, models, dictation, daemon, remotes        | [Configuration](./configuration.md)                                                        |
| Workbench          | Multi-pane conversation layout with rails for Knowledge, Files, Diffs, Artifacts, Browser | [Desktop App](./desktop-app.md)                                                            |
| Workbench Browser  | Embedded webview scoped to the conversation; tools for snapshot, CDP, screenshot          | [Desktop App](./desktop-app.md), [Built-in Browser](../internal-skills/browser/INDEX.md)   |
| Keyboard shortcuts | Every desktop menu shortcut is configurable and auto-saves                                | [Configuration](./configuration.md)                                                        |
| Layout modes       | Compact, Workbench, and Zen — toggled via F1/F2/F3 or shortcuts                           | [Desktop App](./desktop-app.md)                                                            |

## Background runtime

| Feature         | What it does                                                               | More                                                           |
| --------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Daemon          | Long-lived background process owning runs, automations, wakeups, companion | [Daemon](./daemon.md)                                          |
| Runs            | Detached agent work started now, inspected later                           | [Runs](../internal-skills/runs/INDEX.md)                       |
| Scheduled tasks | Saved recurring or one-time automations that call back into a thread       | [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md) |
| Auto mode       | Hidden review turn after each visible assistant turn                       | [Auto Mode](../internal-skills/auto-mode/INDEX.md)             |
| Reminders       | Tell-me-later wakeups that resume a conversation                           | [Reminders and Alerts](../internal-skills/alerts/INDEX.md)     |
| Async attention | Cross-thread follow-up and callback delivery                               | [Async Attention](../internal-skills/async-attention/INDEX.md) |
| Companion API   | HTTP/WebSocket API for phone clients and remote access                     | [Daemon](./daemon.md), [iOS Companion](./ios-companion.md)     |
| Keep awake      | Daemon prevents idle sleep for unattended background work                  | [Configuration](./configuration.md)                            |

## Agent tools and capabilities

| Feature              | What it does                                                     | More                                                                                                                      |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Checkpoints          | Targeted git commits tied to the conversation, with inline diffs | [Checkpoints](./checkpoints.md)                                                                                           |
| Web search           | Search the web via Exa API or DuckDuckGo fallback                | [Extensions](./extensions.md)                                                                                             |
| Web fetch            | Read URL content as markdown                                     | [Extensions](./extensions.md)                                                                                             |
| Apply patch          | Structured file patching with the apply_patch tool               | [Extensions](./extensions.md)                                                                                             |
| Conversation inspect | Read-only inspection of other conversation transcripts           | [Conversations](./conversations.md)                                                                                       |
| Browser tools        | Snapshot, CDP, and screenshot for the shared Workbench Browser   | [Desktop App](./desktop-app.md)                                                                                           |
| Skills               | Reusable agent workflow packages                                 | [Knowledge System](./knowledge-system.md), [Skills and Capabilities](../internal-skills/skills-and-capabilities/INDEX.md) |
| Artifacts            | Rendered HTML, Mermaid, and LaTeX outputs tied to a conversation | [Artifacts](../internal-skills/artifacts/INDEX.md)                                                                        |

## Storage and knowledge

| Feature              | What it does                                                         | More                                              |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| Vault                | Durable knowledge root — docs, skills, projects, instruction files   | [Knowledge System](./knowledge-system.md)         |
| KB sync              | Git-backed vault synchronization across machines                     | [Knowledge Base Sync](./knowledge-base-sync.md)   |
| Instruction files    | Selected markdown files that shape agent behavior                    | [Knowledge System](./knowledge-system.md)         |
| Projects             | Structured work packages with milestones, tasks, and validation      | [Projects](./projects.md)                         |
| Conversation context | One-shot `@` mentions vs attached context docs vs binary attachments | [Conversation Context](./conversation-context.md) |

## Providers and models

| Feature         | What it does                                                           | More                                                    |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Provider config | OpenAI, Anthropic, Google providers with API type, key, base URL       | [Models and Providers](./models-and-providers.md)       |
| Auth store      | API key, OAuth, and environment-based credential management            | [Configuration](./configuration.md)                     |
| Model registry  | Discovered and configured models with context windows, reasoning tiers | [Models and Providers](./models-and-providers.md)       |
| Dictation       | Local Whisper or cloud transcription for voice input                   | [Dictation Transcription](./dictation-transcription.md) |

## Integrations

| Feature       | What it does                                                            | More                                |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------- |
| MCP           | Model Context Protocol servers                                          | [MCP](./mcp.md)                     |
| iOS Companion | Native iPhone app paired via QR code                                    | [iOS Companion](./ios-companion.md) |
| SSH remotes   | Remote daemon connections for cross-machine agent sessions              | [Configuration](./configuration.md) |
| Extensions    | Built-in Pi runtime extensions (web tools, knowledge, compaction, etc.) | [Extensions](./extensions.md)       |

## Development and operations

| Feature         | What it does                                                 | More                                    |
| --------------- | ------------------------------------------------------------ | --------------------------------------- |
| CLI (`pa`)      | Terminal interface: `pa tui`, `pa daemon`, `pa mcp`          | [Command-Line Guide](./command-line.md) |
| Desktop release | Local signed build, notarization, and GitHub Release publish | [Release Cycle](./release-cycle.md)     |
| Troubleshooting | Common issues and diagnostic steps                           | [Troubleshooting](./troubleshooting.md) |
