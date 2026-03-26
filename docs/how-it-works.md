# How personal-agent works

`personal-agent` is a durable application layer around Pi.

The core idea is simple:

- keep shared defaults in the repo
- keep mutable durable state under `~/.local/state/personal-agent`
- use the right durable surface for each kind of work

This page is the main mental model for both users and agents.

## The two kinds of state

### Shared defaults + mutable profile state

Shared defaults remain repo-managed.

Common repo-managed examples:

- `defaults/agent/settings.json`
- `extensions/**`
- `themes/**`

Mutable durable resources default to the synced durable-state home:

- `~/.local/state/personal-agent/sync/profiles/*.json`
- `~/.local/state/personal-agent/sync/agents/**`
- `~/.local/state/personal-agent/sync/settings/**`
- `~/.local/state/personal-agent/sync/models/**`
- `~/.local/state/personal-agent/sync/skills/**`
- `~/.local/state/personal-agent/sync/notes/**`
- `~/.local/state/personal-agent/sync/tasks/**`
- `~/.local/state/personal-agent/sync/projects/**`

### Local runtime state

This is mutable runtime state rooted at `~/.local/state/personal-agent`.

By default it is machine-local. If you enable git sync (`pa sync setup`), selected roots are replicated across devices.

Common examples:

- `~/.local/state/personal-agent/pi-agent-runtime/auth.json` (always machine-local)
- `~/.local/state/personal-agent/pi-agent-runtime/AGENTS.md` (generated runtime prompt materialization, machine-local)
- `~/.local/state/personal-agent/pi-agent/sessions/**` (optionally synced when sync is enabled)
- `~/.local/state/personal-agent/daemon/**` (machine-local)
- inbox activity and read-state under `~/.local/state/personal-agent/pi-agent/state/inbox/**` (machine-local)
- conversation-local link state such as conversation ↔ referenced project bindings

Use local runtime state for:

- live sessions
- auth
- logs
- spools
- process state
- queue state
- anything tied to one machine or one live conversation

## The main durable surfaces

### Conversation

A conversation is where interactive work happens.

Use a conversation for:

- back-and-forth work with the agent
- active coding or research sessions
- live problem solving

A conversation is not the right place to store durable project plans or reusable knowledge.

### Inbox / activity

The inbox is the durable attention surface for asynchronous things.

Use it for:

- scheduled task results
- deferred resumes
- background failures
- important asynchronous summaries worth noticing later

Do not use it as a second transcript.

See [Inbox and Activity](./inbox.md).

### Project

A project is the durable home for long-running work across conversations.

Use it for:

- goals
- status
- blockers
- recent progress
- a canonical project brief
- optional milestones
- project tasks
- appended notes
- attachments and project artifacts
- linked conversations shown by the UI

If the work should still make sense next week, it probably belongs in a project.

See [Projects](./projects.md).

### Nodes

Nodes are the unified durable file model for notes, projects, and skills.

Use them for:

- durable behavior fragments in `sync/agents/**`
- reusable workflow skill nodes in `sync/skills/**`
- durable note nodes in `sync/notes/<note-id>/INDEX.md` plus package-local `references/`
- structured project nodes in `sync/projects/<project-id>/{INDEX.md,state.yaml}`

Note nodes are not the same as project nodes.

See [Profiles, Memory, and Skills](./profiles-memory-skills.md).

### Scheduled task

A scheduled task is unattended automation.

Use it when something should run later or on a schedule, even when no conversation is open.

Examples:

- morning reports
- recurring checks
- reminders surfaced in the inbox
- background prompts that create inbox activity

See [Scheduled Tasks](./scheduled-tasks.md).

### Daemon

The daemon is the shared background worker.

It is what makes unattended behavior reliable.

Use it for:

- scheduled tasks
- deferred resume
- background event handling

See [Daemon and Background Automation](./daemon.md).

### Sync

Sync keeps selected durable state aligned across devices using a git-backed state repo and the daemon sync module.

Use it when you want profile/node/project/session durability across machines.

See [Sync Guide](./sync.md).

## Choose the right feature

| Need | Best fit | Why |
| --- | --- | --- |
| Work with the agent right now | conversation | best place for active interaction |
| Track a real piece of ongoing work | project | durable plan, brief, notes, files, blockers, status, and linked conversations |
| Save something the agent should know later | note node / skill node / AGENTS | reusable durable knowledge |
| Notice async outcomes later | inbox/activity | attention surface, not a transcript |
| Run something on a schedule | scheduled task | unattended automation |
| Keep durable state aligned across devices | sync (`pa sync`) | git-backed state sharing under `~/.local/state/personal-agent/sync/**` |

## A useful rule of thumb

Think about the system this way:

- **conversation** = active work
- **project** = durable work plan
- **notes + skills** = durable knowledge and reusable procedures
- **project nodes** = durable tracked work
- **inbox** = durable attention for async events
- **scheduled task** = durable automation definition
- **sync** = cross-machine durable-state replication
- **daemon** = background runner

## Conversation locality boundary

This is an important rule for agents.

Portable durable files should not store conversation ids or session ids.

That means:

- do not put conversation ids in project `state.yaml` or `INDEX.md`
- do not put conversation ids in note-node frontmatter, state, or metadata
- do not key repo files by conversation id

If you need conversation-local bindings, keep them in local runtime state.

Portable files should point to stable things such as:

- project ids
- task ids
- file paths
- timestamps
- summaries

## How the pieces work together

A common workflow looks like this:

1. Start in a conversation through the web UI or TUI.
2. Create or reference a project if the work is ongoing.
3. Use the active profile's AGENTS, skill nodes, and shared note nodes to guide behavior and bring in durable knowledge.
4. If the work should happen later, put it into a scheduled task.
5. When asynchronous work finishes, the result shows up in the inbox.

That is the intended shape of the product.

## Related docs

- [Getting Started](./getting-started.md)
- [Web UI Guide](./web-ui.md)
- [Inbox and Activity](./inbox.md)
- [Projects](./projects.md)
- [Profiles, Memory, and Skills](./profiles-memory-skills.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Sync Guide](./sync.md)
