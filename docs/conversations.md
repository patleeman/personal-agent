# Conversations

Conversations are the primary live work surface.

Use a conversation when work is happening now.

## What belongs in a conversation

Good fits:

- prompts and replies
- tool use
- repo/file work in the current cwd
- one-shot `@` mentions
- attached context docs
- attachments, drawings, and images
- conversation artifacts
- checkpoints tied to the thread
- short-lived execution state

Bad fits:

- the only copy of reusable knowledge
- the only durable copy of a plan or status record
- reusable workflow instructions
- standing policy that should be selected outside the thread

## Conversation state that matters

A conversation can carry:

- working directory
- model and reasoning preferences
- attached context docs
- binary attachments
- artifacts and checkpoints
- queued follow-up work
- auto mode state

Durable session files live under `<state-root>/sync/pi-agent/sessions/`.

Attached context-doc references live under `<state-root>/pi-agent/state/conversation-context-docs/`.

## One thread, many durable connections

A conversation often owns or links to other durable surfaces:

- docs in `<vault-root>`
- projects in `<vault-root>/projects/`
- reminders and queue items
- daemon-backed runs
- automations that call back into the thread
- checkpoints and artifacts

The conversation is the execution hub, not the only storage layer.

## Auto mode

Auto mode means the backend performs a hidden review turn after each visible assistant turn.

That hidden controller should keep going while useful work remains and stop only when the task is done, blocked, or needs user input.

For the agent operating discipline around autonomous continuation, validation, durable runs, and tenacious follow-through, read [Auto Mode](../internal-skills/auto-mode/INDEX.md).

## Cross-thread inspection

Agents can inspect other conversations through the read-only `conversation_inspect` tool.

Use it for:

- listing live or archived threads
- searching visible transcript text with `searchMode: "phrase" | "allTerms" | "anyTerm"`
- reading visible blocks from another conversation, including `roles: ["user", "assistant"]` when the intent is conversational filtering
- pulling surrounding context in one call with `includeAroundMatches: true` and `window`
- diff-style follow-up reads

It does not expose hidden reasoning from another thread. Structural block `types` are `user`, `text`, `context`, `summary`, `tool_use`, `image`, and `error`; use `roles` instead when you mean participant-style filtering.

## Async follow-through from a conversation

Common follow-up surfaces:

- `conversation_queue` — continue this thread later
- `reminder` — bring this thread back with stronger tell-me-later intent
- `run` — detached work started now
- `scheduled_task` — unattended later or recurring work

Use the owning thread as the default place where async outcomes remain visible.

## UI routes

- `/conversations` redirects to the best current conversation target.
- `/conversations/new` opens the draft conversation.
- `/conversations/:id` opens a saved conversation.

## Practical rules

- use the conversation for execution itself
- keep reusable knowledge in `<vault-root>` and attach it when needed
- keep durable status in a project when the work needs structure
- prefer the built-in async tools over inventing ad hoc reminder files or shell wrappers

## Related docs

- [Conversation Context](./conversation-context.md)
- [Knowledge System](./knowledge-system.md)
- [Projects](./projects.md)
- [Desktop App](./desktop-app.md)
- [Auto Mode](../internal-skills/auto-mode/INDEX.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
