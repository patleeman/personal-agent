# Docs and Packages

`personal-agent` is converging on a simple file-backed doc model.

A doc is just durable markdown plus optional supporting files.

Older product and implementation language may still say **page**. For normal usage, think **doc**.

## Common doc shapes

A doc can be:

- a single markdown file such as `systems/runtime-model.md`
- a package such as `systems/runtime-model/INDEX.md`

Doc packages can keep nearby supporting files such as:

- `references/`
- `attachments/`
- `documents/`
- `artifacts/`

## What can make a doc special

A doc becomes special because of how it is used, not because of a generic folder name.

Examples:

- selected locally as an instruction file
- attached to a conversation as persistent context
- mentioned in a prompt with `@...`
- packaged as a skill under `skills/<skill>/SKILL.md`

## Metadata

Docs can carry frontmatter metadata such as:

- `title`
- `summary`
- `tags`
- `kind`
- `status`

That metadata should support search, filters, and views.

It should not force a rigid vault taxonomy.

## Reserved shared path

The only shared KB folder contract that should matter broadly is:

```text
skills/<skill>/SKILL.md
```

Everything else in the vault can stay freeform.

## Why this matters

A doc-first model keeps the vault:

- easy to browse in a normal editor
- easy to grep and sync
- easy to reorganize without changing product semantics
- more honest than pretending every knowledge artifact belongs in a hard-coded category

## Related docs

- [Knowledge Management System](./knowledge-system.md)
- [Instruction Files, Docs, and Skills](./instructions-docs-skills.md)
- [Conversation Context Attachments](./conversation-context.md)
- [Nodes](./nodes.md)
