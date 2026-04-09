# personal-agent docs

This folder is the operator and agent guide to `personal-agent`.

Use it for product behavior, durable-surface semantics, and interface-level guidance. Use runtime tool schemas for exact tool arguments, and use the internal skills for built-in feature behavior that lives outside `docs/`.

## Source-of-truth boundaries

Use these docs for:

- which durable surface to use
- where state lives
- how the CLI, web UI, daemon, and desktop shell fit together
- current product behavior

Use these other places for adjacent concerns:

- repo `AGENTS.md` — repo-specific engineering rules
- active profile `AGENTS.md` — user/profile behavior and durable preferences
- `../internal-skills/` — built-in runtime feature guides for runs, tasks, artifacts, inbox, reminders, and async attention
- `~/Documents/personal-agent/_skills/<skill>/SKILL.md` — reusable workflow skills
- tool schemas / runtime prompt material — exact live tool contracts

## Start here

If you are setting up `personal-agent` from scratch, read [Getting Started](./getting-started.md) first.

Then use this order:

1. [Decision Guide](./decision-guide.md)
2. [How personal-agent works](./how-it-works.md)
3. [Knowledge Management System](./knowledge-system.md)

## Core concepts

- [Conversations](./conversations.md)
- [Pages](./pages.md)
- [Tracked Pages](./projects.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Nodes](./nodes.md)
- [Knowledge Management System](./knowledge-system.md)
- [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)

## Interfaces

- [Web UI Guide](./web-ui.md)
- [Electron desktop app plan](./electron-desktop-app-plan.md)
- [Electron desktop app implementation spec](./electron-desktop-app-spec.md)
- [Command-Line Guide (`pa`)](./command-line.md)
- [Native UI Automation](./native-ui-automation.md)
- [Workspace](./workspace.md) — notes the removed in-app file browser and what to use instead
- [Release cycle](./release-cycle.md)
- [Protected downloads via Cloudflare R2](./protected-downloads.md)

## System surfaces

- [Configuration](./configuration.md)
- [Daemon and Background Automation](./daemon.md)
- [MCP](./mcp.md)
- [Web server route modules](./web-server-routing.md)
- [Troubleshooting](./troubleshooting.md)
- [Notification Center and Activity](../internal-skills/inbox/INDEX.md)
- [Reminders and Notification Delivery](../internal-skills/alerts/INDEX.md)

## Built-in internal skills

These pages live under `../internal-skills/` because they describe runtime features, not user-authored workflow skills:

- [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Notification Center and Activity](../internal-skills/inbox/INDEX.md)
- [Reminders and Notification Delivery](../internal-skills/alerts/INDEX.md)
- [Skills and Runtime Capabilities](../internal-skills/skills-and-capabilities/INDEX.md)

## One place to go by question

| Question | Start here | Then go deeper in |
| --- | --- | --- |
| What should I use for this task? | [Decision Guide](./decision-guide.md) | feature-specific doc below |
| What is the overall durable-state model? | [How personal-agent works](./how-it-works.md) | [Configuration](./configuration.md), [Pages](./pages.md) |
| How do notes, skills, projects, and AGENTS fit together? | [Knowledge Management System](./knowledge-system.md) | [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md) |
| Where should durable knowledge live? | [Pages](./pages.md) | [Knowledge Management System](./knowledge-system.md) |
| Where should ongoing work live? | [Tracked Pages](./projects.md) | [Conversations](./conversations.md) |
| How do async outcomes, reminders, wakeups, and inbox differ? | [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md) | [Notification Center and Activity](../internal-skills/inbox/INDEX.md), [Reminders and Notification Delivery](../internal-skills/alerts/INDEX.md) |
| How do conversations behave? | [Conversations](./conversations.md) | [Web UI Guide](./web-ui.md) |
| How should I handle local repo files? | [Workspace](./workspace.md) | [Web UI Guide](./web-ui.md) |
| How do rendered outputs work? | [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md) | [Tracked Pages](./projects.md) |
| Which interface should I use day to day? | [Web UI Guide](./web-ui.md) | [Electron desktop app](./electron-desktop-app-plan.md), [Command-Line Guide (`pa`)](./command-line.md) |
| How do MCP servers work here? | [MCP](./mcp.md) | [Command-Line Guide (`pa`)](./command-line.md) |

## Durable surfaces at a glance

| If you need to… | Use | Durable home |
| --- | --- | --- |
| Work with the agent right now | conversation / live session | local session state |
| Save durable knowledge | note page | `~/Documents/personal-agent/notes/**` |
| Save reusable procedure | skill page | `~/Documents/personal-agent/_skills/<skill>/SKILL.md` |
| Track ongoing work | tracked page | `~/Documents/personal-agent/projects/<id>/project.md` + `state.yaml` |
| Store durable behavior or profile preferences | `AGENTS.md`, profile `settings.json`, profile `models.json` | `~/Documents/personal-agent/_profiles/<profile>/` |
| Notice async results later | inbox activity / alerts | machine-local inbox state |
| Wake the same conversation later | reminder or deferred resume | machine-local wakeup state |
| Run detached work now | durable background run | `~/.local/state/personal-agent/daemon/{runtime.db,runs/**}` |
| Run automation later or repeatedly | scheduled task | `~/.local/state/personal-agent/sync/{_tasks|tasks}/**` |
| Render inspectable output in a thread | conversation artifact | conversation artifact state |

## Read this if you are an agent

The highest-value rules are:

- use the smallest correct durable surface
- keep conversations for active work, not durable storage
- keep durable knowledge in the vault, not in machine-local session state
- prefer the built-in runtime tools over shelling out to `pa` from inside a conversation
- use internal skills for built-in feature behavior and `docs/` for product semantics
