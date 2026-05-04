# Conversation Context

Conversations can carry durable context through file references, attached docs, and binary uploads. The agent sees this context alongside the conversation history.

## File References

Type `@` in the composer to fuzzy-search workspace files. Matching files appear in a dropdown. Select one to insert a reference.

The referenced file content is injected into the prompt when the message is sent. The agent sees the full file contents, not just the path.

```
User: @src/auth.ts Can you review this file?
      @src/auth.test.ts And its tests?

Agent sees: contents of auth.ts + auth.test.ts + the prompt
```

## Attached Context Docs

Drag a markdown file into the composer or use the attach button to pin it as conversation-scoped durable context.

Attached docs:

- Persist across all turns in the conversation
- Appear in the Knowledge rail when workbench mode is active
- Are loaded by the agent on every turn
- Do not modify the vault — they are scoped to the conversation

Multiple docs can be attached to a single conversation. Remove an attached doc from the Knowledge rail.

## Binary Attachments

Images, PDFs, and other binary files can be attached to individual messages:

| Method      | How                                       |
| ----------- | ----------------------------------------- |
| Paste       | `Ctrl+V` (macOS) or `Ctrl+V` (Windows)    |
| Drag        | Drag file into the composer               |
| File picker | Use the attachment button in the composer |

Images are sent to image-capable models as image content. For text-only models, PA saves the latest images locally and gives the agent a `probe_image` tool that asks an image-capable subagent focused questions about them. Other binary formats are stored as conversation attachments but may not be visible to all models.

## Context Loading Order

When the agent builds context for a turn, it merges inputs in this order:

1. **Instruction files** — standing behavior and policy from vault or config
2. **Attached context docs** — durable docs pinned to this conversation
3. **Inline `@` file references** — files referenced in the current message
4. **Binary attachments** — images and files attached to the current message
5. **Conversation history** — previous turns in this thread

Later entries have higher priority for conflicting instructions.

## Use Cases

- **Project setup** — attach a `CONTEXT.md` doc that describes the project
- **Code review** — `@` reference specific files for the agent to analyze
- **Design feedback** — paste a screenshot and ask for visual feedback
- **Multi-file changes** — reference several files and ask for coordinated edits
