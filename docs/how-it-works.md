# How personal-agent works

`personal-agent` is a durable application layer around Pi.

The core idea is simple:

- keep shared defaults in the repo
- keep mutable durable state under `~/.local/state/personal-agent`
- use the right durable surface for each kind of work

This page is the main mental model for both users and agents.

If you need a faster routing layer first, read [Decision Guide](./decision-guide.md). If you need the live-tool mapping, read [Agent Tool Map](./agent-tool-map.md).

## The two kinds of state

### Shared defaults + mutable profile state

Shared defaults remain repo-managed.

Common repo-managed examples:

- `defaults/agent/settings.json`
- `extensions/**`
- `themes/**`

Mutable durable knowledge resources default to the external vault at `~/Documents/personal-agent`:

- `~/Documents/personal-agent/_profiles/<profile>/AGENTS.md`
- `~/Documents/personal-agent/_profiles/<profile>/settings.json`
- `~/Documents/personal-agent/_profiles/<profile>/models.json`
- `~/Documents/personal-agent/{notes,projects,_skills}/**`

The managed sync repo under `~/.local/state/personal-agent/sync/` still holds app-managed durable state such as tasks and optional synced conversation data.

### Local runtime state

This is mutable runtime state rooted at `~/.local/state/personal-agent`.

By default it is machine-local. If you enable git sync (`pa sync setup`), selected roots are replicated across devices.

Common examples:

- `~/.local/state/personal-agent/pi-agent-runtime/auth.json` (always machine-local)
- `~/.local/state/personal-agent/pi-agent-runtime/AGENTS.md` (generated runtime prompt materialization, machine-local)
- `~/.local/state/personal-agent/pi-agent-runtime/notes/**` (legacy machine-local note migration input only, not a supported durable store)
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

See [Tracked Pages](./projects.md).

### Pages

Pages are the unified durable product model for notes, projects, and skills.

Use them for:

- profile behavior files in the vault at `_profiles/<profile>/AGENTS.md`
- reusable workflow skill pages backed by `_skills/<skill>/SKILL.md`
- durable note pages backed by `notes/**` as `notes/<id>.md` or `notes/<id>/INDEX.md`, plus package-local `references/` when needed
- structured tracked pages backed by `projects/<projectId>/project.md` plus supporting files

The user-facing model is pages, and the on-disk durable model now matches that vault layout directly.

See [Pages](./pages.md) and [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md).

### Scheduled task

A scheduled task is unattended automation.

Use it when something should run later or on a schedule, even when no conversation is open.

Examples:

- morning reports
- recurring checks
- background prompts that create inbox activity
- scheduled callbacks that later wake a conversation back up

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
| Track a real piece of ongoing work | tracked page | durable plan, brief, pages, files, blockers, status, and linked conversations |
| Save something the agent should know later | page / skill page / AGENTS | reusable durable knowledge |
| Interrupt yourself later for a reminder or callback | reminder / alert | conversation-bound wakeup plus a disruptive attention surface |
| Notice async outcomes later without interrupting yourself | inbox/activity | passive attention surface, not a transcript |
| Run something on a schedule | scheduled task | unattended automation |
| Keep durable state aligned across devices | sync (`pa sync`) | git-backed state sharing under `~/.local/state/personal-agent/sync/**` |

## A useful rule of thumb

Think about the system this way:

- **conversation** = active work
- **page** = durable knowledge or tracked work
- **skills** = reusable procedures
- **tracked pages** = durable tracked work
- **alerts** = interrupting reminders and callbacks that need acknowledgement
- **inbox** = durable passive attention for async events
- **scheduled task** = durable automation definition
- **sync** = cross-machine durable-state replication
- **daemon** = background runner

## Conversation locality boundary

This is an important rule for agents.

Portable durable files should not store conversation ids or session ids.

That means:

- do not put conversation ids in tracked-page `state.yaml` or `project.md`
- do not put conversation ids in reusable-page frontmatter, state, or metadata
- do not key repo files by conversation id

If you need conversation-local bindings, keep them in local runtime state.

Portable files should point to stable things such as:

- page ids
- task ids
- file paths
- timestamps
- summaries

## How the pieces work together

A common workflow looks like this:

1. Start in a conversation through the web UI or TUI.
2. Create or reference a tracked page if the work is ongoing.
3. Use the active profile's AGENTS, skill pages, and shared pages to guide behavior and bring in durable knowledge.
4. If the work should happen later, put it into a scheduled task.
5. When asynchronous work finishes, the result shows up in the inbox or, for higher-signal reminders/callbacks, as an alert tied back to the originating conversation.

That is the intended shape of the product.

## Related docs

- [Decision Guide](./decision-guide.md)
- [Knowledge Management System](./knowledge-system.md)
- [Agent Tool Map](./agent-tool-map.md)
- [Getting Started](./getting-started.md)
- [Conversations](./conversations.md)
- [Async Attention and Wakeups](./async-attention.md)
- [Workspace](./workspace.md)
- [Artifacts and Rendered Outputs](./artifacts.md)
- [Web UI Guide](./web-ui.md)
- [Inbox and Activity](./inbox.md)
- [Tracked Pages](./projects.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Runs](./runs.md)
- [Sync Guide](./sync.md)
