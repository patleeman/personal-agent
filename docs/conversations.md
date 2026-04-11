# Conversations

Conversations are the primary live work surface in `personal-agent`.

Use a conversation when you want to work with the agent now.

A conversation is not the canonical home for long-term project state, reusable knowledge, or profile preferences.

## What belongs in a conversation

Good fits:

- prompts and replies
- tool use
- live file work
- working-directory-specific work
- quick branching and forks
- conversation artifacts
- short-lived execution context

Bad fits:

- reusable notes
- durable procedures
- long-term project status
- profile behavior and preferences

Those belong in notes, skills, tracked pages, and `AGENTS.md`.

## Common states

You will usually encounter these conversation states:

- **draft** — an unsent conversation in the web UI
- **live** — actively receiving prompts and replies
- **saved** — durable history you can reopen later
- **open / pinned / archived** — web UI organization states for saved conversations
- **resumed** — reopened by the user or by a wakeup
- **forked** — a branch of another conversation

## Working directory and context

A conversation can carry:

- a current working directory
- selected model / thinking preferences
- attachments
- conversation artifacts
- links to tracked work
- an optional auto mode toggle in the composer controls for hands-off follow-up

This is useful execution context, but it still should not replace durable vault pages.

## Async follow-through from a conversation

A conversation often creates or receives other durable async surfaces:

- **reminder** — tell me later
- **deferred resume** — wake this conversation later
- **run** — detached work started now
- **scheduled task** — future or recurring automation
- **activity / alert** — later attention outside the active conversation

## Web and remote-browser behavior

The desktop web UI can keep multiple saved conversations open at once.

Remote browser sessions can still watch and reply to live conversations, but they now use the same main web surface rather than a separate companion app.

## Local desktop conversation state

In the local Electron app, the conversation page should render from a single backend-owned conversation state instead of stitching together many separate frontend fetches.

The local shape now follows this rule:

- the backend owns the authoritative conversation view model
- the renderer subscribes to that state over desktop IPC
- prompt, abort, takeover, rename, and other mutations stay as separate commands
- the browser-style SSE path remains available for non-local surfaces, but it is no longer the primary local mental model

This keeps local conversation startup simpler and makes route handoff less sensitive to timing differences between bootstrap, saved transcript reads, and live stream attachment.

## Practical rule

Use the conversation for the execution itself.

If the work needs durable status, durable knowledge, or a reusable procedure, move that part into the vault and keep the conversation linked to it.

## Related docs

- [Decision Guide](./decision-guide.md)
- [Tracked Pages](./projects.md)
- [Web UI Guide](./web-ui.md)
- [Async Attention and Wakeups](../internal-skills/async-attention/INDEX.md)
