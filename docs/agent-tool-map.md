# Agent Tool Map

This page maps `personal-agent` product concepts to the preferred agent tools in a live session.

Use this when you know what you want to accomplish but are not sure which tool should own it.

## Main rule

When a dedicated agent tool exists, prefer it over shelling out to `pa`.

Use the CLI mainly for:

- human-driven terminal workflows
- debugging outside a live tool-enabled agent session
- inspection when no dedicated tool exists

## Preferred tool by job

| Job | Preferred tool | Durable home | Notes |
| --- | --- | --- | --- |
| Track ongoing work, status, blockers, milestones, project notes | `project` | project node under `sync/projects/**` | use projects for durable tracked work |
| Find or create durable note nodes | `note` | note nodes under `sync/notes/**` | find/show before new |
| Create passive async attention items | `activity` | local inbox/activity state | use for async outcomes worth noticing later |
| Schedule unattended automation | `scheduled_task` | `sync/tasks/*.task.md` + daemon state | use for later or recurring work |
| Start detached work now | `run` | `daemon/runs/**` | use for immediate detached shell or agent work |
| Continue this conversation later without user input | `deferred_resume` | local wakeup state | use for agent-owned continue-later behavior |
| Remind the user later | `reminder` | local alert + wakeup state | use for user-requested tell-me-later behavior |

| Ask for a specific user choice or answer | `ask_user_question` | conversation interaction | use focused questions and then stop for input |
| Pause until the user replies or approves | `wait_for_user` | conversation interaction | use when you truly need input before continuing |
| Create or update rendered reports, diagrams, or HTML views | `artifact` | conversation artifact state | use for rendered outputs; project artifacts are a separate durable file surface |
| Read files or inspect repo state | `read`, `bash` | repo/filesystem | prefer `read` over shell `cat` |
| Edit an existing file precisely | `edit` | repo/filesystem | prefer targeted edits |
| Create a new file or replace a whole file | `write` | repo/filesystem | use for new docs or full rewrites |

## Product concepts that are not their own tool

Some important durable surfaces are still file-based concepts rather than dedicated tools.

### `AGENTS.md`

Use `AGENTS.md` for:

- durable behavior
- standing instructions
- user preferences
- operating policy

There is no dedicated `agents` tool in this environment. Edit the relevant `AGENTS.md` file directly when that is the right durable home.

### Skill nodes

Use skill nodes for reusable procedures.

There is no dedicated `skill` CRUD tool in this environment. Edit `skills/<id>/INDEX.md` and supporting files directly when you need to create or update a skill.

## Quick routing rules

- **project state** → `project`
- **durable knowledge** → `note`
- **passive async attention** → `activity`
- **remind me later** → `reminder`
- **continue later without asking me** → `deferred_resume`
- **run later / every day / on a schedule** → `scheduled_task`
- **start detached work now** → `run`
- **workflow steps inside this thread** → deleted
- **need a rendered report or diagram** → `artifact`
- **need user input before continuing** → `ask_user_question` or `wait_for_user`

## Relationship to the docs

Use this page to choose a tool.

Use the feature docs to decide whether the underlying product surface is correct:

- [Decision Guide](./decision-guide.md)
- [Knowledge Management System](./knowledge-system.md)
- [Conversations](./conversations.md)
- [Async Attention and Wakeups](./async-attention.md)
- [Workspace](./workspace.md)
- [Artifacts and Rendered Outputs](./artifacts.md)
- [Projects](./projects.md)
- [Profiles, AGENTS, Notes, and Skills](./profiles-memory-skills.md)
