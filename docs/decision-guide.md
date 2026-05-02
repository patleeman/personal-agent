# Decision Guide

Use this doc when you need to decide where something should live.

## Fast routing table

| Need | Use | Durable home | Avoid defaulting to |
| --- | --- | --- | --- |
| Work with the agent right now | conversation | session state | a doc or automation |
| Save reusable knowledge | doc | `<vault-root>` markdown | long chat history |
| Keep durable knowledge attached to one thread | attached context doc | conversation state + `<vault-root>` refs | repeating `@file` every turn |
| Save a reusable workflow | skill | `<vault-root>/skills/<skill>/SKILL.md` | ad hoc notes |
| Track durable structured work | project | `<vault-root>/projects/<projectId>/...` | a giant thread |
| Continue this conversation later | `conversation_queue` | conversation queue / wakeup state | reminder |
| Tell the user later | reminder | reminder + wakeup state | scheduled task |
| Start a detached shell command or agent task now | run tool | `<state-root>/daemon/runtime.db` + execution logs | scheduled task |
| Run something later or repeatedly | scheduled task / automation | daemon automation state | run |
| Produce inspectable rendered output in a thread | conversation artifact | conversation artifact state | screenshots pasted into chat |
| Save project-owned deliverables | project artifact | `<vault-root>/projects/<projectId>/artifacts/` | conversation artifact only |

## Durable knowledge split

Use this rule:

- **instruction file** — standing behavior and policy
- **doc** — reusable facts and reference material
- **skill** — reusable procedure (lives at `<vault-root>/skills/<skill>/SKILL.md`)
- **extension** — runtime behavior implemented in code
- **project** — durable structured ongoing work
- **conversation** — execution right now

## Async split

Use this rule:

- keep working in the same thread later → `conversation_queue`
- tell the human later → reminder
- detached shell commands or agent tasks should start now → `run`
- unattended work should happen later or on a schedule → `scheduled_task`

## Practical defaults

1. If it should still matter outside the current thread, put it in `<vault-root>`.
2. If the current thread needs it repeatedly, attach it as conversation context.
3. If the content is procedural, make it a skill.
4. If the work needs milestones, blockers, or durable status, make it a project.
5. If work should happen later, choose queue, reminder, run, or automation based on who needs to remember.

## Extensions

Extensions change what the runtime can do. Reach for an extension only when you need new tools, UI, event handling, runtime hooks, or permission behavior. If markdown is enough, do not start with an extension.

Examples from this repo: `note-policy`, `web-tools`, `daemon-run-orchestration-prompt`, `openai-native-compaction`, `gpt-apply-patch`.

## Things not to confuse

- a **project task** inside `state.yaml` is not a daemon scheduled task
- a **reminder** is not the same thing as a saved automation
- a **conversation artifact** is not the same thing as a durable project file
- a **doc** is not the same thing as an instruction file just because both are markdown
- a **skill** is not the same thing as an extension — skills are markdown workflows, extensions are code
- a **run** is the internal durable record; UI should say shell command, agent task, automation execution, wakeup, or conversation session

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Knowledge System](./knowledge-system.md)
- [Conversation Context](./conversation-context.md)
- [Conversations](./conversations.md)
- [Projects](./projects.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
