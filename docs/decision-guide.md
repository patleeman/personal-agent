# Decision Guide

This is the fast routing guide for `personal-agent`.

If you are not sure which surface to use, start here.

## The shortest version

- **conversation** = active work right now
- **doc** = reusable knowledge
- **attached context doc** = durable KB context for one conversation
- **skill** = reusable procedure
- **tracked work package** = optional structured wrapper for ongoing work
- **conversation attention / alert** = async work that should surface later on an owning thread
- **reminder** = tell me later
- **conversation queue** = continue this conversation later
- **run** = detached work started now
- **scheduled task / automation** = saved scheduled prompt that should run later or on a schedule

## Use this, not that

| If you need to… | Use | Durable home | Do not default to |
| --- | --- | --- | --- |
| Work with the agent right now | conversation | session state | a doc or detached async state |
| Save reusable knowledge | doc | vault markdown anywhere | long conversation history |
| Keep stable KB context attached to a thread | attached context doc(s) | conversation state + vault refs | repeating `@foo.md` every turn |
| Save reusable workflow instructions | skill | `~/Documents/personal-agent/skills/<skill>/SKILL.md` | ad hoc docs or conversation text |
| Save durable behavior or standing instructions | selected instruction file(s) | local config `instructionFiles[]` + vault docs | conversation text |
| Keep structured ongoing work with status/validation | tracked work package | current implementation may use `~/Documents/personal-agent/projects/<id>/...` | a giant thread |
| Surface async results without interrupting much | conversation attention on the owning thread | owning thread state | reminders by default |
| Tell the user later | reminder | machine-local wakeup + alert state | scheduled task if no automation is needed |
| Continue the same conversation later | conversation queue | live queue state or machine-local wakeup state | reminder |
| Run something detached right now | durable background run | `~/.local/state/personal-agent/daemon/{runtime.db,runs/**}` | scheduled task |
| Save a scheduled prompt that runs later or repeatedly | scheduled task / automation | `~/.local/state/personal-agent/daemon/runtime.db` | run |
| Produce a rendered report or diagram in the current thread | conversation artifact | conversation artifact state | copying screenshots into chat |
| Work on repo files | editor / terminal / file manager | local filesystem | trying to turn the KB into a file browser |

## Common calls

### Conversation vs doc vs skill vs tracked work

Use a **conversation** when the work is happening now.

Use a **doc** when the content should still be reusable outside the current task.

Use an **attached context doc** when that reusable content should stay in scope for one specific thread.

Use a **skill** when the content is a reusable procedure that should be invoked again later.

Use a **tracked work package** only when the work needs durable structured state such as milestones, blockers, or validation.

### Activity vs reminder vs conversation queue

Use **conversation attention** when the result should be visible later but does not need to interrupt.

Use a **reminder** when a human-facing nudge matters.

Use **conversation queue** when the right outcome is “wake this conversation back up” or “queue the next step after this turn.”

Use `conversation_queue` with `after_turn` for transient immediate follow-up. Use `delay` or `at` when you want that continuation saved as a durable automation.

### Run vs scheduled task

Use a **run** when the work starts now and should continue detached from the current thread.

Use a **scheduled task / automation** when the prompt should happen later, once, or repeatedly.

`run.start_agent` with no schedule still starts work immediately. `run.start_agent` with `defer`, `at`, or `cron` now creates a saved automation instead of a detached run record.

## Practical rules

1. If it is reusable knowledge, put it in a doc.
2. If the thread needs that knowledge repeatedly, attach the doc to the conversation.
3. If it is reusable procedure, make it a skill.
4. If it only needs structured status after that, use a tracked work package.
5. If it should happen later, choose reminder, conversation queue, run, or scheduled task based on who must remember.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Knowledge Management System](./knowledge-system.md)
- [Conversations](./conversations.md)
- [Conversation Context Attachments](./conversation-context.md)
- [Tracked Work Packages](./projects.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
