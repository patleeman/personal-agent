# personal-agent docs

Use this folder for product semantics and current behavior.

Use the live tool schemas for exact tool arguments. Use `internal-skills/` for built-in feature behavior. Use repo and profile `AGENTS.md` files for runtime policy.

## Path vocabulary

These aliases are used throughout the docs:

- `<state-root>` — machine-local runtime state. Default: `~/.local/state/personal-agent`
- `<config-root>` — machine-local config. Default: `<state-root>/config`
- `<vault-root>` — effective durable knowledge root

`<vault-root>` resolves in this order:

1. `PERSONAL_AGENT_VAULT_ROOT`
2. `<state-root>/knowledge-base/repo` when `knowledgeBaseRepoUrl` is configured
3. `vaultRoot` from `<config-root>/config.json`
4. fallback default `~/Documents/personal-agent`

In Patrick's normal setup, `<vault-root>` is usually the managed mirror under `<state-root>/knowledge-base/repo`.

## Start here

1. [Getting Started](./getting-started.md)
2. [Decision Guide](./decision-guide.md)
3. [How personal-agent works](./how-it-works.md)
4. [Knowledge System](./knowledge-system.md)

## Doc map

### Product model

- [Decision Guide](./decision-guide.md) — fastest way to pick the right durable surface
- [How personal-agent works](./how-it-works.md) — repo defaults, vault, machine-local state, and runtime layering
- [Knowledge System](./knowledge-system.md) — instruction files, docs, skills, projects, and old-term mappings
- [Conversation Context](./conversation-context.md) — one-shot mentions vs attached docs vs binary attachments
- [Conversations](./conversations.md) — live thread behavior, auto mode, and async follow-through
- [Projects](./projects.md) — optional structured durable work packages

### Interfaces

- [Command-Line Guide (`pa`)](./command-line.md)
- [Web UI Guide](./web-ui.md)
- [Daemon](./daemon.md)
- [Configuration](./configuration.md)
- [MCP](./mcp.md)

### Development and operations

- [Repo Layout](./repo-layout.md)
- [Release Cycle](./release-cycle.md)
- [Troubleshooting](./troubleshooting.md)

## Built-in feature docs

These live under `internal-skills/` because they describe runtime features rather than general product semantics:

- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
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
| Where should reusable knowledge live? | [Knowledge System](./knowledge-system.md) | [Projects](./projects.md) when structure matters |
| How should a conversation keep durable context? | [Conversation Context](./conversation-context.md) | [Conversations](./conversations.md) |
| How do I operate the app locally? | [Getting Started](./getting-started.md) | [Command-Line Guide (`pa`)](./command-line.md), [Web UI Guide](./web-ui.md) |
| How do background jobs and automations work? | [Daemon](./daemon.md) | [Runs](../internal-skills/runs/INDEX.md), [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md) |
| Where should code for a new feature live? | [Repo Layout](./repo-layout.md) | package-local files it links to |
| How do MCP servers fit in? | [MCP](./mcp.md) | `pa mcp help` for exact CLI flags |
| How do I ship the desktop app? | [Release Cycle](./release-cycle.md) | repo `AGENTS.md` release notes |

## Rules for agents

- prefer the smallest correct durable surface
- keep durable knowledge in `<vault-root>`, not only in conversation history
- use docs for semantics, tool schemas for exact arguments
- use `internal-skills/` when the question is about built-in runtime behavior
- prefer current routes and commands over deleted legacy surfaces
