# personal-agent docs

This folder is the user-facing guide to `personal-agent`.

It explains how to use the system and how to think about its durable features:

- conversations
- inbox/activity
- projects
- memory
- scheduled tasks
- daemon-backed background work
- Telegram gateway
- git-backed cross-machine sync
- profiles and shared behavior

These docs intentionally focus on product behavior and daily use. They are not package-level development docs.

## Start here

1. [Getting Started](./getting-started.md)
2. [How personal-agent works](./how-it-works.md)
3. [Web UI Guide](./web-ui.md)
4. [Command-Line Guide (`pa`)](./command-line.md)

## Durable features

- [Inbox and Activity](./inbox.md)
- [Projects](./projects.md)
- [Profiles, Memory, and Skills](./profiles-memory-skills.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Daemon and Background Automation](./daemon.md)
- [Sync Guide (`pa sync`)](./sync.md)
- [Gateway Guide (`pa gateway`)](./gateway.md)
- [Skills and Runtime Capabilities](./skills-and-capabilities.md)

## Reference

- [Configuration](./configuration.md)
- [Troubleshooting](./troubleshooting.md)
- [Scheduled task example](./examples/scheduled-task.task.md)

## Durable surfaces at a glance

| If you need to… | Use | Durable home |
| --- | --- | --- |
| Work interactively with the agent right now | conversation / live session | local runtime session state (optionally replicated via sync) |
| Notice something that happened asynchronously later | inbox/activity | local runtime inbox state under `~/.local/state/personal-agent/pi-agent/state/inbox/**` |
| Track long-running work, briefs, notes, files, blockers, and next steps across conversations | project | `~/.local/state/personal-agent/profiles/<profile>/agent/projects/<projectId>/PROJECT.yaml` + sibling project resources |
| Store durable behavior, knowledge, or reusable workflows | profiles, AGENTS, memory packages, skills | shared repo defaults + profile resources under `~/.local/state/personal-agent/profiles/<profile>/agent/**` + global memories under `~/.local/state/personal-agent/profiles/_memory/<memory-name>/MEMORY.md` |
| Run automation on a schedule | scheduled task + daemon | `~/.local/state/personal-agent/profiles/<profile>/agent/tasks/*.task.md` + local daemon state |
| Keep durable state in sync across machines | sync (`pa sync`) | git remote + `~/.local/state/personal-agent/sync/**` |
| Talk to the same agent through Telegram | gateway | local gateway state + the active profile |

## Read this if you are an agent

The most important model is:

- keep shared defaults in repo-managed profile files
- keep mutable durable/runtime state under `~/.local/state/personal-agent`
- use the right durable surface for the job

In practice:

- use **projects** for ongoing tracked work
- use **memory packages** for durable knowledge hubs and references
- use **skills** for reusable workflows
- use **inbox activity** for asynchronous outcomes worth noticing later
- use **scheduled tasks** for unattended automation
- do **not** store conversation/session ids in portable durable files

See [How personal-agent works](./how-it-works.md) for the full mental model.

## Pi-specific docs

`personal-agent` is a durable application layer around Pi. For Pi-specific features such as TUI APIs, SDK internals, keybindings, themes, prompt templates, and package behavior, use the Pi docs under:

- `../node_modules/@mariozechner/pi-coding-agent/README.md`
- `../node_modules/@mariozechner/pi-coding-agent/docs`
