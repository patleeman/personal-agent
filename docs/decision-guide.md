# Decision Guide

This page is the fast routing guide for agents using `personal-agent`.

If you are not sure which surface to use, start here.

## The shortest version

- **conversation** = active work right now
- **project** = durable tracked work
- **note** = durable reusable knowledge
- **skill** = durable reusable procedure
- **activity / inbox** = passive async attention
- **reminder / alert** = interrupting async attention
- **deferred resume** = continue this conversation later without the user remembering
- **run** = detached work started now
- **scheduled task** = work that should run later or on a schedule

## Use this, not that

| If you need to… | Use | Durable home | Do not default to |
| --- | --- | --- | --- |
| Work with the agent right now | conversation | conversation/session state | inbox, note, or project as the primary work surface |
| Keep ongoing work alive across conversations | project | `sync/projects/<id>/` | top-level note or long conversation history |
| Save reusable knowledge or references | note page | `sync/nodes/<id>/` tagged `type:note` | project docs or random conversation text |
| Save reusable workflow instructions | skill page | `sync/nodes/<id>/` tagged `type:skill` | AGENTS or ad hoc notes |
| Save durable behavior or preferences | `AGENTS.md` or profile settings | repo/profile durable resources | note pages or project state |
| Surface async work later without interrupting | activity / inbox | local inbox state | alerts by default |
| Tell the user later | reminder / alert | local alert + wakeup state | scheduled task if no automation is needed |
| Continue the same conversation later without user input | deferred resume | local wakeup state | reminder |
| Run something detached right now | durable background run | `daemon/runs/<run-id>/` | scheduled task |
| Run something later or repeatedly | scheduled task | `sync/tasks/*.task.md` | run |
| Work on local repo files in the web UI | workspace | local repo/filesystem view | project docs or notes |
| Produce a rendered report or diagram in the current thread | conversation artifact | conversation artifact state | project artifact directory as the first stop |
| Keep a file with a specific project | project attachment or project artifact | `sync/projects/<id>/attachments|artifacts/` | top-level note assets |
| Offload a conversation to another machine | execution target | machine-local execution-target config | scheduled task or run |
| Call external tool servers through MCP | MCP server config + MCP calls | MCP config + auth state | hand-rolled shell scripts by default |

## Work surfaces

### Conversation vs project vs note vs skill

Use a **conversation** for active interaction.

Promote the work into a **project** when it needs:

- durable status
- blockers or milestones
- project notes or files
- continuity across conversations

Use a **note** when the content is reusable outside one workstream.

Use a **skill** when the content is a reusable procedure the agent should follow.

Use **AGENTS.md** when the content is durable behavior, user preference, or standing policy.

## Async attention surfaces

Use **activity / inbox** when something happened and should be visible later, but does not need to interrupt.

Use **reminder / alert** when the user wants an interrupting callback.

Use **deferred resume** when the agent should continue later in the same conversation, even if the user forgets.

If async work belongs to an existing conversation, keep the durable result with that conversation and surface the conversation in attention flows.

## Automation surfaces


Use **runs** for detached local work you want to start now.

Use **scheduled tasks** for unattended work that should happen later or repeatedly.

A simple rule:

- **now, detached** → run
- **later or recurring** → scheduled task

## Local vs portable state

Portable durable files should store stable things like:

- ids
- summaries
- paths
- timestamps

Portable durable files should **not** store:

- conversation ids
- session ids
- machine-local bindings
- local daemon/runtime state

If a value only makes sense on one machine or one live conversation, keep it in local runtime state.

## Where Patrick-specific preferences live

When you need Patrick's preferences or standing instructions, look in this order:

1. active profile `AGENTS.md`
2. repo `AGENTS.md`
3. relevant skill pages

The docs explain the product model. `AGENTS.md` explains how this particular agent should behave.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Knowledge Management System](./knowledge-system.md)
- [Conversations](./conversations.md)
- [Async Attention and Wakeups](./async-attention.md)
- [Workspace](./workspace.md)
- [Artifacts and Rendered Outputs](./artifacts.md)
- [Projects](./projects.md)
- [Profiles, AGENTS, Notes, and Skills](./profiles-memory-skills.md)
- [Agent Tool Map](./agent-tool-map.md)
