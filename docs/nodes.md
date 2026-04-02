# Nodes

`Node` is now the **legacy/internal storage term** for what the product calls a **page**.

If you are deciding how to think about durable information in `personal-agent`, use [Pages](./pages.md) first.

## What changed

The product model is now:

- **page** = the universal durable unit
- **note / project / skill** = page roles or workflows

The implementation still uses the unified node store under `sync/nodes/`, so you will still see `node` in:

- on-disk paths like `sync/nodes/<id>/`
- older CLI compatibility (`pa node`)
- some internal APIs and code paths

That does **not** mean users or agents should lead with `node` as the mental model.

## When to use this page

Use this doc when you need the storage compatibility context:

- why the durable root is still `sync/nodes/`
- why some APIs still say `node`
- why older docs, links, or scripts may still use the term

For the actual product model, read [Pages](./pages.md).

## Compatibility surfaces

These are still valid for now:

- `sync/nodes/<id>/`
- `pa node ...`
- older `/nodes` links and API clients

The preferred user-facing surfaces are now:

- `/pages`
- `pa page ...`
- page language in docs and UI copy

## Related docs

- [Pages](./pages.md)
- [Knowledge Management System](./knowledge-system.md)
- [Command-Line Guide (`pa`)](./command-line.md)
