# Repo layout

`personal-agent` keeps the monorepo intentionally small.

## Workspace boundaries

There are only five workspace packages:

- `packages/core` — shared durable-state, profile/resource loading, knowledge, MCP, and utility logic
- `packages/daemon` — background runtime, durable runs, scheduled tasks, managed service helpers, and other automation plumbing
- `packages/cli` — the `pa` command surface
- `packages/web` — the browser app plus its server routes
- `packages/desktop` — the Electron shell

That split is deliberate:

- `core` is the default home for reusable app logic
- `daemon` owns background/runtime concerns that should not leak into every surface
- `cli`, `web`, and `desktop` are product surfaces, not general-purpose utility packages

If new code does not need a new deployment boundary, keep it inside one of those existing packages.

## `packages/web` structure

The web package is big enough that folder boundaries matter.

Use these defaults:

- `packages/web/src/pages/` — route-level UI surfaces
- `packages/web/src/components/` — reusable UI pieces
- `packages/web/src/conversation/` — conversation-specific client helpers, search state helpers, formatting helpers, and parsing logic
- `packages/web/src/desktop/` — desktop-shell bridge helpers, desktop-only event plumbing, and desktop UI support logic
- `packages/web/src/hooks/` — reusable React hooks and hook-backed data helpers
- `packages/web/server/` — server routes, automation wiring, conversation backends, and shared server utilities

If a new client-side helper is clearly conversation-specific, keep it under `src/conversation/` instead of dropping another `conversation*` file into `src/`.
If it only exists because the Electron shell injects extra capabilities, keep it under `src/desktop/`.

## Repo-level runtime resources

Some important repo directories are not workspace packages at all:

- `defaults/agent/`
- `extensions/`
- `internal-skills/`
- `prompt-catalog/`
- `themes/`

Those ship as repo-managed runtime resources.

## Built-in extension dependency rule

Built-in extensions under `extensions/` resolve their dependencies from the repo root `package.json` and top-level `node_modules`.

That keeps the repo from growing nested package islands for every built-in extension.

Only add a local extension `package.json` when the extension truly needs isolation from the main app dependency graph, and document why.

## What to avoid

Avoid introducing new workspaces for:

- one-off helpers
- thin wrappers around existing `core` or `daemon` code
- a single extension with a couple of dependencies
- surface-local code that can live under `packages/cli`, `packages/web`, or `packages/desktop`

The default move should be: add a folder, not a package.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Command-Line Guide (`pa`)](./command-line.md)
- [Release cycle](./release-cycle.md)
- [Web server route modules](./web-server-routing.md)
