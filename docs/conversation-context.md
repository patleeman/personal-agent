# Conversation Context

Use this doc when deciding how a conversation should carry durable context.

## Four context types

### 1. One-shot mention

Use `@file` or `@doc` when the content matters for one turn only.

Good fit:

- "review this file"
- "use this note for the next answer"

### 2. Attached context doc

Use an attached context doc when the conversation should keep durable knowledge in scope across turns.

Good fit:

- long-lived project context
- a standing design brief for one thread
- a spec the thread will revisit repeatedly

Attached context docs are stored as references, not pasted snapshots.

Current state file:

```text
<state-root>/pi-agent/state/conversation-context-docs/<conversationId>.json
```

### 3. Binary or editor attachment

Use conversation attachments for images, drawings, and other thread-local assets that belong to the conversation itself.

Examples:

- screenshots
- drawings
- generated images
- attachment-backed prompt inputs

These are conversation-local assets, not vault docs.

### 4. Conversation artifact

Use a conversation artifact for rendered outputs that should stay inspectable in the transcript.

Examples:

- HTML memo
- Mermaid diagram
- LaTeX output

See [Artifacts and Rendered Outputs](../internal-skills/artifacts/INDEX.md).

## Attached docs vs repeated `@` mentions

Use this rule:

- include once with `@...` when the context is temporary
- attach the doc when the thread should keep it in scope across turns

## Prompt budgeting

Attached docs should not be pasted in full on every turn.

The normal pattern is:

- store a reference to the source file
- include title, path, and short summary in prompt assembly
- read the full file only when the turn actually needs it

## What belongs in `<vault-root>` vs the conversation

Keep this split:

- source knowledge lives in `<vault-root>`
- thread-local references live in conversation state
- binary conversation assets live in conversation attachment state
- rendered thread outputs live in artifact state

## Practical rules

- do not duplicate large docs into transcript text unless necessary
- prefer attached docs over re-mentioning the same file every turn
- prefer vault docs for reusable knowledge and conversation attachments for thread-local assets
- use artifacts when rendering is the point, not just storage

## Related docs

- [Conversations](./conversations.md)
- [Knowledge System](./knowledge-system.md)
- [Decision Guide](./decision-guide.md)
