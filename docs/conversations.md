# Conversations

Conversations are the primary interactive work surface in `personal-agent`.

Use a conversation when you want to work with the agent right now.

A conversation is not the canonical home for durable project state, reusable knowledge, or user preferences.

## Core model

A conversation is where live interaction happens:

- prompts and replies
- tool use
- file work
- branching/forking
- wakeups and callbacks
- conversation artifacts

The durable meaning of a conversation is usually:

- active work in progress, or
- the narrative history around a project, decision, or task

## Lifecycle

Common conversation states:

- **draft** — a new unsent thread in the web UI
- **live** — an active session receiving prompts and replies
- **saved** — a persisted conversation you can reopen later
- **archived / dormant** — not foregrounded right now, but still durable
- **resumed** — reopened from saved history or awakened by a wakeup
- **forked** — a branch of another conversation

Use the conversation for the work itself. If the work needs a durable tracked home, connect it to a project instead of trying to make the conversation carry everything.

## What belongs in a conversation

Good fits:

- active coding or research
- tool-assisted work happening now
- exploratory reasoning
- user-facing back-and-forth
- the short-lived context around files, edits, and decisions

Do not treat the conversation as the main home for:

- long-lived project status
- reusable runbooks
- durable user preferences
- top-level knowledge organization

Those belong in projects, notes, skills, and `AGENTS.md`.

## References and durable context

Conversations can reference durable objects with `@` references.

Typical references include:

- projects
- pages
- skill pages
- scheduled tasks
- profiles

Use references when you want to bring durable context into the current thread without copy-pasting it into the prompt.

## Working directory selection

For new conversations, the working directory is chosen from the strongest available source:

1. an explicit cwd, if one is set from the draft page's centered picker
2. the saved default cwd from Settings / profile settings
3. the web server process cwd as a fallback

The draft page keeps recent conversation cwd values in the centered empty-state area so you can reuse a repo quickly without opening a side inspector first. Once a conversation exists, the same header area lets you switch its working directory inline from the top bar.

Live sessions also expose a `change_working_directory` agent tool. When the agent uses it, the cwd switch happens after the current turn by forking into a new live conversation rooted at the requested directory, and the web UI follows that new conversation automatically.

## Wakeups and callbacks

Conversations can be resumed later by several mechanisms:

- **deferred resume** — continue this conversation later
- **reminders** — resume or notify later with alert delivery
- **scheduled-task callbacks** — a task later reports back into the originating conversation
- **background-work callbacks** — detached work later surfaces a conversation that needs attention

If a saved conversation is already open in the web UI when an allowed wakeup becomes ready, the UI can auto-resume it and deliver the deferred prompt.


## Slash commands and quick actions

The web UI composer supports slash-style commands for common conversation actions.

Examples include:

- `/model`
- `/project new <title>`
- `/project reference <id>`
- `/resume <delay> [prompt]`
- `/fork`
- `/compact`
- `/reload`
- `/new`
- `/summarize-fork`

These commands operate on the conversation surface. They do not change the underlying durable-state model.

`/summarize-fork` duplicates the current thread, compacts the duplicate, and opens that summarized copy as a new conversation.

If you queue follow-up work while the agent is still running, the composer shows queued prompt previews in a capped shelf above the input. Long queued prompt text is intentionally truncated there so a large slash command or injected context block does not take over the whole conversation view. Those previews show image counts explicitly, and restoring a queued prompt puts both its text and any attached images back into the composer. Restore actions stay disabled until the queue item is actually confirmed by the live session.

## Locality boundary

This is the key portability rule.

Portable files should not store conversation ids or session ids.

Do **not** put conversation ids into:

- project `state.yaml`
- project `project.md`
- note-node frontmatter
- note metadata
- skill metadata

Conversation-local bindings belong in local runtime state.

## Practical rule of thumb

Use the conversation to do the work.

Then, if needed:

- promote ongoing tracked work into a **project**
- capture reusable knowledge into a **note**
- capture reusable procedure into a **skill**
- schedule later work with a **deferred resume**, **run**, or **scheduled task**

## Related docs

- [Decision Guide](./decision-guide.md)
- [Web UI Guide](./web-ui.md)
- [Workspace](./workspace.md)
- [Artifacts and Rendered Outputs](./artifacts.md)
- [Tracked Pages](./projects.md)
- [Async Attention and Wakeups](./async-attention.md)
