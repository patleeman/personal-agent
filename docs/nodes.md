# Nodes

`Node` is now the **legacy/internal storage term** for what the product calls a **page**.

If you are deciding how to think about durable information in `personal-agent`, use [Pages](./pages.md) first.

## What changed

The product model is now:

- **page** = the universal durable unit
- **note / project / skill** = page roles or workflows

The implementation still uses `node` in some API names and historical compatibility surfaces, so you will still see `node` in:

- some internal APIs and code paths
- older docs, links, or scripts that have not been updated yet
- historical references to older CLI or UI surfaces

That does **not** mean users or agents should lead with `node` as the mental model.

## When to use this page

Use this doc when you need the storage compatibility context:

- why some compatibility surfaces still say `node`
- why some APIs still say `node`
- why older docs, links, or scripts may still use the term

For the actual product model, read [Pages](./pages.md).

## Compatibility surfaces

These are the places you may still encounter node terminology:

- older `/nodes` links and API clients
- legacy scripts that still use node terminology
- stale docs that have not yet been refreshed

The preferred user-facing language is now just **page**.

## Related docs

- [Pages](./pages.md)
- [Knowledge Management System](./knowledge-system.md)
- [Command-Line Guide (`pa`)](./command-line.md)
