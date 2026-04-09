# personal-agent docs

This folder is the agent and operator guide to `personal-agent`.

Its job is to explain:

- how to think about each durable surface
- when to use each feature
- where the durable record lives
- which interface or tool to reach for

This is no longer just a user-facing tour. It is the operating manual for agents working inside `personal-agent`.

## Source of truth boundaries

Use the docs for product behavior and feature semantics.

Use these other places for adjacent concerns:

- active profile `AGENTS.md` — Patrick-specific preferences, durable behavior, standing instructions
- repo `AGENTS.md` — repo-specific development rules
- `../internal-skills/` — agent-facing internal skills for built-in personal-agent features and tool behavior
- skill pages under `sync/_skills/<skill>/SKILL.md` — reusable workflows and procedures
- tool schemas / runtime prompt material — exact tool arguments and live agent capabilities
- `nodes.md`, `configuration.md`, and task docs — on-disk format and config details

## Start here

If you are setting up `personal-agent` from scratch, read [Getting Started](./getting-started.md) first.

Then start here for the operating model:

1. [Decision Guide](./decision-guide.md)
2. [How personal-agent works](./how-it-works.md)
3. [Knowledge Management System](./knowledge-system.md)

Those three pages should answer most agent questions quickly.

## Core concepts

- [Conversations](./conversations.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
- [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md)
- [Knowledge Management System](./knowledge-system.md)
- [Tracked Pages](./projects.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Pages](./pages.md)
- [Nodes](./nodes.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
- [Runs](../internal-skills/runs/INDEX.md)

## Built-in internal skills

These pages moved out of `docs/` and into `../internal-skills/` so built-in runtime feature guidance has a clearer home:

- [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Notification Center and Activity](../internal-skills/inbox/INDEX.md)
- [Reminders and Notification Delivery](../internal-skills/alerts/INDEX.md)
- [Skills and Runtime Capabilities](../internal-skills/skills-and-capabilities/INDEX.md)

## Interfaces

- [Web UI Guide](./web-ui.md)
- [Electron desktop app plan](./electron-desktop-app-plan.md)
- [Electron desktop app implementation spec](./electron-desktop-app-spec.md)
- [Workspace](./workspace.md) — notes the removed in-app file browser and what to use instead
- [Command-Line Guide (`pa`)](./command-line.md)
- [Native UI Automation](./native-ui-automation.md)

## Integrations and system surfaces

- [MCP](./mcp.md)
- [Reminders and Notification Delivery](../internal-skills/alerts/INDEX.md)
- [Notification Center and Activity](../internal-skills/inbox/INDEX.md)
- [Daemon and Background Automation](./daemon.md)
- [Web Server Route Modules](./web-server-routing.md)
- [Configuration](./configuration.md)
- [Troubleshooting](./troubleshooting.md)
- [Skills and Runtime Capabilities](../internal-skills/skills-and-capabilities/INDEX.md)

## One place to go by question

| Question | Start here | Then go deeper in |
| --- | --- | --- |
| What should I use for this task? | [Decision Guide](./decision-guide.md) | feature-specific doc below |
| What is the overall durable-state model? | [How personal-agent works](./how-it-works.md) | [Pages](./pages.md), [Configuration](./configuration.md) |
| How does the knowledge-management system fit together? | [Knowledge Management System](./knowledge-system.md) | [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md), [Pages](./pages.md), [Tracked Pages](./projects.md) |
| How do unified durable pages work? | [Pages](./pages.md) | [Knowledge Management System](./knowledge-system.md), [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md) |
| Where should ongoing work live? | [Tracked Pages](./projects.md) | [Conversations](./conversations.md) |
| Where should durable knowledge or preferences live? | [Knowledge Management System](./knowledge-system.md) | [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md), [Pages](./pages.md) |
| How do async outcomes, reminders, and wakeups differ? | [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md) | [Notification Center and Activity](../internal-skills/inbox/INDEX.md), [Reminders and Notification Delivery](../internal-skills/alerts/INDEX.md) |
| How do conversations behave? | [Conversations](./conversations.md) | [Web UI Guide](./web-ui.md) |
| How should I handle local repo files now? | [Workspace](./workspace.md) | [Web UI Guide](./web-ui.md) |
| How do rendered outputs and artifacts work? | [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md) | [Tracked Pages](./projects.md), [Web UI Guide](./web-ui.md) |
| Which agent tool should I use? | tool schema + matching internal skill below | runtime tool schema |
| How do MCP servers work here? | [MCP](./mcp.md) | [Command-Line Guide (`pa`)](./command-line.md) |

## Durable surfaces at a glance

| If you need to… | Use | Durable home |
| --- | --- | --- |
| Work interactively with the agent right now | conversation / live session | local runtime session state |
| Work on local repo files | your editor / file manager | local filesystem / git-backed repo state |
| Track ongoing work or reusable knowledge in the shared durable layer | page | `~/Documents/personal-agent/{notes,projects,_skills}/**` |
| Store durable behavior or preferences | `AGENTS.md`, settings, skill pages | repo defaults + `~/Documents/personal-agent/_profiles/<profile>/{AGENTS.md,settings.json,models.json}` + `~/Documents/personal-agent/_skills/**` |
| Render inspectable outputs in the current conversation | conversation artifact | local conversation-artifact state |
| Notice async outcomes later without interrupting yourself | notification center / activity | local runtime inbox state |
| Interrupt yourself later or wake a conversation back up | reminder / notification / deferred resume | local runtime wakeup + notification state |
| Run detached work now | durable background run | `~/.local/state/personal-agent/daemon/runtime.db` + `daemon/runs/<run-id>/{output.log,result.json}` |
| Run automation on a schedule | scheduled task + daemon | `~/.local/state/personal-agent/daemon/runtime.db` + `daemon/runs/<run-id>/{output.log,result.json}` |

## Read this if you are an agent

The highest-value rules are:

- use the smallest correct durable surface
- keep conversations for active work, not durable storage
- use pages as the primitive for durable knowledge and tracked work, and skills for reusable procedures
- use activity for passive async attention and notification-center delivery when something should be harder to miss
- use scheduled tasks for later/scheduled automation and runs for detached work started now
- keep conversation ids and other machine-local bindings out of portable durable files
- prefer dedicated agent tools over shelling out to `pa` when those tools are available

## Pi-specific docs

`personal-agent` is a durable application layer around Pi. For Pi-specific features such as TUI APIs, SDK internals, keybindings, themes, prompt templates, and package behavior, use the Pi docs under:

- `../node_modules/@mariozechner/pi-coding-agent/README.md`
- `../node_modules/@mariozechner/pi-coding-agent/docs`
