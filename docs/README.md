# personal-agent docs

This folder is the operator and agent guide to `personal-agent`.

Use it for product behavior, durable-surface semantics, and interface-level guidance. Use runtime tool schemas for exact tool arguments, and use the internal skills for built-in feature behavior that lives outside `docs/`.

## Source-of-truth boundaries

Use these docs for:

- which durable surface to use
- where state lives
- how the CLI, web UI, daemon, and desktop shell fit together
- current product behavior and the intended KB model

Use these other places for adjacent concerns:

- repo `AGENTS.md` — repo-specific harness instructions and engineering rules
- selected instruction files — machine-local behavior selection for the active runtime
- `../internal-skills/` — built-in runtime feature guides for runs, tasks, artifacts, reminders, async attention, and inbox removal
- `~/Documents/personal-agent/skills/<skill>/SKILL.md` — reusable workflow skills
- vault docs/packages — durable knowledge anywhere under the configured vault root
- tool schemas / runtime prompt material — exact live tool contracts

## Start here

If you are setting up `personal-agent` from scratch, read [Getting Started](./getting-started.md) first.

Then use this order:

1. [Decision Guide](./decision-guide.md)
2. [How personal-agent works](./how-it-works.md)
3. [Knowledge Management System](./knowledge-system.md)

## Core concepts

- [Conversations](./conversations.md)
- [Conversation Context Attachments](./conversation-context.md)
- [Docs and Packages](./pages.md)
- [Tracked Work Packages](./projects.md)
- [Instruction Files, Docs, and Skills](./instructions-docs-skills.md)
- [Knowledge Management System](./knowledge-system.md)
- [Nodes](./nodes.md)
- [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)

## Interfaces

- [Web UI Guide](./web-ui.md)
- [iOS host-connected app design](./ios-host-app-plan.md)
- [Electron desktop app plan](./electron-desktop-app-plan.md)
- [Electron desktop app implementation spec](./electron-desktop-app-spec.md)
- [Command-Line Guide (`pa`)](./command-line.md)
- [Native UI Automation](./native-ui-automation.md)
- [Workspace](./workspace.md) — notes the removed in-app file browser and what to use instead
- [Release cycle](./release-cycle.md)
- [Repo layout](./repo-layout.md)

## System surfaces

- [Configuration](./configuration.md)
- [Daemon and Background Automation](./daemon.md)
- [MCP](./mcp.md)
- [Web server route modules](./web-server-routing.md)
- [Troubleshooting](./troubleshooting.md)
- [Reminders and Notification Delivery](../internal-skills/alerts/INDEX.md)
- [Shared Inbox Removal](../internal-skills/inbox/INDEX.md)

## Built-in internal skills

These pages live under `../internal-skills/` because they describe runtime features, not user-authored workflow skills:

- [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Reminders and Notification Delivery](../internal-skills/alerts/INDEX.md)
- [Shared Inbox Removal](../internal-skills/inbox/INDEX.md)
- [Skills and Runtime Capabilities](../internal-skills/skills-and-capabilities/INDEX.md)

## One place to go by question

| Question | Start here | Then go deeper in |
| --- | --- | --- |
| What should I use for this task? | [Decision Guide](./decision-guide.md) | feature-specific doc below |
| What is the overall durable-state model? | [How personal-agent works](./how-it-works.md) | [Configuration](./configuration.md), [Docs and Packages](./pages.md) |
| How is the repo organized, and where should new code live? | [Repo layout](./repo-layout.md) | [How personal-agent works](./how-it-works.md), [Web server route modules](./web-server-routing.md) |
| How do instruction files, docs, skills, and conversation context fit together? | [Knowledge Management System](./knowledge-system.md) | [Instruction Files, Docs, and Skills](./instructions-docs-skills.md), [Conversation Context Attachments](./conversation-context.md) |
| Where should durable knowledge live? | [Docs and Packages](./pages.md) | [Knowledge Management System](./knowledge-system.md) |
| How should a conversation keep stable KB context? | [Conversation Context Attachments](./conversation-context.md) | [Conversations](./conversations.md) |
| Where should structured long-running work live? | [Tracked Work Packages](./projects.md) | [Conversations](./conversations.md) |
| How do async outcomes, reminders, wakeups, and owning surfaces differ? | [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md) | [Shared Inbox Removal](../internal-skills/inbox/INDEX.md), [Reminders and Notification Delivery](../internal-skills/alerts/INDEX.md) |
| How do conversations behave? | [Conversations](./conversations.md) | [Web UI Guide](./web-ui.md) |
| How should I handle local repo files? | [Workspace](./workspace.md) | [Web UI Guide](./web-ui.md) |
| How do rendered outputs work? | [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md) | [Tracked Work Packages](./projects.md) |
| Which interface should I use day to day? | [Web UI Guide](./web-ui.md) | [Electron desktop app](./electron-desktop-app-plan.md), [iOS host-connected app design](./ios-host-app-plan.md), [Command-Line Guide (`pa`)](./command-line.md) |
| How should a phone or tablet connect to an existing PA host? | [iOS host-connected app design](./ios-host-app-plan.md) | [Web UI Guide](./web-ui.md), [Electron desktop app](./electron-desktop-app-plan.md) |
| How do MCP servers work here? | [MCP](./mcp.md) | [Command-Line Guide (`pa`)](./command-line.md) |

## Durable surfaces at a glance

| If you need to… | Use | Durable home |
| --- | --- | --- |
| Work with the agent right now | conversation / live session | local session state |
| Save durable knowledge | doc | vault markdown anywhere |
| Keep stable KB context in a thread | attached context doc(s) | conversation state + vault refs |
| Save reusable procedure | skill | `~/Documents/personal-agent/skills/<skill>/SKILL.md` |
| Save standing instructions | selected instruction file(s) | local config `instructionFiles[]` + vault docs |
| Track structured ongoing work | tracked work package | current implementation may use `~/Documents/personal-agent/projects/<id>/...` |
| Notice async results later | conversation attention / alerts | owning thread state + wakeup/alert state |
| Wake the same conversation later | conversation queue or reminder | live queue state or machine-local wakeup state |
| Run detached work now | durable background run | `~/.local/state/personal-agent/daemon/{runtime.db,runs/**}` |
| Run automation later or repeatedly | scheduled task | `~/.local/state/personal-agent/sync/{_tasks|tasks}/**` |
| Render inspectable output in a thread | conversation artifact | conversation artifact state |

## Read this if you are an agent

The highest-value rules are:

- use the smallest correct durable surface
- keep conversations for active work, not as the only durable store
- keep durable knowledge in the vault, not in machine-local session state
- prefer selected instruction files over magic KB folders
- prefer the built-in runtime tools over shelling out to `pa` from inside a conversation
- use internal skills for built-in feature behavior and `docs/` for product semantics
