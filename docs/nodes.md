# Nodes

`node` is mostly a legacy or internal storage term.

If you are deciding how to think about durable information in `personal-agent`, use **doc** first.

You may also still see **page** in older product language.

## Why you still see the word

You may still encounter `node` in:

- internal APIs
- older scripts and tests
- compatibility routes and historical docs
- storage helpers around unified durable content

That does not change the preferred mental model.

## Current guidance

When writing docs, UI copy, or normal operating notes, say:

- **doc** for normal durable markdown content
- **skill** for reusable workflow packages
- **instruction file** for selected behavior-shaping docs
- **tracked work package** when you mean the optional structured ongoing-work wrapper

Use `node` only when you are dealing with compatibility or implementation details.

## Notes on storage

There is still internal support for unified node-style storage, but the preferred authoring paths are:

- vault markdown docs/packages anywhere
- `skills/`
- optional tracked work packages under `projects/`

## Related docs

- [Docs and Packages](./pages.md)
- [Knowledge Management System](./knowledge-system.md)
- [Instruction Files, Docs, and Skills](./instructions-docs-skills.md)
