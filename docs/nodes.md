# Nodes

`node` is now mostly a legacy or internal storage term for what the product model calls a **page**.

If you are deciding how to think about durable information in `personal-agent`, use [Pages](./pages.md) first.

## Why you still see the word

You may still encounter `node` in:

- internal APIs
- older scripts and tests
- compatibility routes and historical docs
- some storage helpers around unified durable content

That does not change the preferred mental model.

## Current guidance

When writing docs, UI copy, or normal operating notes, say:

- **page** for the umbrella concept
- **note**, **skill**, or **tracked page** for the specific role

Use `node` only when you are dealing with compatibility or implementation details.

## Notes on storage

There is still internal support for unified node-style storage and migration, but the main durable authoring paths remain:

- `notes/`
- `_skills/`
- `projects/`

## Related docs

- [Pages](./pages.md)
- [Knowledge Management System](./knowledge-system.md)
