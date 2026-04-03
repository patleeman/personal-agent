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
- skill pages under `sync/_skills/<skill>/SKILL.md` — reusable workflows and procedures
- tool schemas / runtime prompt material — exact tool arguments and live agent capabilities
- `nodes.md`, `configuration.md`, and task docs — on-disk format and config details

## Start here

If you are setting up `personal-agent` from scratch, read [Getting Started](./getting-started.md) first.

Then start here for the operating model:

1. [Decision Guide](./decision-guide.md)
2. [How personal-agent works](./how-it-works.md)
3. [Knowledge Management System](./knowledge-system.md)
4. [Agent Tool Map](./agent-tool-map.md)

Those four pages should answer most agent questions quickly.

## Core concepts

- [Conversations](./conversations.md)
- [Async Attention and Wakeups](./async-attention.md)
- [Artifacts and Rendered Outputs](./artifacts.md)
- [Knowledge Management System](./knowledge-system.md)
- [Tracked Pages](./projects.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Pages](./pages.md)
- [Nodes](./nodes.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Runs](./runs.md)

## Interfaces

- [Web UI Guide](./web-ui.md)
- [Workspace](./workspace.md)
- [Command-Line Guide (`pa`)](./command-line.md)

## Integrations and system surfaces

- [Execution Targets](./execution-targets.md)
- [MCP](./mcp.md)
- [Alerts and Reminders](./alerts.md)
- [Inbox and Activity](./inbox.md)
- [Daemon and Background Automation](./daemon.md)
- [Web Server Route Modules](./web-server-routing.md)
- [Sync Guide (`pa sync`)](./sync.md)
- [Configuration](./configuration.md)
- [Troubleshooting](./troubleshooting.md)
- [Skills and Runtime Capabilities](./skills-and-capabilities.md)

## One place to go by question

| Question | Start here | Then go deeper in |
| --- | --- | --- |
| What should I use for this task? | [Decision Guide](./decision-guide.md) | feature-specific doc below |
| What is the overall durable-state model? | [How personal-agent works](./how-it-works.md) | [Pages](./pages.md), [Configuration](./configuration.md) |
| How does the knowledge-management system fit together? | [Knowledge Management System](./knowledge-system.md) | [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md), [Pages](./pages.md), [Tracked Pages](./projects.md) |
| How do unified durable pages work? | [Pages](./pages.md) | [Command-Line Guide (`pa`)](./command-line.md), [Knowledge Management System](./knowledge-system.md) |
| Where should ongoing work live? | [Tracked Pages](./projects.md) | [Conversations](./conversations.md) |
| Where should durable knowledge or preferences live? | [Knowledge Management System](./knowledge-system.md) | [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md), [Pages](./pages.md) |
| How do async outcomes, reminders, and wakeups differ? | [Async Attention and Wakeups](./async-attention.md) | [Inbox and Activity](./inbox.md), [Alerts and Reminders](./alerts.md) |
| How do conversations behave? | [Conversations](./conversations.md) | [Web UI Guide](./web-ui.md) |
| How do I work with local repo files in the UI? | [Workspace](./workspace.md) | [Web UI Guide](./web-ui.md) |
| How do rendered outputs and artifacts work? | [Artifacts and Rendered Outputs](./artifacts.md) | [Tracked Pages](./projects.md), [Web UI Guide](./web-ui.md) |
| Which agent tool should I use? | [Agent Tool Map](./agent-tool-map.md) | runtime tool schema |
| How do remote execution targets work? | [Execution Targets](./execution-targets.md) | [Command-Line Guide (`pa`)](./command-line.md) |
| How do MCP servers work here? | [MCP](./mcp.md) | [Command-Line Guide (`pa`)](./command-line.md) |

## Durable surfaces at a glance

| If you need to… | Use | Durable home |
| --- | --- | --- |
| Work interactively with the agent right now | conversation / live session | local runtime session state |
| Work on local repo files in the web UI | workspace | local filesystem / git-backed workspace state |
| Track ongoing work or reusable knowledge in the shared durable layer | page | `~/.local/state/personal-agent/sync/{notes,projects,_skills}/**` |
| Store durable behavior or preferences | `AGENTS.md`, settings, skill pages | repo defaults + `~/.local/state/personal-agent/sync/_profiles/<profile>/{AGENTS.md,settings.json,models.json}` + `sync/_skills/**` |
| Render inspectable outputs in the current conversation | conversation artifact | local conversation-artifact state |
| Notice async outcomes later without interrupting yourself | inbox/activity | local runtime inbox state |
| Interrupt yourself later or wake a conversation back up | reminder / alert / deferred resume | local runtime alert + wakeup state |
| Run detached work now | durable background run | `~/.local/state/personal-agent/daemon/runs/**` |
| Run automation on a schedule | scheduled task + daemon | `~/.local/state/personal-agent/sync/_tasks/*.task.md` + local daemon state |
| Keep durable state aligned across machines | sync (`pa sync`) | git-backed sync repo under `~/.local/state/personal-agent/sync/**` |

## Read this if you are an agent

The highest-value rules are:

- use the smallest correct durable surface
- keep conversations for active work, not durable storage
- use pages as the primitive for durable knowledge and tracked work, and skills for reusable procedures
- use activity for passive async attention and reminders/alerts for interrupting attention
- use scheduled tasks for later/scheduled automation and runs for detached work started now
- keep conversation ids and other machine-local bindings out of portable durable files
- prefer dedicated agent tools over shelling out to `pa` when those tools are available

## Pi-specific docs

`personal-agent` is a durable application layer around Pi. For Pi-specific features such as TUI APIs, SDK internals, keybindings, themes, prompt templates, and package behavior, use the Pi docs under:

- `../node_modules/@mariozechner/pi-coding-agent/README.md`
- `../node_modules/@mariozechner/pi-coding-agent/docs`
