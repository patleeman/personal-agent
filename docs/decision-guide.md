# Decision Guide

This is the fast routing guide for `personal-agent`.

If you are not sure which surface to use, start here.

## The shortest version

- **conversation** = active work right now
- **note page** = reusable knowledge
- **skill page** = reusable procedure
- **tracked page** = ongoing work with durable status
- **conversation attention / alert** = async work that should surface later on an owning thread
- **reminder** = tell me later
- **conversation queue** = continue this conversation later
- **run** = detached work started now
- **scheduled task** = work that should run later or on a schedule

## Use this, not that

| If you need to… | Use | Durable home | Do not default to |
| --- | --- | --- | --- |
| Work with the agent right now | conversation | session state | note page or detached async state |
| Save reusable knowledge | note page | `~/Documents/personal-agent/notes/**` | long conversation history |
| Save reusable workflow instructions | skill page | `~/Documents/personal-agent/_skills/<skill>/SKILL.md` | `AGENTS.md` or ad hoc notes |
| Keep ongoing work alive across conversations | tracked page | `~/Documents/personal-agent/projects/<id>/project.md` | a top-level note or a giant thread |
| Save durable behavior or profile defaults | `AGENTS.md`, profile settings, models | `~/Documents/personal-agent/_profiles/<profile>/` | notes or conversations |
| Surface async results without interrupting much | conversation attention on the owning thread | owning thread state | reminders by default |
| Tell the user later | reminder | machine-local wakeup + alert state | scheduled task if no automation is needed |
| Continue the same conversation later | conversation queue | live queue state or machine-local wakeup state | reminder |
| Run something detached right now | durable background run | `~/.local/state/personal-agent/daemon/{runtime.db,runs/**}` | scheduled task |
| Run something later or repeatedly | scheduled task | `~/.local/state/personal-agent/sync/{_tasks|tasks}/**` | run |
| Produce a rendered report or diagram in the current thread | conversation artifact | conversation artifact state | tracked-page artifact directory first |
| Work on repo files | editor / terminal / file manager | local filesystem | trying to turn notes into a file browser |

## Common calls

### Conversation vs note vs tracked page vs skill

Use a **conversation** when the work is happening now.

Use a **note page** when the content should still be reusable outside the current task.

Use a **tracked page** when the work has durable status, next steps, blockers, or attachments.

Use a **skill page** when the content is a reusable procedure that should be invoked again later.

### Activity vs reminder vs conversation queue

Use **conversation attention** when the result should be visible later but does not need to interrupt.

Use a **reminder** when a human-facing nudge matters.

Use **conversation queue** when the right outcome is “wake this conversation back up” or “queue the next step after this turn.”

### Run vs scheduled task

Use a **run** when the work starts now and should continue detached from the current thread.

Use a **scheduled task** when the work should happen later, once, or repeatedly.

## Practical rules

1. If it is reusable knowledge, put it in the vault.
2. If it is ongoing work, give it a tracked page.
3. If it is just active execution, keep it in the conversation.
4. If it should happen later, choose reminder, conversation queue, run, or scheduled task based on who must remember.
5. If you only need local file edits, use your editor.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Knowledge Management System](./knowledge-system.md)
- [Conversations](./conversations.md)
- [Tracked Pages](./projects.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
