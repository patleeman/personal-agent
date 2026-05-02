# personal-agent docs

Use this folder for product semantics and current behavior.

Use the live tool schemas for exact tool arguments. Use `internal-skills/` for built-in feature behavior. Use repo, vault, and local `AGENTS.md` files for runtime policy.

## Path vocabulary

These aliases are used throughout the docs:

- `<state-root>` — machine-local runtime state. Default: `~/.local/state/personal-agent`
- `<config-root>` — machine-local config. Default: `<state-root>/config`
- `<profiles-root>` — machine-local profile config. Default: `<config-root>/profiles`
- `<vault-root>` — effective durable knowledge root

`<vault-root>` resolves in this order:

1. `PERSONAL_AGENT_VAULT_ROOT`
2. `<state-root>/knowledge-base/repo` when `knowledgeBaseRepoUrl` is configured
3. legacy `vaultRoot` from `<config-root>/config.json`
4. fallback default `~/Documents/personal-agent`

In a managed knowledge-base setup, `<vault-root>` is usually the managed mirror under `<state-root>/knowledge-base/repo`.

## Start here

1. [Getting Started](./getting-started.md)
2. [Decision Guide](./decision-guide.md)
3. [How personal-agent works](./how-it-works.md)
4. [Knowledge System](./knowledge-system.md)

## Doc map

Start with [Features](./features.md) for a complete feature catalog organized by surface.

### Product model

- [Decision Guide](./decision-guide.md) — fastest way to pick the right durable surface
- [How personal-agent works](./how-it-works.md) — repo defaults, vault, machine-local state, and runtime layering
- [Knowledge System](./knowledge-system.md) — instruction files, docs, skills, projects, and old-term mappings
- [Knowledge Base Sync](./knowledge-base-sync.md) — git-backed sync for multi-machine vaults
- [Conversation Context](./conversation-context.md) — one-shot mentions vs attached docs vs binary attachments
- [Conversations](./conversations.md) — live thread behavior, auto mode, and async follow-through
- [Checkpoints](./checkpoints.md) — conversation-scoped code snapshots and diffs
- [Projects](./projects.md) — optional structured durable work packages

### Interfaces

- [Desktop App](./desktop-app.md) — the primary operator UI
- [iOS Companion](./ios-companion.md) — native phone client
- [Command-Line Guide (`pa`)](./command-line.md)
- [Daemon](./daemon.md)
- [Configuration](./configuration.md) — file-based config, env vars, and the Settings UI
- [Models and Providers](./models-and-providers.md) — provider API types, auth, and model schema
- [MCP](./mcp.md)

### Development and operations

- [Repo Layout](./repo-layout.md)
- [Extensions](./extensions.md) — built-in extensions and how they affect behavior
- [Release Cycle](./release-cycle.md)
- [Troubleshooting](./troubleshooting.md)

## Built-in feature docs

These live under `internal-skills/` because they describe runtime features rather than general product semantics:

- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
- [Auto Mode](../internal-skills/auto-mode/INDEX.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
- [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md)
- [Reminders and Notification Delivery](../internal-skills/alerts/INDEX.md)
- [Shared Inbox Removal](../internal-skills/inbox/INDEX.md)
- [Skills and Runtime Capabilities](../internal-skills/skills-and-capabilities/INDEX.md)

## Read by question

| Question | Start here | Then read |
| --- | --- | --- |
| What durable surface should I use? | [Decision Guide](./decision-guide.md) | feature-specific doc or internal skill |
| What is the actual state model? | [How personal-agent works](./how-it-works.md) | [Configuration](./configuration.md) |
| How does dictation transcription plug in? | [Dictation transcription](./dictation-transcription.md) | [Configuration](./configuration.md) |
| Where should reusable knowledge live? | [Knowledge System](./knowledge-system.md) | [Projects](./projects.md) when structure matters |
| How should a conversation keep durable context? | [Conversation Context](./conversation-context.md) | [Conversations](./conversations.md) |
| How do I operate the app locally? | [Getting Started](./getting-started.md) | [Desktop App](./desktop-app.md), [Command-Line Guide (`pa`)](./command-line.md) |
| How does the phone app connect? | [iOS Companion](./ios-companion.md) | [Daemon](./daemon.md), [Configuration](./configuration.md) |
| How do background jobs and automations work? | [Daemon](./daemon.md) | [Runs](../internal-skills/runs/INDEX.md), [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md), [Auto Mode](../internal-skills/auto-mode/INDEX.md) |
| Where should code for a new feature live? | [Repo Layout](./repo-layout.md) | package-local files it links to |
| How do MCP servers fit in? | [MCP](./mcp.md) | `pa mcp help` for exact CLI flags |
| How do checkpoints and diffs work? | [Checkpoints](./checkpoints.md) | [Conversations](./conversations.md), [Desktop App](./desktop-app.md) |
| How does knowledge base sync work? | [Knowledge Base Sync](./knowledge-base-sync.md) | [Configuration](./configuration.md) |
| How do models and providers work? | [Models and Providers](./models-and-providers.md) | [Configuration](./configuration.md) |
| What extensions are loaded? | [Extensions](./extensions.md) | [Configuration](./configuration.md) |
| How do I ship the desktop app? | [Release Cycle](./release-cycle.md) | repo `AGENTS.md` release notes |

## Rules for agents

- prefer the smallest correct durable surface
- keep durable knowledge in `<vault-root>`, not only in conversation history
- use docs for semantics, tool schemas for exact arguments
- use `internal-skills/` when the question is about built-in runtime behavior
- prefer current routes and commands over deleted legacy surfaces
