# Conversation Context Attachments

This doc describes the target model for durable KB context inside a conversation.

The problem is simple:

- `@` mentions are good for one turn
- they are bad for persistent thread context
- users need a way to keep a stable set of KB docs attached to a conversation

## Current baseline

Today the conversation composer already supports `@`-tagging files and docs.

That is useful for:

- pulling in a doc for one prompt
- pointing at a specific file during active work
- giving the agent a concrete reference without changing long-term conversation state

That should stay.

## Target behavior

A conversation should also support **persistent attached docs**.

Those docs stay linked to the conversation across turns until removed.

That gives the thread stable context without forcing the user to repeat `@foo.md` every time.

## UI shape

The simplest UI is a small context shelf above the composer.

That shelf should show the docs currently attached to the conversation.

Each attached doc should expose:

- title or filename
- short path hint
- remove action
- open/reveal action when useful

Adding docs should be lightweight. Good options:

- attach from a file/doc picker
- promote a current `@` mention into a persistent attachment
- attach from KB search results or doc detail views

The shelf should stay simple. This is context, not a second sidebar app.

## Semantics

### Attached docs are references, not copies

Conversation state should store references to docs, not pasted copies of their full markdown.

That means later turns can see the latest version of the doc.

### One-shot mention vs attached doc

Use this split:

- **`@doc` mention** = include for this turn
- **attached doc** = keep for the whole conversation until removed

### Prompt assembly

Attached docs should not dump their full bodies into every prompt by default.

A sane default is:

- always provide doc identity: title, path, type hints, summary
- provide a short excerpt when needed
- load more content only when explicitly requested or clearly relevant

That keeps prompt size under control and avoids context sludge.

### Missing or moved docs

If an attached doc is renamed, moved, or deleted, the conversation should surface that clearly.

Do not silently keep stale phantom context.

## Relationship to skills and instruction files

Attached docs are ordinary conversation context.

They are not the same thing as:

- selected instruction files that shape behavior
- skill packages that define reusable workflows

Those surfaces can coexist, but they should stay distinct.

## Suggested conversation state

Keep it boring:

```ts
attachedDocPaths: string[]
```

If later needed, that can grow into richer records with cached titles or summaries, but the first version should stay path-first and simple.

## Why this is better than folder taxonomies

A conversation usually needs a few specific docs, not an entire folder religion.

Attaching docs directly means:

- a design brief can live anywhere in the vault
- a reference note can live anywhere in the vault
- a so-called project doc can live anywhere in the vault
- the conversation still gets stable context from all of them

That is simpler than teaching the user which special folder unlocks which behavior.

## Related docs

- [Conversations](./conversations.md)
- [Instruction Files, Docs, and Skills](./instructions-docs-skills.md)
- [Knowledge Management System](./knowledge-system.md)
