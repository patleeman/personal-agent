# Conversations

Conversations are the primary live work surface in `personal-agent`.

Use a conversation when you want to work with the agent now.

A conversation is not the canonical home for long-term knowledge, reusable procedures, or standing behavior rules.

## What belongs in a conversation

Good fits:

- prompts and replies
- tool use
- live file work
- working-directory-specific execution
- one-shot `@` mentions of docs/files
- persistent attached context docs
- conversation artifacts
- checkpoint commits and review snapshots tied to the thread, including review comments saved on the checkpoint itself
- short-lived execution context

Bad fits:

- the only copy of reusable knowledge
- the only copy of a durable plan
- reusable workflow procedures
- standing instruction docs selected outside the conversation

Those belong in vault docs, skill packages, and selected instruction files.

## Working context

A conversation can carry:

- a current working directory
- selected model / thinking / service-tier preferences
- binary or editor-style attachments
- conversation artifacts
- one-shot `@` mentions for the current turn
- persistent attached docs that stay in scope across turns
- an optional auto mode toggle in the composer controls for hands-off follow-up
- live composer controls for direct send, queued steer / follow-up prompts, and temporary parallel fork prompts that reintegrate back into the main thread when the active turn finishes

That is useful execution context, but it still should not replace the durable vault.

## One-shot mention vs persistent attachment

Use this split:

- `@doc-or-file` = include for this turn
- attached doc = keep linked to the conversation until removed

That keeps the intent obvious.

## Attached docs

The next step for the conversation model is a lightweight attached-doc shelf above the composer.

That shelf should show the docs currently attached to the thread and make it easy to:

- see what durable context is in play
- remove docs that no longer matter
- attach another doc without repeating it every turn

Attached docs should be stored as references, not pasted snapshots.

## Prompt budgeting

Attached docs should not blindly dump their full bodies into every turn.

A better default is:

- inject title, path, and summary
- include short excerpts when useful
- let the agent load more when needed

Otherwise the conversation turns into an expensive soup bowl.

## Auto mode

When auto mode is enabled, the conversation backend treats it as durable conversation state and runs a hidden review turn after each visible assistant turn.

That hidden controller step should prefer continuing while useful work remains, and only stop auto mode when the task is complete for the user's request or blocked on a real dependency or missing user input.
If overflow compaction interrupts one of those hidden auto-mode turns, the backend schedules a delayed recovery check and re-requests the hidden review if the session stays idle instead of resuming cleanly.

## Async follow-through from a conversation

A conversation often creates or receives other durable async surfaces:

- **reminder** — tell me later
- **conversation queue** — wake this conversation later or queue the next step after the current turn
- **run** — detached work started now
- **scheduled task** — future or recurring automation
- **activity / alert** — later attention outside the active conversation

## Practical rule

Use the conversation for the execution itself.

If the work needs durable knowledge, keep that in docs and attach the relevant docs to the thread when they should stay in scope.

## Related docs

- [Conversation Context Attachments](./conversation-context.md)
- [Decision Guide](./decision-guide.md)
- [Knowledge Management System](./knowledge-system.md)
- [Web UI Guide](./web-ui.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
